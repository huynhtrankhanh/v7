#![allow(dead_code)]
use anyhow::Result;
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use clap::Parser;
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tower_http::services::{ServeDir, ServeFile};
use unicode_normalization::UnicodeNormalization;

mod kenlm;
mod plover;
mod regex_enum;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// The V7 string to infer. If not provided and not in server mode, uses a default test string.
    v7_string: Option<String>,

    #[arg(long, default_value = "lm.binary")]
    model_path: String,

    #[arg(long, default_value = "vocab.txt")]
    vocab_path: String,

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
    // Flattened structure to improve cache locality and reduce pointer chasing
    candidates_index: HashMap<(String, char, i32), Vec<Arc<str>>>,
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
        "0", "b", "ch", "d", "g", "h", "k", "kh", "l", "m", "n", "ng", "nh", "p", "ph", "r", "s",
        "t", "th", "tr", "v", "w", "x", "z", "đ",
    ];
    let structured_hard_consonants: HashSet<&str> = HashSet::from([
        "b", "ch", "d", "g", "kh", "ng", "p", "ph", "r", "tr", "x", "đ",
    ]);

    let a = [
        "(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:[ấắ][cpt]|á(?:ch?|[pt]))",
        "(?:[ậặ][cpt]|ạ(?:ch?|[pt]))",
    ];
    let e = [
        "(?:e(?:(?:ng?|[mo]))?|ê(?:(?:nh?|[mu]))?)",
        "(?:é(?:(?:ng?|[mo]))?|ế(?:(?:nh?|[mu]))?)",
        "(?:è(?:(?:ng?|[mo]))?|ề(?:(?:nh?|[mu]))?)",
        "(?:ẻ(?:(?:ng?|[mo]))?|ể(?:(?:nh?|[mu]))?)",
        "(?:ẽ(?:(?:ng?|[mo]))?|ễ(?:(?:nh?|[mu]))?)",
        "(?:ẹ(?:(?:ng?|[mo]))?|ệ(?:(?:nh?|[mu]))?)",
        "(?:é[cpt]|ế(?:ch|[pt]))",
        "(?:ẹ[cpt]|ệ(?:ch|[pt]))",
    ];
    let o = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]|ă(?:m|ng?)|e(?:[no])?|a(?:(?:[imouy]|n(?:[gh])?))?))?)","(?:ớ(?:[imn])?|ố(?:(?:ng?|[im]))?|ó(?:(?:ng?|[aeim]))?|o(?:óng|é[no]|ắ(?:m|ng?)|á(?:[imouy]|n(?:[gh])?)))","(?:ờ(?:[imn])?|ồ(?:(?:ng?|[im]))?|ò(?:(?:ng?|[aeim]))?|o(?:òng|è[no]|ằ(?:m|ng?)|à(?:[imouy]|n(?:[gh])?)))","(?:ở(?:[imn])?|ổ(?:(?:ng?|[im]))?|ỏ(?:(?:ng?|[aeim]))?|o(?:ỏng|ẻ[no]|ẳ(?:m|ng?)|ả(?:[imouy]|n(?:[gh])?)))","(?:ỡ(?:[imn])?|ỗ(?:(?:ng?|[im]))?|õ(?:(?:ng?|[aeim]))?|o(?:õng|ẽ[no]|ẵ(?:m|ng?)|ã(?:[imouy]|n(?:[gh])?)))","(?:ợ(?:[imn])?|ộ(?:(?:ng?|[im]))?|ọ(?:(?:ng?|[aeim]))?|o(?:ọng|ẹ[no]|ặ(?:m|ng?)|ạ(?:[imouy]|n(?:[gh])?)))","(?:ớ[pt]|[óố][cpt]|o(?:ét|óc|ắ[cpt]|á(?:ch?|[pt])))","(?:ợ[pt]|[ọộ][cpt]|o(?:ẹt|ọc|ặ[cpt]|ạ(?:ch?|[pt])))"];
    let u = ["(?:ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?|u(?:(?:ng?|[aim]|ê(?:nh?)?|â(?:y|ng?)|ơ(?:[in])?|ô(?:ng?|[im])|y(?:(?:ên|nh?|[amu]))?))?)","(?:ướ(?:ng?|[imu])|ú(?:(?:ng?|[aimy]))?|ứ(?:(?:ng?|[aimu]))?|u(?:yến|ế(?:nh?)?|ấ(?:y|ng?)|ớ(?:[in])?|ố(?:ng?|[im])|ý(?:nh?|[amu])))","(?:ườ(?:ng?|[imu])|ù(?:(?:ng?|[aimy]))?|ừ(?:(?:ng?|[aimu]))?|u(?:yền|ề(?:nh?)?|ầ(?:y|ng?)|ờ(?:[in])?|ồ(?:ng?|[im])|ỳ(?:nh?|[amu])))","(?:ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aimy]))?|ử(?:(?:ng?|[aimu]))?|u(?:yển|ể(?:nh?)?|ẩ(?:y|ng?)|ở(?:[in])?|ổ(?:ng?|[im])|ỷ(?:nh?|[amu])))","(?:ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aimy]))?|ữ(?:(?:ng?|[aimu]))?|u(?:yễn|ễ(?:nh?)?|ẫ(?:y|ng?)|ỡ(?:[in])?|ỗ(?:ng?|[im])|ỹ(?:nh?|[amu])))","(?:ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aimy]))?|ự(?:(?:ng?|[aimu]))?|u(?:yện|ệ(?:nh?)?|ậ(?:y|ng?)|ợ(?:[in])?|ộ(?:ng?|[im])|ỵ(?:nh?|[amu])))","(?:ướ[cpt]|[úứ][cpt]|u(?:ớt|yết|ấ[ct]|ố[cpt]|ế(?:t|ch)|ý(?:ch|[pt])))","(?:ượ[cpt]|[ụự][cpt]|u(?:ợt|yệt|ậ[ct]|ộ[cpt]|ệ(?:t|ch)|ỵ(?:ch|[pt])))"];
    let iz = [
        "(?:i(?:(?:nh?|[amu]))?|y(?:ê(?:ng?|[mu]))?)",
        "(?:ý|yế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)",
        "(?:ỳ|yề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)",
        "(?:ỷ|yể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)",
        "(?:ỹ|yễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)",
        "(?:ỵ|yệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)",
        "(?:yế[cpt]|í(?:ch|[pt]))",
        "(?:yệ[cpt]|ị(?:ch|[pt]))",
    ];
    let is = [
        "(?:y|i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?)",
        "(?:ý|iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)",
        "(?:ỳ|iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)",
        "(?:ỷ|iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)",
        "(?:ỹ|iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)",
        "(?:ỵ|iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)",
        "(?:iế[cpt]|í(?:ch|[pt]))",
        "(?:iệ[cpt]|ị(?:ch|[pt]))",
    ];
    let ih = [
        "i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?",
        "(?:iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)",
        "(?:iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)",
        "(?:iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)",
        "(?:iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)",
        "(?:iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)",
        "(?:iế[cpt]|í(?:ch|[pt]))",
        "(?:iệ[cpt]|ị(?:ch|[pt]))",
    ];
    let wa = [
        "(?:ă(?:m|ng?)|â(?:y|ng?)|a(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ắ(?:m|ng?)|ấ(?:y|ng?)|á(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ằ(?:m|ng?)|ầ(?:y|ng?)|à(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ẳ(?:m|ng?)|ẩ(?:y|ng?)|ả(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ẵ(?:m|ng?)|ẫ(?:y|ng?)|ã(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ặ(?:m|ng?)|ậ(?:y|ng?)|ạ(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ấ[ct]|ắ[cpt]|á(?:ch?|[pt]))",
        "(?:ậ[ct]|ặ[cpt]|ạ(?:ch?|[pt]))",
    ];
    let we = [
        "(?:ê(?:nh?)?|e(?:[no])?)",
        "(?:ế(?:nh?)?|é(?:[no])?)",
        "(?:ề(?:nh?)?|è(?:[no])?)",
        "(?:ể(?:nh?)?|ẻ(?:[no])?)",
        "(?:ễ(?:nh?)?|ẽ(?:[no])?)",
        "(?:ệ(?:nh?)?|ẹ(?:[no])?)",
        "(?:ét|ế(?:t|ch))",
        "(?:ẹt|ệ(?:t|ch))",
    ];
    let wi = [
        "y(?:(?:ên|nh?|[amu]))?",
        "(?:yến|ý(?:(?:nh?|[amu]))?)",
        "(?:yền|ỳ(?:(?:nh?|[amu]))?)",
        "(?:yển|ỷ(?:(?:nh?|[amu]))?)",
        "(?:yễn|ỹ(?:(?:nh?|[amu]))?)",
        "(?:yện|ỵ(?:(?:nh?|[amu]))?)",
        "(?:yết|ý(?:ch|[pt]))",
        "(?:yệt|ỵ(?:ch|[pt]))",
    ];
    let wo = [
        "(?:ông|ơ(?:[in])?)",
        "(?:ống|ớ(?:[in])?)",
        "(?:ồng|ờ(?:[in])?)",
        "(?:ổng|ở(?:[in])?)",
        "(?:ỗng|ỡ(?:[in])?)",
        "(?:ộng|ợ(?:[in])?)",
        "(?:ốc|ớt)",
        "(?:ộc|ợt)",
    ];
    let ko = [
        "(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)",
        "(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)",
        "(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)",
        "(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)",
        "(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)",
        "(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)",
        "(?:oóc|ớ[pt]|[óố][cpt])",
        "(?:oọc|ợ[pt]|[ọộ][cpt])",
    ];
    let ku = [
        "(?:u(?:(?:ng?|[aim]|ô(?:ng?|[im])))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)",
        "(?:uố(?:ng?|[im])|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)",
        "(?:uồ(?:ng?|[im])|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)",
        "(?:uổ(?:ng?|[im])|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)",
        "(?:uỗ(?:ng?|[im])|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)",
        "(?:uộ(?:ng?|[im])|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)",
        "(?:uố[cpt]|ướ[cpt]|[úứ][cpt])",
        "(?:uộ[cpt]|ượ[cpt]|[ụự][cpt])",
    ];
    let za = [
        "(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)",
        "(?:[ấắ][cpt]|á(?:ch?|[pt]))",
        "(?:[ậặ][cpt]|ạ(?:ch?|[pt]))",
    ];
    let ze = [
        "e(?:(?:ng?|[mo]))?",
        "é(?:(?:ng?|[mo]))?",
        "è(?:(?:ng?|[mo]))?",
        "ẻ(?:(?:ng?|[mo]))?",
        "ẽ(?:(?:ng?|[mo]))?",
        "ẹ(?:(?:ng?|[mo]))?",
        "é[cpt]",
        "ẹ[cpt]",
    ];
    let zo = [
        "(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)",
        "(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)",
        "(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)",
        "(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)",
        "(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)",
        "(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)",
        "(?:oóc|ớ[pt]|[óố][cpt])",
        "(?:oọc|ợ[pt]|[ọộ][cpt])",
    ];
    let zu = [
        "(?:u(?:(?:ng?|[aim]|ô(?:i|ng)))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)",
        "(?:uố(?:i|ng)|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)",
        "(?:uồ(?:i|ng)|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)",
        "(?:uổ(?:i|ng)|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)",
        "(?:uỗ(?:i|ng)|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)",
        "(?:uộ(?:i|ng)|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)",
        "(?:uốc|ướ[cpt]|[úứ][cpt])",
        "(?:uộc|ượ[cpt]|[ụự][cpt])",
    ];
    let zi = [
        "g(?:i(?:[mn])?|iê(?:[mnu]|ng|nh)?)",
        "g(?:í(?:[mn])?|iế(?:[mnu]|ng|nh)?)",
        "g(?:ì(?:[mn])?|iề(?:[mnu]|ng|nh)?)",
        "g(?:ỉ(?:[mn])?|iể(?:[mnu]|ng|nh)?)",
        "g(?:ĩ(?:[mn])?|iễ(?:[mnu]|ng|nh)?)",
        "g(?:ị(?:[mn])?|iệ(?:[mnu]|ng|nh)?)",
        "g(?:í[pt]|iế(?:[cpt]|ch))",
        "g(?:ị[pt]|iệ(?:[cpt]|ch))",
    ];

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
            let mut parts = key.split('_');
            let Some(consonant_part) = parts.next() else { continue; };
            let Some(rime_part) = parts.next() else { continue; };
            let Some(tone_part) = parts.next() else { continue; };
            let Some(rime_start) = rime_part.chars().next() else { continue; };
            let Ok(tone) = tone_part.parse::<i32>() else { continue; };
            let consonant = consonant_part.to_string();

            valid_consonants_map.insert(consonant.clone(), consonant.clone());

            let candidates: Vec<Arc<str>> = regex_enum::enumerate(&regex)
                .into_iter()
                .map(Arc::from)
                .collect();
            
            candidates_index.insert((consonant, rime_start, tone), candidates);
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
    result
        .replace('đ', "d")
        .replace('Đ', "D")
        .replace('y', "i")
        .replace('Y', "I")
}

fn purify(text: &str) -> Vec<String> {
    static NON_LETTER_RE: OnceLock<Regex> = OnceLock::new();
    let non_letter_re = NON_LETTER_RE.get_or_init(|| Regex::new(r"[^\p{L}\s]").unwrap());
    let lower = text.to_lowercase();
    let cleaned = non_letter_re.replace_all(&lower, " ");
    cleaned.split_whitespace().map(|s| s.to_string()).collect()
}

fn normalize_rime_start_char(c: char) -> char {
    let base = c.nfd().find(|ch| !is_combining_mark(*ch)).unwrap_or(c);
    match base {
        'đ' | 'Đ' => 'd',
        'y' | 'Y' => 'i',
        _ => base.to_lowercase().next().unwrap_or(base),
    }
}

// ---------------------------------------------------------------------------
// Unified-slot stream types and helpers
// ---------------------------------------------------------------------------

struct SyllableSlot {
    candidates: Vec<Arc<str>>,
    is_punctuation: bool,
}

fn is_supported_punct(c: char) -> bool {
    matches!(c, '.' | '!' | ',' | ';' | ':')
}

fn is_punct_str(s: &str) -> bool {
    let mut chars = s.chars();
    if let Some(c) = chars.next() {
        chars.next().is_none() && is_supported_punct(c)
    } else {
        false
    }
}

fn fixed_text_to_slots(text: &str) -> Vec<SyllableSlot> {
    let mut slots = Vec::new();
    let mut current_word = String::new();

    for ch in text.to_lowercase().chars() {
        if is_supported_punct(ch) {
            if !current_word.is_empty() {
                slots.push(SyllableSlot {
                    candidates: vec![Arc::from(current_word.as_str())],
                    is_punctuation: false,
                });
                current_word.clear();
            }
            slots.push(SyllableSlot {
                candidates: vec![Arc::from(ch.to_string().as_str())],
                is_punctuation: true,
            });
        } else if ch.is_alphabetic() {
            current_word.push(ch);
        } else {
            if !current_word.is_empty() {
                slots.push(SyllableSlot {
                    candidates: vec![Arc::from(current_word.as_str())],
                    is_punctuation: false,
                });
                current_word.clear();
            }
        }
    }
    if !current_word.is_empty() {
        slots.push(SyllableSlot {
            candidates: vec![Arc::from(current_word.as_str())],
            is_punctuation: false,
        });
    }
    slots
}

fn flatten_islands_to_slots(
    islands: &[String],
    tokenizer: &Tokenizer,
) -> Result<(Vec<SyllableSlot>, Vec<usize>)> {
    let mut slots = Vec::new();
    let mut per_island_slot_counts = Vec::with_capacity(islands.len());
    let strict_alternating = uses_strict_alternating_island_mode(islands, tokenizer);

    for (i, segment) in islands.iter().enumerate() {
        let start = slots.len();
        let is_v7 = if strict_alternating {
            i % 2 == 1
        } else {
            is_v7_segment(segment, tokenizer)
        };

        if is_v7 {
            let templates = parse_v7_string(segment, tokenizer)?;
            for template in templates {
                let candidates = match get_candidates(&template, tokenizer) {
                    Some(list) if !list.is_empty() => list.clone(),
                    _ => vec![],
                };
                slots.push(SyllableSlot {
                    candidates,
                    is_punctuation: false,
                });
            }
        } else {
            slots.extend(fixed_text_to_slots(segment));
        }

        per_island_slot_counts.push(slots.len() - start);
    }

    Ok((slots, per_island_slot_counts))
}

/// Distributes a flat token list back into per-island buckets using slot counts.
/// This safely handles multi-syllable tokens that cross island boundaries by strictly splitting
/// them by syllabus count, preventing overlap printing in consecutive blocks.
fn split_tokens_by_island_counts(
    tokens: &[String],
    per_island_slot_counts: &[usize],
) -> Vec<Vec<String>> {
    let mut result = Vec::with_capacity(per_island_slot_counts.len());
    let mut token_idx = 0;
    let mut current_token_syllables: Vec<String> = Vec::new();
    let mut syl_idx = 0;

    for &count in per_island_slot_counts {
        let mut island_tokens: Vec<String> = Vec::new();
        let mut slots_to_fill = count;

        while slots_to_fill > 0 && (token_idx < tokens.len() || syl_idx < current_token_syllables.len()) {
            if syl_idx >= current_token_syllables.len() {
                current_token_syllables = tokens[token_idx].split('_').map(|s| s.to_string()).collect();
                token_idx += 1;
                syl_idx = 0;
            }

            let remaining_in_token = current_token_syllables.len() - syl_idx;
            let take_count = std::cmp::min(slots_to_fill, remaining_in_token);

            let part = current_token_syllables[syl_idx..syl_idx + take_count].join("_");
            island_tokens.push(part);

            syl_idx += take_count;
            slots_to_fill -= take_count;
        }
        result.push(island_tokens);
    }

    result
}

fn format_output_words(words: &[String]) -> String {
    let mut result = String::new();
    let mut need_space = false;

    for word in words {
        if is_punct_str(word) {
            result.push_str(word);
            need_space = true; 
        } else {
            if need_space || !result.is_empty() {
                result.push(' ');
            }
            result.push_str(&word.replace('_', " "));
            need_space = false;
        }
    }
    result
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
                return Err(anyhow::anyhow!(
                    "Could not parse consonant at: {}",
                    current_slice
                ));
            }
        };

        let mut chars_iter = current_slice.chars();
        let rime_start = chars_iter
            .next()
            .ok_or_else(|| anyhow::anyhow!("Unexpected end looking for rime start"))?;
        current_slice = chars_iter.as_str();

        let mut chars_iter = current_slice.chars();
        let tone_char = chars_iter
            .next()
            .ok_or_else(|| anyhow::anyhow!("Unexpected end looking for tone"))?;
        let tone = tone_char
            .to_digit(10)
            .ok_or_else(|| anyhow::anyhow!("Expected digit for tone, got {}", tone_char))?
            as i32;
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
struct HistoryEntry {
    prev_idx: Option<usize>,
    island_words: Vec<Arc<str>>,
}

#[derive(Debug, Clone)]
struct IslandState {
    score: f32,
    state: kenlm::State,
    history_tail_idx: Option<usize>,
}

#[derive(Debug, Clone)]
struct LatticeNode {
    score: f32,
    state: kenlm::State,
    word: Option<Arc<str>>,
    parent_idx: Option<usize>,
    origin_idx: usize,
}

const KENLM_STATE_KEY_SIZE: usize = 128;
const _: [(); KENLM_STATE_KEY_SIZE] = [(); std::mem::size_of::<kenlm::State>()];

const UNKNOWN_PENALTY: f32 = -10.0;

const UNKNOWN_TOKEN: &str = "<?>"; 

// ---------------------------------------------------------------------------
// Syllable-level vocabulary trie
// ---------------------------------------------------------------------------

#[derive(Default)]
struct TrieNode {
    is_word: bool,
    children: HashMap<String, TrieNode>,
}

struct VocabTrie {
    root: TrieNode,
}

impl VocabTrie {
    fn new() -> Self {
        VocabTrie {
            root: TrieNode::default(),
        }
    }

    fn insert(&mut self, word: &str) {
        let mut node = &mut self.root;
        for syllable in word.split('_') {
            node = node.children.entry(syllable.to_string()).or_default();
        }
        node.is_word = true;
    }

    fn from_vocab_file(path: &str) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("Failed to read vocab file '{}': {}", path, e))?;
        let mut trie = VocabTrie::new();
        for line in content.lines() {
            let word = line.trim();
            if !word.is_empty() {
                trie.insert(word);
            }
        }
        Ok(trie)
    }
}

fn get_candidates<'a>(
    template: &PartialSyllableTemplate,
    tokenizer: &'a Tokenizer,
) -> Option<&'a Vec<Arc<str>>> {
    let norm_rime_start = normalize_rime_start_char(template.rime_first_letter);
    tokenizer
        .candidates_index
        .get(&(template.consonant.clone(), norm_rime_start, template.tone))
}

fn is_v7_segment(segment: &str, tokenizer: &Tokenizer) -> bool {
    !segment.is_empty() && parse_v7_string(segment, tokenizer).is_ok()
}

fn uses_strict_alternating_island_mode(islands: &[String], tokenizer: &Tokenizer) -> bool {
    islands.iter().enumerate().all(|(i, segment)| {
        if i % 2 == 0 {
            !is_v7_segment(segment, tokenizer)
        } else {
            is_v7_segment(segment, tokenizer)
        }
    })
}

fn truncate_top_indices_by_score<F>(indices: &mut Vec<usize>, limit: usize, mut score_of: F)
where
    F: FnMut(usize) -> f32,
{
    indices.sort_by(|a, b| {
        score_of(*b)
            .partial_cmp(&score_of(*a))
            .unwrap_or(Ordering::Equal)
    });
    if indices.len() > limit {
        indices.truncate(limit);
    }
}

fn push_history(
    history_arena: &mut Vec<HistoryEntry>,
    prev_idx: Option<usize>,
    island_words: Vec<Arc<str>>,
) -> Option<usize> {
    history_arena.push(HistoryEntry {
        prev_idx,
        island_words,
    });
    Some(history_arena.len() - 1)
}

fn materialize_history(history_arena: &[HistoryEntry], mut tail_idx: Option<usize>) -> Vec<String> {
    let mut index_chain = Vec::new();
    while let Some(idx) = tail_idx {
        index_chain.push(idx);
        tail_idx = history_arena[idx].prev_idx;
    }
    let mut parts = Vec::with_capacity(index_chain.len());
    for idx in index_chain.into_iter().rev() {
        parts.push(history_arena[idx].island_words.join(" "));
    }
    parts
}

fn enumerate_multi_syllable_words<'v>(
    slots: &[SyllableSlot],
    model: &kenlm::Model,
    vocab: &'v VocabTrie,
) -> Vec<(Arc<str>, u32)> {
    debug_assert!(slots.len() >= 2);

    let mut current: Vec<(Vec<Arc<str>>, &'v TrieNode)> = slots[0]
        .candidates
        .iter()
        .filter_map(|cand| {
            vocab
                .root
                .children
                .get(cand.as_ref())
                .map(|child| (vec![cand.clone()], child))
        })
        .collect();

    for slot in &slots[1..] {
        let mut next: Vec<(Vec<Arc<str>>, &'v TrieNode)> = Vec::new();
        for (path, node) in current {
            for cand in &slot.candidates {
                if let Some(child) = node.children.get(cand.as_ref()) {
                    let mut new_path = path.clone();
                    new_path.push(cand.clone());
                    next.push((new_path, child));
                }
            }
        }
        current = next;
        if current.is_empty() {
            return vec![];
        }
    }

    current
        .into_iter()
        .filter_map(|(path, node)| {
            if node.is_word {
                let word = path.join("_");
                let idx = model.lookup(&word);
                Some((Arc::from(word), idx))
            } else {
                None
            }
        })
        .collect()
}

fn prune_position_nodes(
    nodes_at_pos: &mut Vec<usize>,
    per_state_width: usize,
    nodes: &[LatticeNode],
) {
    if nodes_at_pos.len() <= per_state_width {
        return;
    }
    let mut by_state: HashMap<[u8; KENLM_STATE_KEY_SIZE], Vec<usize>> = HashMap::new();
    for &idx in nodes_at_pos.iter() {
        by_state.entry(nodes[idx].state.data).or_default().push(idx);
    }
    nodes_at_pos.clear();
    for (_, mut indices) in by_state {
        truncate_top_indices_by_score(&mut indices, per_state_width, |idx| nodes[idx].score);
        nodes_at_pos.extend(indices);
    }
}

fn lattice_viterbi_unified(
    slots: &[SyllableSlot],
    model: &kenlm::Model,
    vocab: &VocabTrie,
    incoming_states: &[IslandState],
    per_state_width: usize,
    history_arena: &mut Vec<HistoryEntry>,
) -> Vec<IslandState> {
    const MAX_WORD_SYLLABLES: usize = 5;

    let n = slots.len();
    let mut nodes: Vec<LatticeNode> = Vec::new();
    let mut position_nodes: Vec<Vec<usize>> = vec![Vec::new(); n + 1];

    for (origin_idx, state) in incoming_states.iter().enumerate() {
        nodes.push(LatticeNode {
            score: state.score,
            state: state.state.clone(),
            word: None,
            parent_idx: None,
            origin_idx,
        });
        position_nodes[0].push(nodes.len() - 1);
    }
    prune_position_nodes(&mut position_nodes[0], per_state_width, &nodes);

    for pos in 0..n {
        let parents = position_nodes[pos].clone();
        if parents.is_empty() {
            continue;
        }

        if slots[pos].is_punctuation {
            let punct = slots[pos].candidates[0].clone();
            let punct_idx = model.lookup(punct.as_ref());
            let mut best_for_state: HashMap<[u8; KENLM_STATE_KEY_SIZE], Vec<usize>> =
                HashMap::new();

            for parent_idx in parents {
                let (parent_score, parent_state, parent_origin) = {
                    let n = &nodes[parent_idx];
                    (n.score, n.state.clone(), n.origin_idx)
                };
                let (lm_score, new_state) = model.score_index(&parent_state, punct_idx);
                let state_key = new_state.data;
                nodes.push(LatticeNode {
                    score: parent_score + lm_score,
                    state: new_state,
                    word: Some(punct.clone()),
                    parent_idx: Some(parent_idx),
                    origin_idx: parent_origin,
                });
                let new_idx = nodes.len() - 1;
                let entry = best_for_state.entry(state_key).or_default();
                entry.push(new_idx);
                truncate_top_indices_by_score(entry, per_state_width, |i| nodes[i].score);
            }
            for (_, indices) in best_for_state {
                position_nodes[pos + 1].extend(indices);
            }
            prune_position_nodes(&mut position_nodes[pos + 1], per_state_width, &nodes);
        } else {
            for k in 1..=MAX_WORD_SYLLABLES {
                let end = pos + k;
                if end > n {
                    break;
                }
                if k > 1 && slots[end - 1].is_punctuation {
                    break;
                }

                let word_candidates: Vec<(Option<Arc<str>>, u32)> = if k == 1 {
                    let cands = &slots[pos].candidates;
                    if cands.is_empty() {
                        vec![(None, 0)]
                    } else {
                        cands
                            .iter()
                            .map(|w| (Some(w.clone()), model.lookup(w.as_ref())))
                            .collect()
                    }
                } else {
                    enumerate_multi_syllable_words(&slots[pos..end], model, vocab)
                        .into_iter()
                        .map(|(w, idx)| (Some(w), idx))
                        .collect()
                };

                if word_candidates.is_empty() {
                    continue;
                }

                let mut best_for_state: HashMap<[u8; KENLM_STATE_KEY_SIZE], Vec<usize>> =
                    HashMap::new();

                for &parent_idx in &parents {
                    let (parent_score, parent_state, parent_origin) = {
                        let n = &nodes[parent_idx];
                        (n.score, n.state.clone(), n.origin_idx)
                    };

                    for (word_opt, word_idx) in &word_candidates {
                        let (total_score, new_state) = if word_opt.is_none() {
                            (parent_score + UNKNOWN_PENALTY, parent_state.clone())
                        } else {
                            let (lm_score, ns) = model.score_index(&parent_state, *word_idx);
                            (parent_score + lm_score, ns)
                        };

                        let word_str = word_opt
                            .clone()
                            .unwrap_or_else(|| Arc::from(UNKNOWN_TOKEN));
                        let state_key = new_state.data;

                        nodes.push(LatticeNode {
                            score: total_score,
                            state: new_state,
                            word: Some(word_str),
                            parent_idx: Some(parent_idx),
                            origin_idx: parent_origin,
                        });
                        let new_idx = nodes.len() - 1;
                        let entry = best_for_state.entry(state_key).or_default();
                        entry.push(new_idx);
                        truncate_top_indices_by_score(entry, per_state_width, |i| nodes[i].score);
                    }
                }

                for (_, indices) in best_for_state {
                    position_nodes[end].extend(indices);
                }
            }

            let max_end = (pos + MAX_WORD_SYLLABLES).min(n);
            for end in (pos + 1)..=max_end {
                if !position_nodes[end].is_empty() {
                    prune_position_nodes(&mut position_nodes[end], per_state_width, &nodes);
                }
            }
        }
    }

    let final_nodes = position_nodes[n].clone();
    let mut results = Vec::with_capacity(final_nodes.len());

    for node_idx in final_nodes {
        let node = &nodes[node_idx];

        let mut words = Vec::new();
        let mut cursor = Some(node_idx);
        while let Some(idx) = cursor {
            let n = &nodes[idx];
            if let Some(w) = &n.word {
                words.push(w.clone());
            }
            cursor = n.parent_idx;
        }
        words.reverse();

        let new_history = push_history(
            history_arena,
            incoming_states[node.origin_idx].history_tail_idx,
            words,
        );
        results.push(IslandState {
            score: node.score,
            state: node.state.clone(),
            history_tail_idx: new_history,
        });
    }

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Greater)
    });
    results
}


fn perform_inference(
    islands: &[String],
    tokenizer: &Tokenizer,
    model: &kenlm::Model,
    vocab: &VocabTrie,
    beam_width: usize,
) -> Result<Vec<Vec<String>>> {
    let (slots, per_island_slot_counts) = flatten_islands_to_slots(islands, tokenizer)?;
    let strict_alternating = uses_strict_alternating_island_mode(islands, tokenizer);

    let initial_states = vec![IslandState {
        score: 0.0,
        state: model.begin_sentence_state(),
        history_tail_idx: None,
    }];
    let mut history_arena: Vec<HistoryEntry> = Vec::new();
    let hypotheses_per_state = beam_width.max(1);

    let final_states = lattice_viterbi_unified(
        &slots,
        model,
        vocab,
        &initial_states,
        hypotheses_per_state,
        &mut history_arena,
    );

    let candidates: Vec<Vec<String>> = final_states
        .into_iter()
        .take(beam_width)
        .map(|s| {
            let words = materialize_history(&history_arena, s.history_tail_idx);
            let all_tokens: Vec<String> = words
                .iter()
                .flat_map(|chunk| chunk.split_whitespace().map(|t| t.to_string()))
                .collect();

            let per_island_tokens =
                split_tokens_by_island_counts(&all_tokens, &per_island_slot_counts);

            islands
                .iter()
                .zip(per_island_tokens.iter())
                .enumerate()
                .map(|(i, (island, island_tokens))| {
                    let is_v7 = if strict_alternating {
                        i % 2 == 1
                    } else {
                        is_v7_segment(island, tokenizer)
                    };
                    if is_v7 {
                        format_output_words(island_tokens)
                    } else {
                        island.clone()
                    }
                })
                .collect()
        })
        .collect();

    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::{
        is_v7_segment, truncate_top_indices_by_score, uses_strict_alternating_island_mode,
        Tokenizer,
    };

    #[test]
    fn keeps_best_indices_in_descending_score_order() {
        let scores = vec![0.4, 0.9, 0.6, 1.2, 0.1];
        let mut indices = vec![0, 1, 2, 3, 4];
        truncate_top_indices_by_score(&mut indices, 3, |idx| scores[idx]);
        assert_eq!(indices, vec![3, 1, 2]);
    }

    #[test]
    fn truncates_to_highest_scoring_entries_after_append() {
        let scores = vec![10.0, 8.0, 9.5];
        let mut indices = vec![0, 1];
        truncate_top_indices_by_score(&mut indices, 2, |idx| scores[idx]);
        assert_eq!(indices, vec![0, 1]);

        indices.push(2);
        truncate_top_indices_by_score(&mut indices, 2, |idx| scores[idx]);
        assert_eq!(indices, vec![0, 2]);
    }

    #[test]
    fn detects_parseable_v7_segment() {
        let tokenizer = Tokenizer::new().expect("tokenizer should load");
        assert!(is_v7_segment("tro2", &tokenizer));
        assert!(!is_v7_segment("hôm nay", &tokenizer));
    }

    #[test]
    fn strict_alternating_mode_requires_v7_on_odd_indices() {
        let tokenizer = Tokenizer::new().expect("tokenizer should load");
        let strict = vec![
            "hôm nay ".to_string(),
            "tro2".to_string(),
            " rất ".to_string(),
            "dde7".to_string(),
        ];
        let non_strict = vec!["tro2".to_string(), "dde7".to_string()];

        assert!(uses_strict_alternating_island_mode(&strict, &tokenizer));
        assert!(!uses_strict_alternating_island_mode(
            &non_strict,
            &tokenizer
        ));
    }
}

#[derive(Clone)]
struct PloverConfig {
    host: String,
    port: u16,
}

struct AppState {
    tokenizer: Tokenizer,
    model: kenlm::Model,
    vocab: VocabTrie,
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
    if payload.is_empty() {
        return Json(InferResponse { candidates: vec![] });
    }

    let result = perform_inference(&payload.islands, &state.tokenizer, &state.model, &state.vocab, 100);

    match result {
        Ok(candidates) => Json(InferResponse { candidates }),
        Err(e) => {
            eprintln!("Inference error: {}", e);
            Json(InferResponse { candidates: vec![] })
        }
    }
}

async fn plover_status_handler(State(state): State<Arc<AppState>>) -> Json<PloverStatusResponse> {
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
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Stripped Plover is disabled",
        )
            .into_response();
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
            .send(Message::Text(
                serde_json::to_string(&response).unwrap_or_else(|_| {
                    "{\"ok\":false,\"error\":\"Response serialization failed\"}".to_string()
                }),
            ))
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

    let model = {
        eprintln!("Loading model from {}...", args.model_path);
        kenlm::Model::new(&args.model_path).map_err(|e| anyhow::anyhow!(e))?
    };

    let vocab: VocabTrie = {
        eprintln!("Loading vocabulary from {}...", args.vocab_path);
        VocabTrie::from_vocab_file(&args.vocab_path)?
    };

    if args.server {
        let plover_host = args
            .stripped_plover_host
            .or_else(|| std::env::var("STRIPPED_PLOVER_HOST").ok());
        let plover_port = std::env::var("STRIPPED_PLOVER_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(args.stripped_plover_port);
        let plover = plover_host.map(|host| PloverConfig {
            host,
            port: plover_port,
        });
        let app_state = Arc::new(AppState {
            tokenizer,
            model,
            vocab,
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
        let input = args
            .v7_string
            .unwrap_or_else(|| "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7".to_string());

        let (is_islands_mode, islands) = match serde_json::from_str::<Vec<String>>(&input) {
            Ok(parsed) => {
                eprintln!("Mode: Fixed Text Islands (JSON detected)");
                (true, parsed)
            }
            Err(_) => {
                eprintln!("Mode: Single V7 String (Legacy)");
                (false, vec!["".to_string(), input.clone()])
            }
        };

        if islands.is_empty() {
            eprintln!("Error: Input islands array is empty.");
            return Ok(());
        }

        let start_time = std::time::Instant::now();
        let candidates = perform_inference(&islands, &tokenizer, &model, &vocab, 100)?;
        let duration = start_time.elapsed();

        if is_islands_mode {
            println!("{}", serde_json::to_string(&candidates)?);
        } else {
            println!("Top results:");
            for (i, parts) in candidates.iter().take(5).enumerate() {
                let full_text = parts.join("");
                println!("{}. {}", i + 1, full_text.trim());
            }
        }
        println!("\nInference time: {}ms", duration.as_millis());
    }

    Ok(())
}
