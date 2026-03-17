#![allow(dead_code)]
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use anyhow::Result;
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
use tower_http::services::{ServeDir, ServeFile};
use serde::{Deserialize, Serialize};
use serde_json::json;

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

fn structured_onset<'a>(c: &'a str, v: &str) -> &'a str {
    match c {
        "0" => "",
        "w" => "qu",
        "g" if v == "e" || v == "i" => "gh",
        "ng" if v == "e" || v == "i" => "ngh",
        "k" if v == "e" || v == "i" => "k",
        "k" => "c",
        _ => c,
    }
}

fn generate_structured_regex_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let structured_consonants = [
        "0", "b", "ch", "d", "g", "h", "k", "kh", "l", "m", "n", "ng", "nh", "p", "ph", "r",
        "s", "t", "th", "tr", "v", "w", "x", "z", "đ",
    ];
    let structured_hard_consonants: HashSet<&str> =
        HashSet::from(["b", "ch", "d", "g", "kh", "ng", "p", "ph", "r", "tr", "x", "đ"]);

    let a = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:[ấắ][cpt]|á(?:ch?|[pt]))","(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"];
    let e = ["(?:e(?:(?:ng?|[mo]))?|ê(?:(?:nh?|[mu]))?)","(?:é(?:(?:ng?|[mo]))?|ế(?:(?:nh?|[mu]))?)","(?:è(?:(?:ng?|[mo]))?|ề(?:(?:nh?|[mu]))?)","(?:ẻ(?:(?:ng?|[mo]))?|ể(?:(?:nh?|[mu]))?)","(?:ẽ(?:(?:ng?|[mo]))?|ễ(?:(?:nh?|[mu]))?)","(?:ẹ(?:(?:ng?|[mo]))?|ệ(?:(?:nh?|[mu]))?)","(?:é[cpt]|ế(?:ch|[pt]))","(?:ẹ[cpt]|ệ(?:ch|[pt]))"];
    let o = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]|ă(?:m|ng?)|e(?:[no])?|a(?:(?:[imouy]|n(?:[gh])?))?))?)","(?:ớ(?:[imn])?|ố(?:(?:ng?|[im]))?|ó(?:(?:ng?|[aeim]))?|o(?:óng|é[no]|ắ(?:m|ng?)|á(?:[imouy]|n(?:[gh])?)))","(?:ờ(?:[imn])?|ồ(?:(?:ng?|[im]))?|ò(?:(?:ng?|[aeim]))?|o(?:òng|è[no]|ằ(?:m|ng?)|à(?:[imouy]|n(?:[gh])?)))","(?:ở(?:[imn])?|ổ(?:(?:ng?|[im]))?|ỏ(?:(?:ng?|[aeim]))?|o(?:ỏng|ẻ[no]|ẳ(?:m|ng?)|ả(?:[imouy]|n(?:[gh])?)))","(?:ỡ(?:[imn])?|ỗ(?:(?:ng?|[im]))?|õ(?:(?:ng?|[aeim]))?|o(?:õng|ẽ[no]|ẵ(?:m|ng?)|ã(?:[imouy]|n(?:[gh])?)))","(?:ợ(?:[imn])?|ộ(?:(?:ng?|[im]))?|ọ(?:(?:ng?|[aeim]))?|o(?:ọng|ẹ[no]|ặ(?:m|ng?)|ạ(?:[imouy]|n(?:[gh])?)))","(?:ớ[pt]|[óố][cpt]|o(?:ét|óc|ắ[cpt]|á(?:ch?|[pt])))","(?:ợ[pt]|[ọộ][cpt]|o(?:ẹt|ọc|ặ[cpt]|ạ(?:ch?|[pt])))"];
    let u = ["(?:ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?|u(?:(?:ng?|[aim]|ê(?:nh?)?|â(?:y|ng?)|ơ(?:[in])?|ô(?:ng?|[im])|y(?:(?:ên|nh?|[amu]))?))?)","(?:ướ(?:ng?|[imu])|ú(?:(?:ng?|[aimy]))?|ứ(?:(?:ng?|[aimu]))?|u(?:yến|ế(?:nh?)?|ấ(?:y|ng?)|ớ(?:[in])?|ố(?:ng?|[im])|ý(?:nh?|[amu])))","(?:ườ(?:ng?|[imu])|ù(?:(?:ng?|[aimy]))?|ừ(?:(?:ng?|[aimu]))?|u(?:yền|ề(?:nh?)?|ầ(?:y|ng?)|ờ(?:[in])?|ồ(?:ng?|[im])|ỳ(?:nh?|[amu])))","(?:ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aimy]))?|ử(?:(?:ng?|[aimu]))?|u(?:yển|ể(?:nh?)?|ẩ(?:y|ng?)|ở(?:[in])?|ổ(?:ng?|[im])|ỷ(?:nh?|[amu])))","(?:ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aimy]))?|ữ(?:(?:ng?|[aimu]))?|u(?:yễn|ễ(?:nh?)?|ẫ(?:y|ng?)|ỡ(?:[in])?|ỗ(?:ng?|[im])|ỹ(?:nh?|[amu])))","(?:ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aimy]))?|ự(?:(?:ng?|[aimu]))?|u(?:yện|ệ(?:nh?)?|ậ(?:y|ng?)|ợ(?:[in])?|ộ(?:ng?|[im])|ỵ(?:nh?|[amu])))","(?:ướ[cpt]|[úứ][cpt]|u(?:ớt|yết|ấ[ct]|ố[cpt]|ế(?:t|ch)|ý(?:ch|[pt])))","(?:ượ[cpt]|[ụự][cpt]|u(?:ợt|yệt|ậ[ct]|ộ[cpt]|ệ(?:t|ch)|ỵ(?:ch|[pt])))"];
    let iz = ["(?:i(?:(?:nh?|[amu]))?|y(?:ê(?:ng?|[mu]))?)","(?:ý|yế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|yề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|yể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|yễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|yệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:yế[cpt]|í(?:ch|[pt]))","(?:yệ[cpt]|ị(?:ch|[pt]))"];
    let is = ["(?:y|i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?)","(?:ý|iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"];
    let ih = ["i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?","(?:iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"];
    let wa = ["(?:ă(?:m|ng?)|â(?:y|ng?)|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:y|ng?)|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:y|ng?)|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:y|ng?)|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:y|ng?)|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:y|ng?)|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:ấ[ct]|ắ[cpt]|á(?:ch?|[pt]))","(?:ậ[ct]|ặ[cpt]|ạ(?:ch?|[pt]))"];
    let we = ["(?:ê(?:nh?)?|e(?:[no])?)","(?:ế(?:nh?)?|é(?:[no])?)","(?:ề(?:nh?)?|è(?:[no])?)","(?:ể(?:nh?)?|ẻ(?:[no])?)","(?:ễ(?:nh?)?|ẽ(?:[no])?)","(?:ệ(?:nh?)?|ẹ(?:[no])?)","(?:ét|ế(?:t|ch))","(?:ẹt|ệ(?:t|ch))"];
    let wi = ["y(?:(?:ên|nh?|[amu]))?","(?:yến|ý(?:(?:nh?|[amu]))?)","(?:yền|ỳ(?:(?:nh?|[amu]))?)","(?:yển|ỷ(?:(?:nh?|[amu]))?)","(?:yễn|ỹ(?:(?:nh?|[amu]))?)","(?:yện|ỵ(?:(?:nh?|[amu]))?)","(?:yết|ý(?:ch|[pt]))","(?:yệt|ỵ(?:ch|[pt]))"];
    let wo = ["(?:ông|ơ(?:[in])?)","(?:ống|ớ(?:[in])?)","(?:ồng|ờ(?:[in])?)","(?:ổng|ở(?:[in])?)","(?:ỗng|ỡ(?:[in])?)","(?:ộng|ợ(?:[in])?)","(?:ốc|ớt)","(?:ộc|ợt)"];
    let ko = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"];
    let ku = ["(?:u(?:(?:ng?|[aim]|ô(?:ng?|[im])))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:ng?|[im])|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:ng?|[im])|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:ng?|[im])|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:ng?|[im])|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:ng?|[im])|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uố[cpt]|ướ[cpt]|[úứ][cpt])","(?:uộ[cpt]|ượ[cpt]|[ụự][cpt])"];
    let za = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:[ấắ][cpt]|á(?:ch?|[pt]))","(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"];
    let ze = ["e(?:(?:ng?|[mo]))?","é(?:(?:ng?|[mo]))?","è(?:(?:ng?|[mo]))?","ẻ(?:(?:ng?|[mo]))?","ẽ(?:(?:ng?|[mo]))?","ẹ(?:(?:ng?|[mo]))?","é[cpt]","ẹ[cpt]"];
    let zo = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"];
    let zu = ["(?:u(?:(?:ng?|[aim]|ô(?:i|ng)))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:i|ng)|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:i|ng)|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:i|ng)|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:i|ng)|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:i|ng)|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uốc|ướ[cpt]|[úứ][cpt])","(?:uộc|ượ[cpt]|[ụự][cpt])"];
    let zi = ["g(?:i(?:[mn])?|iê(?:[mnu]|ng|nh)?)","g(?:í(?:[mn])?|iế(?:[mnu]|ng|nh)?)","g(?:ì(?:[mn])?|iề(?:[mnu]|ng|nh)?)","g(?:ỉ(?:[mn])?|iể(?:[mnu]|ng|nh)?)","g(?:ĩ(?:[mn])?|iễ(?:[mnu]|ng|nh)?)","g(?:ị(?:[mn])?|iệ(?:[mnu]|ng|nh)?)","g(?:í[pt]|iế(?:[cpt]|ch))","g(?:ị[pt]|iệ(?:[cpt]|ch))"];

    for c in structured_consonants {
        for v in ["a", "e", "i", "o", "u"] {
            if c == "w" && v == "u" {
                continue;
            }
            for i in 0..8 {
                let k = format!("{}_{}_{}", c, v, i);
                if c == "w" {
                    let s = match v {
                        "a" => wa[i],
                        "e" => we[i],
                        "i" => wi[i],
                        "o" => wo[i],
                        _ => unreachable!(),
                    };
                    map.insert(k, format!("qu{}", s));
                    continue;
                }
                if c == "z" {
                    let value = if v == "i" {
                        zi[i].to_string()
                    } else {
                        let s = match v {
                            "a" => za[i],
                            "e" => ze[i],
                            "o" => zo[i],
                            "u" => zu[i],
                            _ => unreachable!(),
                        };
                        format!("gi{}", s)
                    };
                    map.insert(k, value);
                    continue;
                }
                if v == "i" {
                    let i_value = if c == "0" {
                        iz[i]
                    } else if structured_hard_consonants.contains(c) {
                        ih[i]
                    } else {
                        is[i]
                    };
                    map.insert(k, format!("{}{}", structured_onset(c, v), i_value));
                    continue;
                }
                let mut s = match v {
                    "a" => a[i],
                    "e" => e[i],
                    "o" => o[i],
                    "u" => u[i],
                    _ => unreachable!(),
                };
                if c == "k" && v == "o" {
                    s = ko[i];
                }
                if c == "k" && v == "u" {
                    s = ku[i];
                }
                map.insert(k, format!("{}{}", structured_onset(c, v), s));
            }
        }
    }

    map
}

impl Tokenizer {
    fn new() -> Result<Self> {
        let regex_map = generate_structured_regex_map();

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

const PLOVER_STATUS_CACHE_SECONDS: u64 = 2;

#[derive(Deserialize)]
struct InferRequest {
    islands: Vec<String>,
}

#[derive(Serialize)]
struct InferResponse {
    candidates: Vec<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct GeminiDecision {
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    keep: Vec<usize>,
    #[serde(default)]
    sentence: Option<String>,
}

fn extract_first_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if start <= end {
        Some(&text[start..=end])
    } else {
        None
    }
}

fn parse_keep_indices(response_text: &str, candidate_count: usize) -> Vec<usize> {
    let Some(json_fragment) = extract_first_json_object(response_text) else {
        return Vec::new();
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(json_fragment) else {
        return Vec::new();
    };

    let Some(keep) = value.get("keep").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for raw in keep {
        if let Some(idx) = raw.as_u64() {
            let idx = idx as usize;
            if idx < candidate_count && !result.contains(&idx) {
                result.push(idx);
            }
        }
    }
    result
}

fn parse_gemini_decision(response_text: &str) -> Option<GeminiDecision> {
    let json_fragment = extract_first_json_object(response_text)?;
    serde_json::from_str::<GeminiDecision>(json_fragment).ok()
}

fn apply_keep_indices(
    candidates: Vec<Vec<String>>,
    keep_indices: &[usize],
) -> Vec<Vec<String>> {
    if candidates.is_empty() {
        return candidates;
    }

    let mut kept = Vec::new();
    for &idx in keep_indices {
        if let Some(candidate) = candidates.get(idx) {
            kept.push(candidate.clone());
        }
    }

    if kept.is_empty() {
        vec![candidates[0].clone()]
    } else {
        kept
    }
}

fn collect_position_options(rerank_pool: &[Vec<String>], v7_index: usize) -> Vec<Vec<String>> {
    let tokenized: Vec<Vec<String>> = rerank_pool
        .iter()
        .filter_map(|candidate| candidate.get(v7_index))
        .map(|segment| segment.split_whitespace().map(|w| w.to_string()).collect::<Vec<_>>())
        .filter(|tokens| !tokens.is_empty())
        .collect();
    let max_len = tokenized.iter().map(Vec::len).max().unwrap_or(0);
    (0..max_len)
        .map(|i| {
            let mut seen = HashSet::new();
            let mut options = Vec::new();
            for tokens in &tokenized {
                if let Some(word) = tokens.get(i) {
                    if seen.insert(word.clone()) {
                        options.push(word.clone());
                    }
                }
            }
            options
        })
        .collect()
}

fn apply_synthesized_sentence(
    candidates: &[Vec<String>],
    sentence: &str,
    v7_index: usize,
) -> Option<Vec<Vec<String>>> {
    let normalized = sentence.trim();
    if normalized.is_empty() {
        return None;
    }
    let mut chosen = candidates.first()?.clone();
    if v7_index >= chosen.len() {
        return None;
    }
    chosen[v7_index] = normalized.to_string();
    Some(vec![chosen])
}

#[derive(Debug, Deserialize)]
struct GeminiInferenceDecision {
    decoded_v7_islands: Vec<String>,
}

fn parse_gemini_inference_decision(response_text: &str) -> Option<GeminiInferenceDecision> {
    let json_fragment = extract_first_json_object(response_text)?;
    serde_json::from_str::<GeminiInferenceDecision>(json_fragment).ok()
}

async fn maybe_infer_with_gemini(
    islands: &[String],
    tokenizer: &Tokenizer,
) -> Option<Vec<Vec<String>>> {
    let Ok(api_key) = std::env::var("GEMINI_API_KEY") else {
        return None;
    };
    if api_key.trim().is_empty() {
        return None;
    }

    let option_limit = std::env::var("GEMINI_POSITION_OPTION_LIMIT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(24);

    let mut v7_segments = Vec::new();
    for (idx, segment) in islands.iter().enumerate() {
        if idx % 2 == 1 {
            let templates = match parse_v7_string(segment, tokenizer) {
                Ok(t) => t,
                Err(err) => {
                    eprintln!("Gemini full inference: parse failure ({err})");
                    return perform_mock_inference(islands, tokenizer).ok();
                }
            };
            let position_options: Vec<Vec<String>> = templates
                .iter()
                .map(|template| {
                    get_candidates(template, tokenizer)
                        .map(|choices| choices.iter().take(option_limit).cloned().collect())
                        .unwrap_or_default()
                })
                .collect();
            v7_segments.push(json!({
                "island_index": idx,
                "v7": segment,
                "position_options": position_options
            }));
        }
    }

    let json_input = json!({
        "task": "v7_full_inference",
        "rules": {
            "json_output_only": true,
            "must_use_v7_position_options": true,
            "preserve_fixed_text": true
        },
        "islands": islands,
        "v7_segments": v7_segments,
        "response_schema": {
            "decoded_v7_islands": ["string"]
        }
    });

    let prompt = format!(
        "You are decoding Vietnamese V7 input.\n\
Return strict JSON only with schema {{\"decoded_v7_islands\":[...]}}.\n\
Rules:\n\
1) Do not use KenLM assumptions.\n\
2) Decode each V7 segment using only the provided per-position options.\n\
3) Keep fixed-text islands unchanged by only returning decoded strings for V7 islands in order.\n\
4) Prefer the most meaningful and natural Vietnamese sentence.\n\
Input JSON:\n{}",
        json_input
    );

    let model_name = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-pro".to_string());
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model_name
    );
    let request_body = json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json"
        }
    });

    let client = reqwest::Client::new();
    let timeout_seconds = std::env::var("GEMINI_TIMEOUT_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(20);

    let response = match client
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&request_body)
        .timeout(Duration::from_secs(timeout_seconds))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(err) => {
            eprintln!("Gemini full inference fallback: request failed ({err})");
            return perform_mock_inference(islands, tokenizer).ok();
        }
    };

    let response_json: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Gemini full inference fallback: invalid JSON response ({err})");
            return perform_mock_inference(islands, tokenizer).ok();
        }
    };

    let response_text = response_json
        .get("candidates")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("content"))
        .and_then(|v| v.get("parts"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("text"))
        .and_then(|v| v.as_str());

    let Some(response_text) = response_text else {
        eprintln!("Gemini full inference fallback: missing text response");
        return perform_mock_inference(islands, tokenizer).ok();
    };

    let Some(decision) = parse_gemini_inference_decision(response_text) else {
        eprintln!("Gemini full inference fallback: malformed decision JSON");
        return perform_mock_inference(islands, tokenizer).ok();
    };

    let mut decoded = Vec::with_capacity(islands.len());
    let mut v7_iter = decision.decoded_v7_islands.into_iter();
    for (idx, segment) in islands.iter().enumerate() {
        if idx % 2 == 0 {
            decoded.push(segment.clone());
        } else if let Some(next_decoded) = v7_iter.next() {
            decoded.push(next_decoded);
        } else {
            eprintln!("Gemini full inference fallback: insufficient decoded islands");
            return perform_mock_inference(islands, tokenizer).ok();
        }
    }

    Some(vec![decoded])
}

async fn maybe_rerank_with_gemini(
    islands: &[String],
    candidates: Vec<Vec<String>>,
) -> Vec<Vec<String>> {
    let Ok(api_key) = std::env::var("GEMINI_API_KEY") else {
        return candidates;
    };
    if api_key.trim().is_empty() || candidates.len() <= 1 {
        return candidates;
    }

    // Keep reranking input bounded for cost and latency.
    let max_candidates = std::env::var("GEMINI_RERANK_CANDIDATE_LIMIT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(30)
        .min(candidates.len());
    let rerank_pool: Vec<Vec<String>> = candidates.iter().take(max_candidates).cloned().collect();
    let candidate_samples: Vec<String> = rerank_pool
        .iter()
        .enumerate()
        .map(|(idx, parts)| format!("{idx}: {}", parts.join(" ")))
        .collect();
    let v7_indices: Vec<usize> = islands
        .iter()
        .enumerate()
        .filter_map(|(idx, _)| (idx % 2 == 1).then_some(idx))
        .collect();
    let synth_v7_index = v7_indices.first().copied();
    let synth_position_options = synth_v7_index
        .map(|idx| collect_position_options(&rerank_pool, idx))
        .unwrap_or_default();
    let json_input = json!({
        "task": "v7_inference_refinement",
        "mode_options": ["rerank", "synthesize"],
        "rules": {
            "output_must_be_json": true,
            "rerank_rule": "Return worthwhile candidates only. If all are bad, keep exactly one best index.",
            "synthesize_rule": "Only use synthesize when one V7 island can be clearly improved from per-position options."
        },
        "islands": islands,
        "v7_island_indices": v7_indices,
        "candidates": candidate_samples,
        "synthesize_context": {
            "v7_index": synth_v7_index,
            "position_options": synth_position_options
        },
        "response_schema": {
            "action": "rerank | synthesize",
            "keep": [0, 1],
            "sentence": "string; required only when action=synthesize"
        }
    });

    let prompt = format!(
        "You are improving Vietnamese inference output.\n\
Choose action rerank or synthesize.\n\
Return strict JSON only using this schema:\n\
{{\"action\":\"rerank\",\"keep\":[...]}} OR {{\"action\":\"synthesize\",\"sentence\":\"...\"}}.\n\
If action=rerank, keep must be unique valid indices in best-first order.\n\
If action=synthesize, sentence must be a single polished Vietnamese sentence for the first V7 island.\n\
Here is the JSON input:\n{}",
        json_input
    );

    let model_name = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-pro".to_string());
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model_name
    );

    let request_body = json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json"
        }
    });

    let client = reqwest::Client::new();
    let timeout_seconds = std::env::var("GEMINI_TIMEOUT_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(20);
    let response = match client
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&request_body)
        .timeout(Duration::from_secs(timeout_seconds))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(err) => {
            eprintln!("Gemini rerank skipped: request failed ({err})");
            return candidates;
        }
    };

    let response_json: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(err) => {
            eprintln!("Gemini rerank skipped: invalid JSON response ({err})");
            return candidates;
        }
    };

    let response_text = response_json
        .get("candidates")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("content"))
        .and_then(|v| v.get("parts"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.get("text"))
        .and_then(|v| v.as_str());

    let Some(response_text) = response_text else {
        eprintln!("Gemini rerank skipped: missing text response");
        return candidates;
    };

    if let Some(decision) = parse_gemini_decision(response_text) {
        if let Some(action) = decision.action.as_deref() {
            if action.eq_ignore_ascii_case("synthesize") {
                if let (Some(v7_index), Some(sentence)) = (synth_v7_index, decision.sentence.as_deref()) {
                    if let Some(synthesized) = apply_synthesized_sentence(&rerank_pool, sentence, v7_index) {
                        return synthesized;
                    }
                }
            } else if action.eq_ignore_ascii_case("rerank") {
                return apply_keep_indices(rerank_pool, &decision.keep);
            }
        } else {
            return apply_keep_indices(rerank_pool, &decision.keep);
        }
    }

    let keep_indices = parse_keep_indices(response_text, rerank_pool.len());
    apply_keep_indices(rerank_pool, &keep_indices)
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

    if let Some(candidates) = maybe_infer_with_gemini(&payload.islands, &state.tokenizer).await {
        return Json(InferResponse { candidates });
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
            if ts.elapsed() < Duration::from_secs(PLOVER_STATUS_CACHE_SECONDS) {
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
            .send(Message::Text(serde_json::to_string(&response).unwrap_or_else(|_| "{\"ok\":false,\"error\":\"Response serialization failed\"}".to_string())))
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
    eprintln!("Loading tokenizer (from structured regex logic)...");
    let tokenizer = Tokenizer::new()?;
    
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

        let practice_page_path = format!("{}/practice.html", args.static_dir);
        let app = Router::new()
            .route("/infer", post(infer_handler))
            .route("/plover/status", get(plover_status_handler))
            .route("/plover/ws", get(plover_ws_handler))
            .route_service("/practice", ServeFile::new(&practice_page_path))
            .route_service("/practice/", ServeFile::new(practice_page_path))
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
        if let Some(candidates) = maybe_infer_with_gemini(&islands, &tokenizer).await {
            let duration = start_time.elapsed();
            if is_islands_mode {
                println!("{}", serde_json::to_string(&candidates)?);
            } else {
                println!("Top results:");
                for (i, parts) in candidates.iter().take(5).enumerate() {
                    println!("{}. {}", i + 1, parts.join(" ").trim());
                }
            }
            println!("\nInference time: {}ms", duration.as_millis());
            return Ok(());
        }

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

#[cfg(test)]
mod tests {
    use super::{
        apply_keep_indices, apply_synthesized_sentence, parse_gemini_decision,
        parse_gemini_inference_decision, parse_keep_indices,
    };

    #[test]
    fn parse_keep_indices_from_json_block() {
        let text = "```json\n{\"keep\":[2,0,2,99]}\n```";
        let parsed = parse_keep_indices(text, 3);
        assert_eq!(parsed, vec![2, 0]);
    }

    #[test]
    fn apply_keep_indices_falls_back_to_first_candidate() {
        let candidates = vec![
            vec!["alpha".to_string()],
            vec!["beta".to_string()],
        ];
        let kept = apply_keep_indices(candidates, &[]);
        assert_eq!(kept, vec![vec!["alpha".to_string()]]);
    }

    #[test]
    fn parse_gemini_decision_supports_synthesize() {
        let text = "{\"action\":\"synthesize\",\"sentence\":\"hôm nay trời đẹp\"}";
        let decision = parse_gemini_decision(text).expect("decision");
        assert_eq!(decision.action.as_deref(), Some("synthesize"));
        assert_eq!(decision.sentence.as_deref(), Some("hôm nay trời đẹp"));
    }

    #[test]
    fn apply_synthesized_sentence_replaces_first_v7_island() {
        let candidates = vec![vec!["".to_string(), "hôm nay trời xấu".to_string()]];
        let applied = apply_synthesized_sentence(&candidates, "hôm nay trời đẹp", 1).expect("applied");
        assert_eq!(applied, vec![vec!["".to_string(), "hôm nay trời đẹp".to_string()]]);
    }

    #[test]
    fn parse_gemini_inference_decision_reads_v7_outputs() {
        let text = "{\"decoded_v7_islands\":[\"hôm nay trời đẹp\",\"bạn có khỏe không\"]}";
        let decision = parse_gemini_inference_decision(text).expect("decision");
        assert_eq!(decision.decoded_v7_islands.len(), 2);
        assert_eq!(decision.decoded_v7_islands[0], "hôm nay trời đẹp");
    }
}
