#![allow(dead_code)]
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use anyhow::{Result, Context};
use unicode_normalization::UnicodeNormalization;
use clap::Parser;
use regex::Regex;

mod kenlm;
mod regex_enum;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(default_value = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7")]
    v7_string: String,
    
    #[arg(long, default_value = "lm.binary")]
    model_path: String,
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
struct IslandState {
    score: f32,
    state: kenlm::State,
    history: Vec<Vec<String>>, // List of decoded texts for V7 islands encountered so far
}

#[derive(Debug, Clone)]
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

fn main() -> Result<()> {
    let args = Args::parse();
    let root = Path::new(".");
    
    eprintln!("Loading tokenizer (from regexes)...");
    let tokenizer = Tokenizer::new(root)?;
    
    eprintln!("Loading model from {}...", args.model_path);
    let model = kenlm::Model::new(&args.model_path).map_err(|e| anyhow::anyhow!(e))?;
    
    // Determine input mode
    let (is_islands_mode, islands) = match serde_json::from_str::<Vec<String>>(&args.v7_string) {
        Ok(parsed) => {
            eprintln!("Mode: Fixed Text Islands (JSON detected)");
            (true, parsed)
        },
        Err(_) => {
            eprintln!("Mode: Single V7 String (Legacy)");
            // Mimic island structure: Empty fixed text -> V7 string
            (false, vec!["".to_string(), args.v7_string.clone()])
        }
    };

    if islands.is_empty() {
        // Should catch empty array case
        eprintln!("Error: Input islands array is empty.");
        return Ok(());
    }

    let start_time = std::time::Instant::now();

    // Initial state
    let mut current_states = vec![IslandState {
        score: 0.0,
        state: model.begin_sentence_state(),
        history: Vec::new(),
    }];
    
    let beam_width = 100;

    for (i, segment) in islands.iter().enumerate() {
        if i % 2 == 0 {
            // Fixed Text Island
            if segment.is_empty() {
                continue;
            }
            let purified_words = purify(segment);
            // Deterministic update for all current states
            for state in &mut current_states {
                for word in &purified_words {
                    let (lm_score, new_st) = model.score(&state.state, word);
                    state.score += lm_score;
                    state.state = new_st;
                }
            }
        } else {
            // V7 Code Island
            eprintln!("Decoding V7 island: {}", segment);
            let templates = parse_v7_string(segment, &tokenizer)?;
            current_states = beam_search_v7_island(&templates, &tokenizer, &model, beam_width, &current_states);
        }
    }
    
    let duration = start_time.elapsed();
    
    // Sort final results
    current_states.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    
    if is_islands_mode {
        // New JSON Output
        let candidates: Vec<Vec<String>> = current_states.into_iter().take(beam_width).map(|s| {
            // Flatten the word lists for each island into strings
            s.history.into_iter().map(|words| words.join(" ")).collect()
        }).collect();
        println!("{}", serde_json::to_string(&candidates)?);
        println!("\nInference time: {}ms", duration.as_millis());
    } else {
        // Old Legacy Output
        println!("Top results:");
        for (i, state) in current_states.iter().take(5).enumerate() {
            // Flatten all history (should be just one island)
            let full_text = state.history.iter().flatten().cloned().collect::<Vec<String>>().join(" ");
            println!("{}. [{:.4}] {}", i + 1, state.score, full_text);
        }
        println!("\nInference time: {}ms", duration.as_millis());
    }

    Ok(())
}
