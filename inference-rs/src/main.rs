#![allow(dead_code)]
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::{Result, Context};
use unicode_normalization::UnicodeNormalization;
use clap::Parser;
use regex::Regex;
use axum::{
    extract::{State, Json},
    extract::ws::{WebSocketUpgrade, WebSocket, Message},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use tower_http::services::ServeDir;
use serde::{Deserialize, Serialize};

#[cfg(not(feature = "mocked-model"))]
mod kenlm;
mod regex_enum;
mod plover;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// The V7 string to infer. If not provided and not in server mode, uses a default test string.
    v7_string: Option<String>,
    
    #[arg(long, default_value = "lm.binary")]
    model_path: String,

    #[arg(long)]
    server: bool,

    #[arg(long, default_value = "3000")]
    port: u16,

    #[arg(long, default_value = "static")]
    static_dir: String,

    #[arg(long)]
    stripped_plover_host: Option<String>,

    #[arg(long, default_value = "4020")]
    stripped_plover_port: u16,

}

struct Tokenizer {
    valid_consonants_map: HashMap<String, String>,
    sorted_consonant_keys: Vec<String>,
    candidates_index: HashMap<String, Vec<String>>,
}

impl Tokenizer {
    fn new(root: &Path) -> Result<Self> {
        let regex_path = root.join("./generated_regexes.json");
        let regex_file = File::open(&regex_path).context("Failed to open generated_regexes.json")?;
        let regex_map: HashMap<String, String> = serde_json::from_reader(BufReader::new(regex_file))?;
        
        let mut valid_consonants_map = HashMap::new();
        let mut candidates_index = HashMap::new();

        for (key, regex) in regex_map {
            let parts: Vec<&str> = key.split('_').collect();
            if parts.len() >= 1 {
                let c = parts[0].to_string();
                valid_consonants_map.insert(c.clone(), c.clone());
            }
            
            let candidates = regex_enum::enumerate(&regex);
            candidates_index.insert(key, candidates);
        }

        valid_consonants_map.insert("dd".to_string(), "đ".to_string());
        if valid_consonants_map.contains_key("0") {
             valid_consonants_map.insert("0".to_string(), "0".to_string());
        }

        let mut sorted_consonant_keys: Vec<String> = valid_consonants_map.keys().cloned().collect();
        sorted_consonant_keys.sort_by(|a, b| b.len().cmp(&a.len()));

        Ok(Tokenizer {
            valid_consonants_map,
            sorted_consonant_keys,
            candidates_index,
        })
    }
}

fn is_combining_mark(c: char) -> bool {
    matches!(c, '\u{0300}'..='\u{036f}' | '\u{1dc0}'..='\u{1dff}' | '\u{20d0}'..='\u{20ff}' | '\u{fe20}'..='\u{fe2f}')
}

fn remove_diacritics(text: &str) -> String {
    let normalized: String = text.nfd().collect();
    let without_marks: String = normalized
        .chars()
        .filter(|c| !is_combining_mark(*c))
        .collect();
        
    let result: String = without_marks.nfc().collect();
    result.replace('đ', "d").replace('Đ', "D").replace('y', "i").replace('Y', "I")
}

fn purify(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    // Keep only letters (\p{L}) and whitespace (\s).
    // Python logic: [^\w\s] -> space, and [\d_] -> space.
    // Effectively keeps only letters.
    let re = Regex::new(r"[^\p{L}\s]").unwrap();
    let cleaned = re.replace_all(&lower, " ");
    cleaned.split_whitespace().map(|s| s.to_string()).collect()
}

#[derive(Debug)]
struct PartialSyllableTemplate {
    consonant: String,
    rime_first_letter: char,
    tone: i32,
}

fn parse_v7_string(v7_string: &str, tokenizer: &Tokenizer) -> Result<Vec<PartialSyllableTemplate>> {
    let mut templates = Vec::new();
    let mut current_slice = v7_string;

    while !current_slice.is_empty() {
        let mut matched_key: Option<&String> = None;
        for key in &tokenizer.sorted_consonant_keys {
            if current_slice.starts_with(key) {
                matched_key = Some(key);
                break;
            }
        }

        let consonant = if let Some(key) = matched_key {
            let mapped = tokenizer.valid_consonants_map.get(key).unwrap();
            current_slice = &current_slice[key.len()..];
            mapped.clone()
        } else {
            if tokenizer.valid_consonants_map.contains_key("") {
                "".to_string()
            } else {
                 return Err(anyhow::anyhow!("Could not parse consonant at: {}", current_slice));
            }
        };

        let mut chars_iter = current_slice.chars();
        let rime_start = chars_iter.next().ok_or_else(|| anyhow::anyhow!("Unexpected end looking for rime start"))?;
        current_slice = chars_iter.as_str();

        let mut chars_iter = current_slice.chars();
        let tone_char = chars_iter.next().ok_or_else(|| anyhow::anyhow!("Unexpected end looking for tone"))?;
        let tone = tone_char.to_digit(10).ok_or_else(|| anyhow::anyhow!("Expected digit for tone, got {}", tone_char))? as i32;
        current_slice = chars_iter.as_str();

        templates.push(PartialSyllableTemplate {
            consonant,
            rime_first_letter: rime_start,
            tone,
        });
    }

    Ok(templates)
}

#[derive(Debug, Clone)]
#[cfg(not(feature = "mocked-model"))]
struct IslandState {
    score: f32,
    state: kenlm::State,
    history: Vec<Vec<String>>, // List of decoded texts for V7 islands encountered so far
}

#[derive(Debug, Clone)]
#[cfg(not(feature = "mocked-model"))]
struct BeamNode<'a> {
    score: f32,
    state: kenlm::State,
    word: &'a str,
    parent_idx: Option<usize>,
    origin_idx: usize, // Index into incoming_states
}

fn get_candidates<'a>(template: &PartialSyllableTemplate, tokenizer: &'a Tokenizer) -> Option<&'a Vec<String>> {
    let norm_rime_start = remove_diacritics(&template.rime_first_letter.to_string());
    let key = format!("{}_{}_{}", template.consonant, norm_rime_start, template.tone);
    tokenizer.candidates_index.get(&key)
}

#[cfg(not(feature = "mocked-model"))]
fn beam_search_v7_island<'a>(
    templates: &[PartialSyllableTemplate],
    tokenizer: &'a Tokenizer,
    model: &kenlm::Model,
    beam_width: usize,
    incoming_states: &[IslandState],
) -> Vec<IslandState> {
    // Initialize beam from incoming states
    let mut current_beam: Vec<BeamNode<'a>> = incoming_states.iter().enumerate().map(|(i, s)| {
        BeamNode {
            score: s.score,
            state: s.state.clone(),
            word: "",
            parent_idx: None,
            origin_idx: i,
        }
    }).collect();

    // Limit initial beam if incoming_states is too large (though unusual)
    if current_beam.len() > beam_width {
        current_beam.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        current_beam.truncate(beam_width);
    }

    let mut history: Vec<Vec<BeamNode<'a>>> = Vec::with_capacity(templates.len() + 1);
    history.push(current_beam);

    for template in templates {
        let candidates_opt = get_candidates(template, tokenizer);
        
        let mut candidate_data: Vec<(&str, u32, f32)> = Vec::new();
        
        if let Some(list) = candidates_opt {
             if list.is_empty() {
                 candidate_data.push(("<?>", 0, -10.0));
             } else {
                 candidate_data.reserve(list.len());
                 for w in list {
                     let idx = model.lookup(w);
                     candidate_data.push((w.as_str(), idx, 0.0));
                 }
             }
        } else {
             candidate_data.push(("<?>", 0, -10.0));
        }

        let prev_beam = history.last().unwrap();
        // We might explore up to prev_beam.len() * candidate_data.len() nodes.
        let mut next_candidates: Vec<(f32, usize, usize, &'a str, kenlm::State)> = Vec::with_capacity(prev_beam.len() * candidate_data.len());

        for (parent_idx, node) in prev_beam.iter().enumerate() {
            for (word_str, word_idx, penalty) in &candidate_data {
                if *penalty < -1.0 && *word_str == "<?>" {
                     next_candidates.push((node.score + penalty, parent_idx, node.origin_idx, *word_str, node.state.clone()));
                     continue;
                }

                let (lm_score, new_state) = model.score_index(&node.state, *word_idx);
                let total_score = node.score + lm_score + penalty;
                
                next_candidates.push((total_score, parent_idx, node.origin_idx, *word_str, new_state));
            }
        }
        
        // Keep top K
        next_candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
        
        let next_beam: Vec<BeamNode<'a>> = next_candidates.into_iter().take(beam_width).map(|(s, p, o, w, st)| {
            BeamNode {
                score: s,
                state: st,
                word: w,
                parent_idx: Some(p),
                origin_idx: o,
            }
        }).collect();
        
        history.push(next_beam);
    }
    
    // Reconstruct paths
    let last_beam = history.last().unwrap();
    let mut results = Vec::new();
    
    for node in last_beam {
        let mut words = Vec::new();
        let mut current_step = history.len() - 1;
        
        // Collect words backwards for this island
        words.push(node.word.to_string());
        
        let mut parent_idx = node.parent_idx;
        while let Some(idx) = parent_idx {
            current_step -= 1;
            let parent_node = &history[current_step][idx];
            if !parent_node.word.is_empty() {
                 words.push(parent_node.word.to_string());
            }
            parent_idx = parent_node.parent_idx;
        }
        
        words.reverse();
        
        // Combine with history from origin
        let mut new_history = incoming_states[node.origin_idx].history.clone();
        new_history.push(words);
        
        results.push(IslandState {
            score: node.score,
            state: node.state.clone(),
            history: new_history,
        });
    }
    
    results
}

fn perform_mock_inference(
    islands: &[String],
    tokenizer: &Tokenizer,
) -> Result<Vec<Vec<String>>> {
    let mut decoded_islands = Vec::new();

    for (i, segment) in islands.iter().enumerate() {
        if i % 2 == 0 {
            // Fixed text
            decoded_islands.push(segment.clone());
        } else {
            // V7 Code Island
            let templates = parse_v7_string(segment, tokenizer)?;
            let mut words = Vec::new();
            for template in templates {
                let candidates_opt = get_candidates(&template, tokenizer);
                if let Some(list) = candidates_opt {
                    if let Some(first) = list.first() {
                         words.push(first.clone());
                    } else {
                         // Fallback if list is empty
                         words.push(segment.clone());
                    }
                } else {
                     // Fallback if no candidates found
                     words.push(segment.clone());
                }
            }
            decoded_islands.push(words.join(" "));
        }
    }

    // Return a single candidate containing the decoded islands
    Ok(vec![decoded_islands])
}

#[cfg(not(feature = "mocked-model"))]
fn perform_inference(
    islands: &[String],
    tokenizer: &Tokenizer,
    model: &kenlm::Model,
    beam_width: usize,
) -> Result<Vec<Vec<String>>> {
    // Initial state
    let mut current_states = vec![IslandState {
        score: 0.0,
        state: model.begin_sentence_state(),
        history: Vec::new(),
    }];
    
    for (i, segment) in islands.iter().enumerate() {
        if i % 2 == 0 {
            // === MODIFIED SECTION: Fixed Text Island ===
            if segment.is_empty() {
                // Record empty history for alignment
                for state in &mut current_states {
                    state.history.push(Vec::new());
                }
                continue;
            }

            // 1. We still need purified words to update the LM State accurately
            let purified_words = purify(segment);

            // 2. Update states
            for state in &mut current_states {
                // Update Score/State using PURIFIED words
                for word in &purified_words {
                    let (lm_score, new_st) = model.score(&state.state, word);
                    state.score += lm_score;
                    state.state = new_st;
                }
                
                // Store ORIGINAL text in history
                // We wrap it in a Vec to match the expected type, 
                // but this ensures the final output retains casing/punctuation.
                state.history.push(vec![segment.clone()]);
            }
            // ===========================================
        } else {
            // V7 Code Island
            // eprintln!("Decoding V7 island: {}", segment);
            let templates = parse_v7_string(segment, tokenizer)?;
            current_states = beam_search_v7_island(&templates, tokenizer, model, beam_width, &current_states);
        }
    }
    
    // Sort final results
    current_states.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    
    let candidates: Vec<Vec<String>> = current_states.into_iter().take(beam_width).map(|s| {
        // Flatten the word lists for each island into strings
        s.history.into_iter().map(|words| words.join(" ")).collect()
    }).collect();
    
    Ok(candidates)
}

#[derive(Clone)]
struct PloverConfig {
    host: String,
    port: u16,
}

struct AppState {
    tokenizer: Tokenizer,
    #[cfg(not(feature = "mocked-model"))]
    model: kenlm::Model,
    plover: Option<PloverConfig>,
    plover_status_cache: tokio::sync::Mutex<Option<(Instant, bool)>>,
}

#[derive(Deserialize)]
struct InferRequest {
    islands: Vec<String>,
}

#[derive(Serialize)]
struct InferResponse {
    candidates: Vec<Vec<String>>,
}

#[derive(Deserialize)]
struct PloverRequest {
    #[serde(default)]
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct PloverStatusResponse {
    available: bool,
}

async fn infer_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<InferRequest>,
) -> Json<InferResponse> {
    // Basic validation
    if payload.is_empty() {
        return Json(InferResponse { candidates: vec![] });
    }

    #[cfg(not(feature = "mocked-model"))]
    let result = perform_inference(&payload.islands, &state.tokenizer, &state.model, 100);

    #[cfg(feature = "mocked-model")]
    let result = perform_mock_inference(&payload.islands, &state.tokenizer);

    match result {
        Ok(candidates) => Json(InferResponse { candidates }),
        Err(e) => {
            eprintln!("Inference error: {}", e);
            Json(InferResponse { candidates: vec![] })
        }
    }
}

async fn plover_status_handler(
    State(state): State<Arc<AppState>>,
) -> Json<PloverStatusResponse> {
    let Some(config) = state.plover.as_ref() else {
        return Json(PloverStatusResponse { available: false });
    };

    {
        let cache = state.plover_status_cache.lock().await;
        if let Some((ts, cached)) = *cache {
            if ts.elapsed() < Duration::from_secs(2) {
                return Json(PloverStatusResponse { available: cached });
            }
        }
    }

    let client = plover::PloverClient::new(config.host.clone(), config.port);
    let available = client.check().await.is_ok();
    {
        let mut cache = state.plover_status_cache.lock().await;
        *cache = Some((Instant::now(), available));
    }
    Json(PloverStatusResponse { available })
}

#[derive(Serialize)]
struct PloverProxyResponse {
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<serde_json::Value>,
}

async fn plover_ws_handler(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let Some(config) = state.plover.clone() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Stripped Plover is disabled").into_response();
    };

    ws.on_upgrade(|socket| handle_plover_socket(socket, config))
}

async fn handle_plover_socket(stream: WebSocket, config: PloverConfig) {
    let mut socket = stream;
    let client = plover::PloverClient::new(config.host, config.port);

    while let Some(Ok(message)) = socket.next().await {
        let Message::Text(text) = message else {
            continue;
        };

        let parsed: Result<PloverRequest, _> = serde_json::from_str(&text);
        let response = match parsed {
            Ok(req) => {
                let params = req.params.unwrap_or_else(|| serde_json::json!({}));
                let id = req.id.clone();
                let resp = match client.send_request(&req.method, params).await {
                    Ok(result) => PloverProxyResponse {
                        ok: true,
                        result: Some(result),
                        error: None,
                        id,
                    },
                    Err(e) => PloverProxyResponse {
                        ok: false,
                        result: None,
                        error: Some(e.to_string()),
                        id,
                    },
                };
                resp
            }
            Err(e) => PloverProxyResponse {
                ok: false,
                result: None,
                error: Some(format!("Invalid request: {}", e)),
                id: None,
            },
        };

        let _ = socket
            .send(Message::Text(serde_json::to_string(&response).unwrap_or_else(|_| "{\"ok\":false}".to_string())))
            .await;
    }
}

impl InferRequest {
    fn is_empty(&self) -> bool {
        self.islands.is_empty()
    }
}


#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let root = Path::new(".");
    
    eprintln!("Loading tokenizer (from regexes)...");
    let tokenizer = Tokenizer::new(root)?;
    
    #[cfg(not(feature = "mocked-model"))]
    let model = {
        eprintln!("Loading model from {}...", args.model_path);
        kenlm::Model::new(&args.model_path).map_err(|e| anyhow::anyhow!(e))?
    };

    if args.server {
        let plover_host = args
            .stripped_plover_host
            .or_else(|| std::env::var("STRIPPED_PLOVER_HOST").ok());
        let plover_port = std::env::var("STRIPPED_PLOVER_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(args.stripped_plover_port);
        let plover = plover_host.map(|host| PloverConfig { host, port: plover_port });
        let app_state = Arc::new(AppState {
            tokenizer,
            #[cfg(not(feature = "mocked-model"))]
            model,
            plover,
            plover_status_cache: tokio::sync::Mutex::new(None),
        });

        let app = Router::new()
            .route("/infer", post(infer_handler))
            .route("/plover/status", get(plover_status_handler))
            .route("/plover/ws", get(plover_ws_handler))
            .nest_service("/", ServeDir::new(&args.static_dir))
            .with_state(app_state);

        let addr = format!("0.0.0.0:{}", args.port);
        eprintln!("Listening on {}", addr);
        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, app).await?;

    } else {
        // Legacy CLI Mode
        let input = args.v7_string.unwrap_or_else(|| "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7".to_string());
        
        // Determine input mode
        let (is_islands_mode, islands) = match serde_json::from_str::<Vec<String>>(&input) {
            Ok(parsed) => {
                eprintln!("Mode: Fixed Text Islands (JSON detected)");
                (true, parsed)
            },
            Err(_) => {
                eprintln!("Mode: Single V7 String (Legacy)");
                // Mimic island structure: Empty fixed text -> V7 string
                (false, vec!["".to_string(), input.clone()])
            }
        };

        if islands.is_empty() {
            eprintln!("Error: Input islands array is empty.");
            return Ok(());
        }

        let start_time = std::time::Instant::now();
        #[cfg(not(feature = "mocked-model"))]
        let candidates = perform_inference(&islands, &tokenizer, &model, 100)?;

        #[cfg(feature = "mocked-model")]
        let candidates = perform_mock_inference(&islands, &tokenizer)?;
        let duration = start_time.elapsed();

        if is_islands_mode {
            println!("{}", serde_json::to_string(&candidates)?);
        } else {
             println!("Top results:");
             for (i, parts) in candidates.iter().take(5).enumerate() {
                 let full_text = parts.join(" ");
                 // Note: perform_inference returns candidates[i] as a list of strings (one per island).
                 // In legacy mode (["", "v7"]), parts[0] is "", parts[1] is the decoded text.
                 println!("{}. {}", i + 1, full_text.trim());
             }
        }
        println!("\nInference time: {}ms", duration.as_millis());
    }

    Ok(())
}
