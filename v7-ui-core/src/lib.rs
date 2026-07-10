use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

const CANDIDATE_SECTION_PENALTY: usize = 1;

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IslandType {
    Vietnamese,
    Punctuation,
    Capital,
    Spacing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Island {
    #[serde(rename = "type")]
    pub island_type: IslandType,
    pub value: String,
    #[serde(default, rename = "isV7")]
    pub is_v7: bool,
    #[serde(default, rename = "leftSpace", skip_serializing_if = "is_false")]
    pub left_space: bool,
    #[serde(default, rename = "rightSpace", skip_serializing_if = "is_false")]
    pub right_space: bool,
    #[serde(default, rename = "explicitSpacing", skip_serializing_if = "is_false")]
    pub explicit_spacing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CandidateDiffSectionRole {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDiffSection {
    pub role: CandidateDiffSectionRole,
    pub start: usize,
    pub end: usize,
    pub token_start: usize,
    pub token_end: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDiffPlanCandidateSection {
    pub role: CandidateDiffSectionRole,
    pub text: String,
    pub changes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDiffPlanCandidate {
    pub text: String,
    pub sections: Vec<CandidateDiffPlanCandidateSection>,
    pub changed_roles: Vec<CandidateDiffSectionRole>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDiffPlan {
    pub preview: String,
    pub sections: Vec<CandidateDiffSection>,
    pub candidates: Vec<CandidateDiffPlanCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiecemealSyllableTarget {
    pub island_index: usize,
    pub syllable_index: usize,
    pub text: String,
    pub start: usize,
    pub end: usize,
    #[serde(rename = "isV7")]
    pub is_v7: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSelectionMatch {
    pub candidate_index: usize,
    pub syllable_stroke: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleTextSegment {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub piecemeal_number: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub piecemeal_cursor: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_section: Option<CandidateDiffSectionRole>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleTextGroup {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_section: Option<CandidateDiffSectionRole>,
    pub segments: Vec<VisibleTextSegment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QwertyKeyboardKey {
    pub key: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TargetMarker {
    number: usize,
    cursor: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffToken {
    text: String,
    start: usize,
    end: usize,
    byte_start: usize,
    byte_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffChunk {
    base_start: usize,
    base_end: usize,
    candidate_start: usize,
    candidate_end: usize,
    equal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CandidateTextAlignment {
    candidate_tokens: Vec<DiffToken>,
    chunks: Vec<DiffChunk>,
    changed_intervals: Vec<DiffInterval>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DiffInterval {
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TokenRange {
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RenderedCandidatePart {
    tokens: Vec<DiffToken>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RenderedCandidateWithParts {
    text: String,
    parts: Vec<RenderedCandidatePart>,
}

pub fn build_candidate_diff_plan(
    islands: &[Island],
    candidates: &[Vec<String>],
    limit: usize,
) -> CandidateDiffPlan {
    let visible_candidates: Vec<Vec<String>> = candidates.iter().take(limit).cloned().collect();
    build_structured_candidate_diff_plan(islands, &visible_candidates).unwrap_or_else(|| {
        let candidate_texts: Vec<String> = visible_candidates
            .iter()
            .map(|candidate| render_candidate_text(islands, candidate))
            .collect();
        build_candidate_text_diff_plan(&candidate_texts)
    })
}

pub fn build_candidate_text_diff_plan(candidate_texts: &[String]) -> CandidateDiffPlan {
    let preview = candidate_texts.first().cloned().unwrap_or_default();
    let base_tokens = tokenize_diff_text(&preview, 0, 0);
    let alignments: Vec<CandidateTextAlignment> = candidate_texts
        .iter()
        .map(|text| diff_candidate_text(&preview, text, &base_tokens))
        .collect();
    let sections = choose_candidate_diff_sections(
        &preview,
        &base_tokens,
        &alignments
            .iter()
            .flat_map(|alignment| alignment.changed_intervals.iter().copied())
            .collect::<Vec<_>>(),
    );

    CandidateDiffPlan {
        preview,
        sections: sections.clone(),
        candidates: candidate_texts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                let alignment = &alignments[index];
                let sections_for_candidate: Vec<CandidateDiffPlanCandidateSection> = sections
                    .iter()
                    .map(|section| {
                        let range =
                            get_candidate_token_range_for_section(&alignment.chunks, section);
                        let section_text = slice_token_range(
                            text,
                            &alignment.candidate_tokens,
                            range.start,
                            range.end,
                        );
                        let changes = candidate_changes_section(
                            &alignment.changed_intervals,
                            section,
                            base_tokens.len(),
                        );
                        CandidateDiffPlanCandidateSection {
                            role: section.role,
                            text: if changes {
                                section_text
                            } else {
                                section.text.clone()
                            },
                            changes,
                        }
                    })
                    .collect();
                CandidateDiffPlanCandidate {
                    text: text.clone(),
                    changed_roles: sections_for_candidate
                        .iter()
                        .filter(|section| section.changes)
                        .map(|section| section.role)
                        .collect(),
                    sections: sections_for_candidate,
                }
            })
            .collect(),
    }
}

pub fn map_key_unique(key: &str) -> Option<&'static str> {
    let key = key.to_lowercase();
    match key.as_str() {
        "t" | "g" => Some("-D"),
        "y" | "h" => Some("-Z"),
        "q" => Some("#"),
        "a" => Some("S-"),
        "w" => Some("T-"),
        "s" => Some("K-"),
        "e" => Some("P-"),
        "d" => Some("W-"),
        "r" => Some("H-"),
        "f" => Some("R-"),
        "c" => Some("A"),
        "v" => Some("O"),
        "n" => Some("E"),
        "m" => Some("U"),
        "u" => Some("-F"),
        "j" => Some("-R"),
        "i" => Some("-P"),
        "k" => Some("-B"),
        "o" => Some("-L"),
        "l" => Some("-G"),
        "p" => Some("-T"),
        ";" => Some("-S"),
        " " => Some("*"),
        digit if digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit() => {
            match digit.as_bytes()[0] {
                b'0' => Some("0"),
                b'1' => Some("1"),
                b'2' => Some("2"),
                b'3' => Some("3"),
                b'4' => Some("4"),
                b'5' => Some("5"),
                b'6' => Some("6"),
                b'7' => Some("7"),
                b'8' => Some("8"),
                b'9' => Some("9"),
                _ => None,
            }
        }
        _ => None,
    }
}

pub fn serialize_stroke_keys(stroke_keys: &[String]) -> String {
    const STROKE_ORDER: [&str; 23] = [
        "#", "S-", "T-", "K-", "P-", "W-", "H-", "R-", "A", "O", "*", "E", "U", "-F", "-R", "-P",
        "-B", "-L", "-G", "-T", "-S", "-D", "-Z",
    ];
    const MIDDLE_KEYS: [&str; 5] = ["A", "O", "*", "E", "U"];
    const RIGHT_START: usize = 13;

    let keys: HashSet<&str> = stroke_keys.iter().map(String::as_str).collect();
    let has_middle = MIDDLE_KEYS.iter().any(|key| keys.contains(key));
    let mut stroke = String::new();
    let mut inserted_hyphen = false;

    for (index, key) in STROKE_ORDER.iter().enumerate() {
        if !has_middle && !inserted_hyphen && index >= RIGHT_START && keys.contains(key) {
            stroke.push('-');
            inserted_hyphen = true;
        }
        if keys.contains(key) {
            stroke.push_str(&key.replace('-', ""));
        }
    }

    stroke
}

fn qwerty_key(key: &str, label: &str, width: Option<f32>) -> QwertyKeyboardKey {
    QwertyKeyboardKey {
        key: key.to_string(),
        label: label.to_string(),
        width,
    }
}

pub fn qwerty_keyboard_layout() -> Vec<Vec<QwertyKeyboardKey>> {
    vec![
        "1234567890"
            .chars()
            .map(|ch| qwerty_key(&ch.to_string(), &ch.to_string(), None))
            .collect(),
        "qwertyuiop"
            .chars()
            .map(|ch| qwerty_key(&ch.to_string(), &ch.to_uppercase().to_string(), None))
            .collect(),
        vec![
            qwerty_key("a", "A", None),
            qwerty_key("s", "S", None),
            qwerty_key("d", "D", None),
            qwerty_key("f", "F", None),
            qwerty_key("g", "G", None),
            qwerty_key("h", "H", None),
            qwerty_key("j", "J", None),
            qwerty_key("k", "K", None),
            qwerty_key("l", "L", None),
            qwerty_key(";", ";", None),
            qwerty_key("Enter", "Enter", Some(2.25)),
        ],
        vec![
            qwerty_key("Shift", "Shift", Some(2.25)),
            qwerty_key("z", "Z", None),
            qwerty_key("x", "X", None),
            qwerty_key("c", "C", None),
            qwerty_key("v", "V", None),
            qwerty_key("b", "B", None),
            qwerty_key("n", "N", None),
            qwerty_key("m", "M", None),
            qwerty_key("Shift", "Shift", Some(2.25)),
        ],
        vec![qwerty_key(" ", "Spacebar", Some(7.0))],
    ]
}

pub fn normalize_qwerty_display_key(key: &str, code: &str) -> Option<String> {
    let mapped_code = match code {
        "Space" => Some(" "),
        "Enter" | "NumpadEnter" => Some("Enter"),
        "ShiftLeft" | "ShiftRight" => Some("Shift"),
        "Semicolon" => Some(";"),
        _ => None,
    };
    if let Some(mapped) = mapped_code {
        return Some(mapped.to_string());
    }

    if code.len() == 4 && code.starts_with("Key") && code.as_bytes()[3].is_ascii_uppercase() {
        return Some(code[3..].to_lowercase());
    }
    if code.len() == 6 && code.starts_with("Digit") && code.as_bytes()[5].is_ascii_digit() {
        return Some(code[5..].to_string());
    }

    match key {
        " " | "Spacebar" | "Space" => return Some(" ".to_string()),
        "Enter" => return Some("Enter".to_string()),
        "Shift" => return Some("Shift".to_string()),
        ";" => return Some(";".to_string()),
        _ => {}
    }

    let normalized = key.to_lowercase();
    if normalized.len() == 1 {
        let byte = normalized.as_bytes()[0];
        if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            return Some(normalized);
        }
    }

    None
}

pub fn get_candidate_selection_match(
    stroke: &str,
    candidate_count: usize,
) -> Option<CandidateSelectionMatch> {
    let lone_candidate_index = candidate_selection_index(stroke);
    if let Some(candidate_index) = lone_candidate_index {
        if candidate_index < candidate_count {
            return Some(CandidateSelectionMatch {
                candidate_index,
                syllable_stroke: None,
            });
        }
    }

    for suffix in ["-TS", "-T", "-S", "-D", "-Z"] {
        let right_hand_suffix = &suffix[1..];
        if !stroke.ends_with(right_hand_suffix) {
            continue;
        }
        let syllable_stroke = &stroke[..stroke.len() - right_hand_suffix.len()];
        if syllable_stroke.is_empty() || syllable_stroke.ends_with('-') {
            continue;
        }
        let candidate_index = candidate_selection_index(suffix)?;
        if candidate_index >= candidate_count {
            continue;
        }
        return Some(CandidateSelectionMatch {
            candidate_index,
            syllable_stroke: Some(syllable_stroke.to_string()),
        });
    }

    None
}

pub fn render_visible_text(islands: &[Island], candidates: &[Vec<String>]) -> String {
    if let Some(top_candidate) = candidates.first() {
        return render_candidate_text(islands, top_candidate);
    }

    let mut text = String::new();
    for (index, curr) in islands.iter().enumerate() {
        let prev = if index > 0 {
            islands.get(index - 1)
        } else {
            None
        };
        if should_add_space(prev, Some(curr)) {
            text.push(' ');
        }
        if curr.is_v7 {
            text.push('[');
            text.push_str(&curr.value);
            text.push(']');
        } else {
            text.push_str(&curr.value);
        }
    }
    text
}

pub fn render_visible_text_segments(
    islands: &[Island],
    candidates: &[Vec<String>],
    piecemeal_cursor_index: Option<usize>,
    candidate_sections: &[CandidateDiffSection],
    valid_vietnamese_syllables: &HashSet<String>,
) -> Vec<VisibleTextSegment> {
    let targets = find_piecemeal_syllable_targets(islands, valid_vietnamese_syllables);
    let target_markers: Vec<(PiecemealSyllableTarget, TargetMarker)> = targets
        .into_iter()
        .enumerate()
        .map(|(index, target)| {
            (
                target,
                TargetMarker {
                    number: index + 1,
                    cursor: Some(index) == piecemeal_cursor_index,
                },
            )
        })
        .collect();
    let inferred_v7_parts =
        map_inferred_parts_to_v7_islands(islands, candidates.first().map(Vec::as_slice));

    let mut segments = Vec::new();
    for (index, curr) in islands.iter().enumerate() {
        let prev = if index > 0 {
            islands.get(index - 1)
        } else {
            None
        };
        if should_add_space(prev, Some(curr)) {
            segments.push(plain_segment(" "));
        }

        if curr.is_v7 {
            if let Some(inferred_part) = inferred_v7_parts
                .iter()
                .find(|(island_index, _)| *island_index == index)
                .map(|(_, part)| part.as_str())
            {
                let display_targets = find_inferred_v7_display_targets(inferred_part, curr, index);
                segments.extend(render_island_with_piecemeal_targets(
                    inferred_part,
                    curr,
                    index,
                    &target_markers,
                    valid_vietnamese_syllables,
                    0,
                    Some(&display_targets),
                ));
            } else {
                let rendered_value = format!("[{}]", curr.value);
                segments.extend(render_island_with_piecemeal_targets(
                    &rendered_value,
                    curr,
                    index,
                    &target_markers,
                    valid_vietnamese_syllables,
                    1,
                    None,
                ));
            }
        } else {
            segments.extend(render_island_with_piecemeal_targets(
                &curr.value,
                curr,
                index,
                &target_markers,
                valid_vietnamese_syllables,
                0,
                None,
            ));
        }
    }

    apply_candidate_sections_to_segments(&merge_plain_segments(&segments), candidate_sections)
}

pub fn group_visible_text_segments_by_candidate_section(
    segments: &[VisibleTextSegment],
) -> Vec<VisibleTextGroup> {
    let mut groups: Vec<VisibleTextGroup> = Vec::new();

    for segment in segments {
        if let Some(last) = groups.last_mut() {
            if last.candidate_section == segment.candidate_section {
                last.segments.push(segment.clone());
                continue;
            }
        }

        groups.push(VisibleTextGroup {
            candidate_section: segment.candidate_section,
            segments: vec![segment.clone()],
        });
    }

    groups
}

pub fn convert_islands_for_inference(islands: &[Island]) -> Vec<String> {
    let mut server_islands = Vec::new();
    let mut current_fixed = String::new();

    for (index, curr) in islands.iter().enumerate() {
        let prev = if index > 0 {
            islands.get(index - 1)
        } else {
            None
        };
        if curr.is_v7 {
            if should_add_space(prev, Some(curr)) {
                current_fixed.push(' ');
            }
            server_islands.push(current_fixed);
            current_fixed = String::new();
            server_islands.push(curr.value.clone());
        } else {
            if should_add_space(prev, Some(curr)) {
                current_fixed.push(' ');
            }
            current_fixed.push_str(&curr.value);
        }
    }

    server_islands.push(current_fixed);
    server_islands
}

pub fn get_selected_candidate_text(
    candidates: &[Vec<String>],
    index: usize,
    islands: Option<&[Island]>,
) -> Option<String> {
    let selected = candidates.get(index)?;
    Some(match islands {
        Some(islands) => render_candidate_text(islands, selected),
        None => selected.join(""),
    })
}

pub fn select_candidate_islands(
    candidates: &[Vec<String>],
    index: usize,
    islands: Option<&[Island]>,
) -> Option<Vec<Island>> {
    let chosen_text = get_selected_candidate_text(candidates, index, islands)?;
    Some(vec![Island {
        island_type: IslandType::Vietnamese,
        value: chosen_text,
        is_v7: false,
        left_space: false,
        right_space: false,
        explicit_spacing: false,
    }])
}

pub fn get_piecemeal_entry_index(stroke: &str) -> Option<usize> {
    match stroke {
        "T" | "T-" => Some(0),
        "P" | "P-" => Some(1),
        "H" | "H-" => Some(2),
        "TK" | "TK-" => Some(3),
        "PW" | "PW-" => Some(4),
        "HR" | "HR-" => Some(5),
        "K" | "K-" => Some(6),
        "W" | "W-" => Some(7),
        "R" | "R-" => Some(8),
        _ => None,
    }
}

pub fn get_next_piecemeal_cursor_index(
    current_index: usize,
    next_target_count: usize,
) -> Option<usize> {
    if current_index == 0 {
        return None;
    }
    let next_index = current_index - 1;
    if next_index < next_target_count && next_index < 9 {
        Some(next_index)
    } else {
        None
    }
}

pub fn find_piecemeal_syllable_targets(
    islands: &[Island],
    valid_vietnamese_syllables: &HashSet<String>,
) -> Vec<PiecemealSyllableTarget> {
    let mut targets = Vec::new();
    for (island_index, island) in islands.iter().enumerate() {
        if island.island_type != IslandType::Vietnamese {
            continue;
        }
        if island.is_v7 {
            targets.extend(find_v7_syllables(&island.value, island_index));
        } else {
            targets.extend(find_fixed_vietnamese_syllables(
                &island.value,
                island_index,
                valid_vietnamese_syllables,
            ));
        }
    }
    targets.into_iter().rev().take(9).collect()
}

pub fn replace_piecemeal_syllable(
    islands: &[Island],
    target: &PiecemealSyllableTarget,
    replacement: &str,
) -> Vec<Island> {
    let Some(island) = islands.get(target.island_index) else {
        return islands.to_vec();
    };

    if target.is_v7 {
        let mut next = Vec::new();
        next.extend_from_slice(&islands[..target.island_index]);
        next.extend(split_v7_island_for_replacement(island, target, replacement));
        next.extend_from_slice(&islands[target.island_index + 1..]);
        if next.is_empty() {
            vec![Island {
                island_type: IslandType::Vietnamese,
                value: String::new(),
                is_v7: false,
                left_space: false,
                right_space: false,
                explicit_spacing: false,
            }]
        } else {
            next
        }
    } else {
        let start = utf16_to_byte_index(&island.value, target.start);
        let end = utf16_to_byte_index(&island.value, target.end);
        let mut value = String::new();
        value.push_str(&island.value[..start]);
        value.push_str(replacement);
        value.push_str(&island.value[end..]);
        let mut next = islands.to_vec();
        next[target.island_index] = Island {
            value,
            ..island.clone()
        };
        next
    }
}

fn plain_segment(text: &str) -> VisibleTextSegment {
    VisibleTextSegment {
        text: text.to_string(),
        piecemeal_number: None,
        piecemeal_cursor: None,
        candidate_section: None,
    }
}

fn marked_segment(text: String, marker: TargetMarker) -> VisibleTextSegment {
    VisibleTextSegment {
        text,
        piecemeal_number: Some(marker.number),
        piecemeal_cursor: Some(marker.cursor),
        candidate_section: None,
    }
}

fn target_matches(a: &PiecemealSyllableTarget, b: &PiecemealSyllableTarget) -> bool {
    a.island_index == b.island_index && a.is_v7 == b.is_v7 && a.syllable_index == b.syllable_index
}

fn render_island_with_piecemeal_targets(
    rendered_value: &str,
    island: &Island,
    island_index: usize,
    target_markers: &[(PiecemealSyllableTarget, TargetMarker)],
    valid_vietnamese_syllables: &HashSet<String>,
    offset: usize,
    display_targets: Option<&[PiecemealSyllableTarget]>,
) -> Vec<VisibleTextSegment> {
    if target_markers.is_empty() || island.island_type != IslandType::Vietnamese {
        return vec![plain_segment(rendered_value)];
    }

    let owned_targets;
    let targets = if let Some(display_targets) = display_targets {
        display_targets
    } else if island.is_v7 {
        owned_targets = find_v7_syllables(&island.value, island_index);
        &owned_targets
    } else {
        owned_targets = find_fixed_vietnamese_syllables(
            &island.value,
            island_index,
            valid_vietnamese_syllables,
        );
        &owned_targets
    };

    let active_targets: Vec<(&PiecemealSyllableTarget, TargetMarker)> = targets
        .iter()
        .filter_map(|target| {
            target_markers
                .iter()
                .find(|(candidate, _)| target_matches(candidate, target))
                .map(|(_, marker)| (target, *marker))
        })
        .collect();
    if active_targets.is_empty() {
        return vec![plain_segment(rendered_value)];
    }

    let mut segments = Vec::new();
    let mut cursor = 0;
    for (target, marker) in active_targets {
        let start = target.start + offset;
        let end = target.end + offset;
        if start > cursor {
            segments.push(plain_segment(&slice_utf16(rendered_value, cursor, start)));
        }
        segments.push(marked_segment(
            slice_utf16(rendered_value, start, end),
            marker,
        ));
        cursor = end;
    }
    let rendered_len = utf16_len(rendered_value);
    if cursor < rendered_len {
        segments.push(plain_segment(&slice_utf16(
            rendered_value,
            cursor,
            rendered_len,
        )));
    }
    segments
}

fn merge_plain_segments(segments: &[VisibleTextSegment]) -> Vec<VisibleTextSegment> {
    let mut merged: Vec<VisibleTextSegment> = Vec::new();
    for segment in segments {
        if let Some(last) = merged.last_mut() {
            if last.piecemeal_number.is_none()
                && segment.piecemeal_number.is_none()
                && last.candidate_section == segment.candidate_section
            {
                last.text.push_str(&segment.text);
                continue;
            }
        }
        merged.push(segment.clone());
    }
    merged
}

fn apply_candidate_sections_to_segments(
    segments: &[VisibleTextSegment],
    sections: &[CandidateDiffSection],
) -> Vec<VisibleTextSegment> {
    if sections.is_empty() {
        return segments.to_vec();
    }

    let mut sorted_sections: Vec<&CandidateDiffSection> = sections
        .iter()
        .filter(|section| section.end > section.start)
        .collect();
    sorted_sections.sort_by_key(|section| (section.start, section.end));
    if sorted_sections.is_empty() {
        return segments.to_vec();
    }

    let mut next = Vec::new();
    let mut offset = 0;
    for segment in segments {
        let mut segment_offset = 0;
        let segment_len = utf16_len(&segment.text);
        while segment_offset < segment_len {
            let absolute = offset + segment_offset;
            let section = sorted_sections
                .iter()
                .find(|candidate| absolute >= candidate.start && absolute < candidate.end)
                .copied();
            let next_boundary = section.map(|section| section.end).unwrap_or_else(|| {
                sorted_sections
                    .iter()
                    .find(|candidate| candidate.start > absolute)
                    .map(|candidate| candidate.start)
                    .unwrap_or(usize::MAX)
            });
            let take = (segment_len - segment_offset).min(next_boundary - absolute);
            let mut split = segment.clone();
            split.text = slice_utf16(&segment.text, segment_offset, segment_offset + take);
            if let Some(section) = section {
                split.candidate_section = Some(section.role);
            }
            next.push(split);
            segment_offset += take;
        }
        offset += segment_len;
    }

    merge_plain_segments(&next)
}

fn map_inferred_parts_to_v7_islands(
    islands: &[Island],
    top_candidate: Option<&[String]>,
) -> Vec<(usize, String)> {
    let Some(top_candidate) = top_candidate else {
        return Vec::new();
    };
    let v7_slots = get_v7_candidate_slots(islands);
    let uses_full_alternating_shape = uses_full_alternating_candidate_shape(islands, top_candidate);
    let mut mapped = Vec::new();

    for (v7_index, slot) in v7_slots.iter().enumerate() {
        let inferred = if uses_full_alternating_shape {
            top_candidate.get(slot.full_candidate_index)
        } else {
            top_candidate.get(v7_index)
        };
        if let Some(inferred) = inferred {
            if !inferred.is_empty() {
                mapped.push((slot.island_index, inferred.clone()));
            }
        }
    }
    mapped
}

fn find_inferred_vietnamese_syllables(
    value: &str,
    island_index: usize,
) -> Vec<PiecemealSyllableTarget> {
    let mut targets = Vec::new();
    let mut word_start: Option<(usize, usize)> = None;
    let mut code_unit_index = 0;

    for (byte_index, ch) in value.char_indices() {
        if is_vietnamese_word_char(ch) {
            if word_start.is_none() {
                word_start = Some((byte_index, code_unit_index));
            }
        } else if let Some((start_byte, start_code_units)) = word_start.take() {
            targets.push(PiecemealSyllableTarget {
                island_index,
                syllable_index: targets.len(),
                text: value[start_byte..byte_index].to_string(),
                start: start_code_units,
                end: code_unit_index,
                is_v7: true,
            });
        }
        code_unit_index += ch.len_utf16();
    }

    if let Some((start_byte, start_code_units)) = word_start {
        targets.push(PiecemealSyllableTarget {
            island_index,
            syllable_index: targets.len(),
            text: value[start_byte..].to_string(),
            start: start_code_units,
            end: code_unit_index,
            is_v7: true,
        });
    }
    targets
}

fn find_inferred_v7_display_targets(
    inferred_text: &str,
    island: &Island,
    island_index: usize,
) -> Vec<PiecemealSyllableTarget> {
    let raw_targets = find_v7_syllables(&island.value, island_index);
    let inferred_targets = find_inferred_vietnamese_syllables(inferred_text, island_index);

    inferred_targets
        .into_iter()
        .take(raw_targets.len())
        .enumerate()
        .map(|(index, mut target)| {
            target.syllable_index = index;
            target.is_v7 = true;
            target
        })
        .collect()
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = buildCandidateDiffPlanJson)]
pub fn build_candidate_diff_plan_json(
    islands_json: &str,
    candidates_json: &str,
    limit: usize,
) -> Result<String, JsValue> {
    let islands: Vec<Island> = serde_json::from_str(islands_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    let candidates: Vec<Vec<String>> = serde_json::from_str(candidates_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid candidates JSON: {error}")))?;
    serde_json::to_string(&build_candidate_diff_plan(&islands, &candidates, limit))
        .map_err(|error| JsValue::from_str(&format!("Failed to serialize diff plan: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = buildCandidateTextDiffPlanJson)]
pub fn build_candidate_text_diff_plan_json(candidate_texts_json: &str) -> Result<String, JsValue> {
    let candidate_texts: Vec<String> = serde_json::from_str(candidate_texts_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid candidate text JSON: {error}")))?;
    serde_json::to_string(&build_candidate_text_diff_plan(&candidate_texts))
        .map_err(|error| JsValue::from_str(&format!("Failed to serialize text diff plan: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = mapKeyUnique)]
pub fn map_key_unique_wasm(key: &str) -> Option<String> {
    map_key_unique(key).map(String::from)
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = serializeStrokeKeysJson)]
pub fn serialize_stroke_keys_json(stroke_keys_json: &str) -> Result<String, JsValue> {
    let stroke_keys: Vec<String> = serde_json::from_str(stroke_keys_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid stroke keys JSON: {error}")))?;
    Ok(serialize_stroke_keys(&stroke_keys))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = qwertyKeyboardLayoutJson)]
pub fn qwerty_keyboard_layout_json() -> Result<String, JsValue> {
    serde_json::to_string(&qwerty_keyboard_layout()).map_err(|error| {
        JsValue::from_str(&format!("Failed to serialize keyboard layout: {error}"))
    })
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = normalizeQwertyDisplayKeyJson)]
pub fn normalize_qwerty_display_key_json(key: &str, code: &str) -> Result<String, JsValue> {
    serde_json::to_string(&normalize_qwerty_display_key(key, code)).map_err(|error| {
        JsValue::from_str(&format!(
            "Failed to serialize normalized keyboard key: {error}"
        ))
    })
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = getCandidateSelectionMatchJson)]
pub fn get_candidate_selection_match_json(
    stroke: &str,
    candidate_count: usize,
) -> Result<String, JsValue> {
    serde_json::to_string(&get_candidate_selection_match(stroke, candidate_count)).map_err(
        |error| JsValue::from_str(&format!("Failed to serialize candidate selection: {error}")),
    )
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = renderVisibleTextJson)]
pub fn render_visible_text_json(
    islands_json: &str,
    candidates_json: &str,
) -> Result<String, JsValue> {
    let islands: Vec<Island> = serde_json::from_str(islands_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    let candidates: Vec<Vec<String>> = serde_json::from_str(candidates_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid candidates JSON: {error}")))?;
    Ok(render_visible_text(&islands, &candidates))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = renderVisibleTextSegmentsJson)]
pub fn render_visible_text_segments_json(
    islands_json: &str,
    candidates_json: &str,
    piecemeal_cursor_index_json: &str,
    candidate_sections_json: &str,
    valid_syllables_json: &str,
) -> Result<String, JsValue> {
    let islands: Vec<Island> = serde_json::from_str(islands_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    let candidates: Vec<Vec<String>> = serde_json::from_str(candidates_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid candidates JSON: {error}")))?;
    let piecemeal_cursor_index: Option<usize> =
        serde_json::from_str(piecemeal_cursor_index_json)
            .map_err(|error| JsValue::from_str(&format!("Invalid cursor JSON: {error}")))?;
    let candidate_sections: Vec<CandidateDiffSection> =
        serde_json::from_str(candidate_sections_json)
            .map_err(|error| JsValue::from_str(&format!("Invalid sections JSON: {error}")))?;
    let valid_syllables: HashSet<String> =
        serde_json::from_str::<Vec<String>>(valid_syllables_json)
            .map_err(|error| JsValue::from_str(&format!("Invalid syllables JSON: {error}")))?
            .into_iter()
            .collect();
    serde_json::to_string(&render_visible_text_segments(
        &islands,
        &candidates,
        piecemeal_cursor_index,
        &candidate_sections,
        &valid_syllables,
    ))
    .map_err(|error| JsValue::from_str(&format!("Failed to serialize visible segments: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = groupVisibleTextSegmentsByCandidateSectionJson)]
pub fn group_visible_text_segments_by_candidate_section_json(
    segments_json: &str,
) -> Result<String, JsValue> {
    let segments: Vec<VisibleTextSegment> = serde_json::from_str(segments_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid segments JSON: {error}")))?;
    serde_json::to_string(&group_visible_text_segments_by_candidate_section(&segments))
        .map_err(|error| JsValue::from_str(&format!("Failed to serialize visible groups: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = convertIslandsForInferenceJson)]
pub fn convert_islands_for_inference_json(islands_json: &str) -> Result<String, JsValue> {
    let islands: Vec<Island> = serde_json::from_str(islands_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    serde_json::to_string(&convert_islands_for_inference(&islands)).map_err(|error| {
        JsValue::from_str(&format!("Failed to serialize inference islands: {error}"))
    })
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = getSelectedCandidateTextJson)]
pub fn get_selected_candidate_text_json(
    candidates_json: &str,
    index: usize,
    islands_json: Option<String>,
) -> Result<String, JsValue> {
    let candidates: Vec<Vec<String>> = serde_json::from_str(candidates_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid candidates JSON: {error}")))?;
    let islands = islands_json
        .as_deref()
        .map(serde_json::from_str::<Vec<Island>>)
        .transpose()
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    serde_json::to_string(&get_selected_candidate_text(
        &candidates,
        index,
        islands.as_deref(),
    ))
    .map_err(|error| JsValue::from_str(&format!("Failed to serialize selected candidate: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = selectCandidateIslandsJson)]
pub fn select_candidate_islands_json(
    candidates_json: &str,
    index: usize,
    islands_json: Option<String>,
) -> Result<String, JsValue> {
    let candidates: Vec<Vec<String>> = serde_json::from_str(candidates_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid candidates JSON: {error}")))?;
    let islands = islands_json
        .as_deref()
        .map(serde_json::from_str::<Vec<Island>>)
        .transpose()
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    serde_json::to_string(&select_candidate_islands(
        &candidates,
        index,
        islands.as_deref(),
    ))
    .map_err(|error| JsValue::from_str(&format!("Failed to serialize selected islands: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = getPiecemealEntryIndexJson)]
pub fn get_piecemeal_entry_index_json(stroke: &str) -> Result<String, JsValue> {
    serde_json::to_string(&get_piecemeal_entry_index(stroke)).map_err(|error| {
        JsValue::from_str(&format!("Failed to serialize piecemeal index: {error}"))
    })
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = getNextPiecemealCursorIndexJson)]
pub fn get_next_piecemeal_cursor_index_json(
    current_index: usize,
    next_target_count: usize,
) -> Result<String, JsValue> {
    serde_json::to_string(&get_next_piecemeal_cursor_index(
        current_index,
        next_target_count,
    ))
    .map_err(|error| JsValue::from_str(&format!("Failed to serialize piecemeal cursor: {error}")))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = findPiecemealSyllableTargetsJson)]
pub fn find_piecemeal_syllable_targets_json(
    islands_json: &str,
    valid_syllables_json: &str,
) -> Result<String, JsValue> {
    let islands: Vec<Island> = serde_json::from_str(islands_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    let valid_syllables: HashSet<String> =
        serde_json::from_str::<Vec<String>>(valid_syllables_json)
            .map_err(|error| JsValue::from_str(&format!("Invalid syllables JSON: {error}")))?
            .into_iter()
            .collect();
    serde_json::to_string(&find_piecemeal_syllable_targets(&islands, &valid_syllables)).map_err(
        |error| JsValue::from_str(&format!("Failed to serialize piecemeal targets: {error}")),
    )
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = replacePiecemealSyllableJson)]
pub fn replace_piecemeal_syllable_json(
    islands_json: &str,
    target_json: &str,
    replacement: &str,
) -> Result<String, JsValue> {
    let islands: Vec<Island> = serde_json::from_str(islands_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid islands JSON: {error}")))?;
    let target: PiecemealSyllableTarget = serde_json::from_str(target_json)
        .map_err(|error| JsValue::from_str(&format!("Invalid target JSON: {error}")))?;
    serde_json::to_string(&replace_piecemeal_syllable(&islands, &target, replacement)).map_err(
        |error| JsValue::from_str(&format!("Failed to serialize replacement islands: {error}")),
    )
}

fn should_add_space(prev: Option<&Island>, curr: Option<&Island>) -> bool {
    let Some(prev) = prev else {
        return false;
    };
    let Some(curr) = curr else {
        return false;
    };

    if prev.value.is_empty() && !prev.is_v7 {
        return false;
    }
    if prev.island_type == IslandType::Spacing || curr.island_type == IslandType::Spacing {
        return false;
    }

    if prev.explicit_spacing || curr.explicit_spacing {
        if curr.explicit_spacing {
            return curr.left_space;
        }
        return prev.right_space;
    }

    if curr.island_type == IslandType::Punctuation {
        return false;
    }
    if prev.island_type == IslandType::Punctuation {
        return true;
    }

    if prev.island_type == IslandType::Capital {
        return curr.island_type != IslandType::Capital;
    }

    if prev.island_type == IslandType::Vietnamese {
        return curr.island_type == IslandType::Vietnamese
            || curr.island_type == IslandType::Capital;
    }

    false
}

fn candidate_selection_index(stroke: &str) -> Option<usize> {
    match stroke {
        "-T" => Some(0),
        "-TS" => Some(1),
        "-S" => Some(2),
        "-D" => Some(3),
        "-Z" => Some(4),
        _ => None,
    }
}

fn find_v7_syllables(value: &str, island_index: usize) -> Vec<PiecemealSyllableTarget> {
    const V7_CONSONANT_PREFIXES: [&str; 26] = [
        "dd", "ch", "kh", "ng", "nh", "ph", "th", "tr", "0", "b", "d", "g", "h", "k", "l", "m",
        "n", "p", "r", "s", "t", "v", "w", "x", "z", "đ",
    ];

    let mut targets = Vec::new();
    let mut cursor = 0;
    while cursor < value.len() {
        let start = cursor;
        let consonant = V7_CONSONANT_PREFIXES
            .iter()
            .find(|prefix| value[cursor..].starts_with(**prefix));
        let Some(consonant) = consonant else {
            cursor = next_char_boundary(value, cursor);
            continue;
        };

        cursor += consonant.len();
        let vowel = value[cursor..].chars().next();
        let tone = vowel.and_then(|vowel| value[cursor + vowel.len_utf8()..].chars().next());
        let Some(vowel) = vowel else {
            cursor = next_char_boundary(value, start);
            continue;
        };
        let Some(tone) = tone else {
            cursor = next_char_boundary(value, start);
            continue;
        };
        if !matches!(vowel, 'a' | 'e' | 'i' | 'o' | 'u') || !matches!(tone, '0'..='7') {
            cursor = next_char_boundary(value, start);
            continue;
        }

        let end = cursor + vowel.len_utf8() + tone.len_utf8();
        targets.push(PiecemealSyllableTarget {
            island_index,
            syllable_index: targets.len(),
            text: value[start..end].to_string(),
            start: utf16_len(&value[..start]),
            end: utf16_len(&value[..end]),
            is_v7: true,
        });
        cursor = end;
    }

    targets
}

fn find_fixed_vietnamese_syllables(
    value: &str,
    island_index: usize,
    valid_vietnamese_syllables: &HashSet<String>,
) -> Vec<PiecemealSyllableTarget> {
    let mut targets = Vec::new();
    let mut word_start: Option<(usize, usize)> = None;
    let mut code_unit_index = 0;

    for (byte_index, ch) in value.char_indices() {
        if is_vietnamese_word_char(ch) {
            if word_start.is_none() {
                word_start = Some((byte_index, code_unit_index));
            }
        } else if let Some((start_byte, start_code_units)) = word_start.take() {
            push_fixed_target(
                value,
                island_index,
                start_byte,
                byte_index,
                start_code_units,
                code_unit_index,
                valid_vietnamese_syllables,
                &mut targets,
            );
        }
        code_unit_index += ch.len_utf16();
    }

    if let Some((start_byte, start_code_units)) = word_start {
        push_fixed_target(
            value,
            island_index,
            start_byte,
            value.len(),
            start_code_units,
            code_unit_index,
            valid_vietnamese_syllables,
            &mut targets,
        );
    }

    targets
}

fn push_fixed_target(
    value: &str,
    island_index: usize,
    start_byte: usize,
    end_byte: usize,
    start_code_units: usize,
    end_code_units: usize,
    valid_vietnamese_syllables: &HashSet<String>,
    targets: &mut Vec<PiecemealSyllableTarget>,
) {
    let text = &value[start_byte..end_byte];
    if !valid_vietnamese_syllables.contains(&text.to_lowercase()) {
        return;
    }
    targets.push(PiecemealSyllableTarget {
        island_index,
        syllable_index: targets.len(),
        text: text.to_string(),
        start: start_code_units,
        end: end_code_units,
        is_v7: false,
    });
}

fn split_v7_island_for_replacement(
    island: &Island,
    target: &PiecemealSyllableTarget,
    replacement: &str,
) -> Vec<Island> {
    let start = utf16_to_byte_index(&island.value, target.start);
    let end = utf16_to_byte_index(&island.value, target.end);
    let mut pieces = Vec::new();
    let before = &island.value[..start];
    let after = &island.value[end..];
    if !before.is_empty() {
        pieces.push(Island {
            value: before.to_string(),
            ..island.clone()
        });
    }
    pieces.push(Island {
        island_type: IslandType::Vietnamese,
        value: replacement.to_string(),
        is_v7: false,
        left_space: false,
        right_space: false,
        explicit_spacing: false,
    });
    if !after.is_empty() {
        pieces.push(Island {
            value: after.to_string(),
            ..island.clone()
        });
    }
    pieces
}

fn is_vietnamese_word_char(ch: char) -> bool {
    ch.is_alphabetic()
        || matches!(
            ch as u32,
            0x0300..=0x036F | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F
        )
}

fn next_char_boundary(value: &str, index: usize) -> usize {
    value[index..]
        .chars()
        .next()
        .map(|ch| index + ch.len_utf8())
        .unwrap_or(value.len())
}

fn render_candidate_text(islands: &[Island], top_candidate: &[String]) -> String {
    if uses_full_alternating_candidate_shape(islands, top_candidate) {
        return top_candidate.join("");
    }

    let mut text = String::new();
    let mut v7_part_index = 0;
    for (index, curr) in islands.iter().enumerate() {
        let prev = if index > 0 {
            islands.get(index - 1)
        } else {
            None
        };
        if should_add_space(prev, Some(curr)) {
            text.push(' ');
        }
        if curr.is_v7 {
            if let Some(part) = top_candidate.get(v7_part_index) {
                text.push_str(part);
            } else {
                text.push('[');
                text.push_str(&curr.value);
                text.push(']');
            }
            v7_part_index += 1;
        } else {
            text.push_str(&curr.value);
        }
    }
    text
}

fn build_structured_candidate_diff_plan(
    islands: &[Island],
    candidates: &[Vec<String>],
) -> Option<CandidateDiffPlan> {
    if candidates.is_empty() {
        return Some(build_candidate_text_diff_plan(&[]));
    }

    let rendered_candidates: Vec<RenderedCandidateWithParts> = candidates
        .iter()
        .map(|candidate| render_candidate_with_v7_parts(islands, candidate))
        .collect();
    let preview = rendered_candidates.first()?.text.clone();
    let base_parts = &rendered_candidates.first()?.parts;
    if base_parts.is_empty() {
        return None;
    }
    if !rendered_candidates
        .iter()
        .all(|candidate| candidate.parts.len() == base_parts.len())
    {
        return None;
    }

    let base_tokens: Vec<DiffToken> = base_parts
        .iter()
        .flat_map(|part| part.tokens.iter().cloned())
        .collect();
    let alignments: Vec<CandidateTextAlignment> = rendered_candidates
        .iter()
        .map(|candidate| diff_candidate_parts(base_parts, &candidate.parts))
        .collect();
    let sections = choose_candidate_diff_sections(
        &preview,
        &base_tokens,
        &alignments
            .iter()
            .flat_map(|alignment| alignment.changed_intervals.iter().copied())
            .collect::<Vec<_>>(),
    );

    Some(CandidateDiffPlan {
        preview,
        sections: sections.clone(),
        candidates: rendered_candidates
            .iter()
            .enumerate()
            .map(|(index, candidate)| {
                let alignment = &alignments[index];
                let sections_for_candidate: Vec<CandidateDiffPlanCandidateSection> = sections
                    .iter()
                    .map(|section| {
                        let range =
                            get_candidate_token_range_for_section(&alignment.chunks, section);
                        let section_text = slice_token_range(
                            &candidate.text,
                            &alignment.candidate_tokens,
                            range.start,
                            range.end,
                        );
                        let changes = candidate_changes_section(
                            &alignment.changed_intervals,
                            section,
                            base_tokens.len(),
                        );
                        CandidateDiffPlanCandidateSection {
                            role: section.role,
                            text: if changes {
                                section_text
                            } else {
                                section.text.clone()
                            },
                            changes,
                        }
                    })
                    .collect();
                CandidateDiffPlanCandidate {
                    text: candidate.text.clone(),
                    changed_roles: sections_for_candidate
                        .iter()
                        .filter(|section| section.changes)
                        .map(|section| section.role)
                        .collect(),
                    sections: sections_for_candidate,
                }
            })
            .collect(),
    })
}

fn render_candidate_with_v7_parts(
    islands: &[Island],
    candidate: &[String],
) -> RenderedCandidateWithParts {
    if uses_full_alternating_candidate_shape(islands, candidate) {
        return render_full_shape_candidate_with_v7_parts(islands, candidate);
    }

    let mut parts = Vec::new();
    let mut text = String::new();
    let mut v7_part_index = 0;
    for (index, curr) in islands.iter().enumerate() {
        let prev = if index > 0 {
            islands.get(index - 1)
        } else {
            None
        };
        if should_add_space(prev, Some(curr)) {
            text.push(' ');
        }

        if curr.is_v7 {
            let part_text = candidate
                .get(v7_part_index)
                .cloned()
                .unwrap_or_else(|| format!("[{}]", curr.value));
            let start_code_units = utf16_len(&text);
            let start_bytes = text.len();
            text.push_str(&part_text);
            parts.push(RenderedCandidatePart {
                tokens: tokenize_diff_text(&part_text, start_code_units, start_bytes),
            });
            v7_part_index += 1;
        } else {
            text.push_str(&curr.value);
        }
    }

    RenderedCandidateWithParts { text, parts }
}

fn render_full_shape_candidate_with_v7_parts(
    islands: &[Island],
    candidate: &[String],
) -> RenderedCandidateWithParts {
    let mut parts = Vec::new();
    let v7_slots = get_v7_candidate_slots(islands);
    let mut text = String::new();

    for (candidate_index, part_text) in candidate.iter().enumerate() {
        let start_code_units = utf16_len(&text);
        let start_bytes = text.len();
        text.push_str(part_text);
        if v7_slots
            .iter()
            .any(|slot| slot.full_candidate_index == candidate_index)
        {
            parts.push(RenderedCandidatePart {
                tokens: tokenize_diff_text(part_text, start_code_units, start_bytes),
            });
        }
    }

    RenderedCandidateWithParts { text, parts }
}

fn diff_candidate_parts(
    base_parts: &[RenderedCandidatePart],
    candidate_parts: &[RenderedCandidatePart],
) -> CandidateTextAlignment {
    let candidate_tokens: Vec<DiffToken> = candidate_parts
        .iter()
        .flat_map(|part| part.tokens.iter().cloned())
        .collect();
    let mut chunks = Vec::new();
    let mut changed_intervals = Vec::new();
    let mut base_offset = 0;
    let mut candidate_offset = 0;

    for (base_part, candidate_part) in base_parts.iter().zip(candidate_parts.iter()) {
        let base_values: Vec<String> = base_part
            .tokens
            .iter()
            .map(|token| token.text.clone())
            .collect();
        let candidate_values: Vec<String> = candidate_part
            .tokens
            .iter()
            .map(|token| token.text.clone())
            .collect();
        let part_chunks = diff_token_values(
            &base_values,
            &candidate_values,
            base_offset,
            candidate_offset,
        );

        for chunk in part_chunks {
            if !chunk.equal
                && (chunk.base_start != chunk.base_end
                    || chunk.candidate_start != chunk.candidate_end)
            {
                changed_intervals.push(DiffInterval {
                    start: chunk.base_start,
                    end: chunk.base_end,
                });
            }
            push_diff_chunk(&mut chunks, chunk);
        }

        base_offset += base_part.tokens.len();
        candidate_offset += candidate_part.tokens.len();
    }

    CandidateTextAlignment {
        candidate_tokens,
        chunks,
        changed_intervals,
    }
}

fn diff_candidate_text(
    preview: &str,
    candidate: &str,
    base_tokens: &[DiffToken],
) -> CandidateTextAlignment {
    let candidate_tokens = tokenize_diff_text(candidate, 0, 0);
    if preview == candidate {
        let candidate_token_count = candidate_tokens.len();
        return CandidateTextAlignment {
            candidate_tokens,
            chunks: vec![DiffChunk {
                base_start: 0,
                base_end: base_tokens.len(),
                candidate_start: 0,
                candidate_end: candidate_token_count,
                equal: true,
            }],
            changed_intervals: vec![],
        };
    }

    let base_values: Vec<String> = base_tokens.iter().map(|token| token.text.clone()).collect();
    let candidate_values: Vec<String> = candidate_tokens
        .iter()
        .map(|token| token.text.clone())
        .collect();
    let chunks = diff_token_values(&base_values, &candidate_values, 0, 0);
    let changed_intervals = chunks
        .iter()
        .filter(|chunk| {
            !chunk.equal
                && (chunk.base_start != chunk.base_end
                    || chunk.candidate_start != chunk.candidate_end)
        })
        .map(|chunk| DiffInterval {
            start: chunk.base_start,
            end: chunk.base_end,
        })
        .collect();

    CandidateTextAlignment {
        candidate_tokens,
        chunks,
        changed_intervals,
    }
}

fn tokenize_diff_text(text: &str, code_unit_offset: usize, byte_offset: usize) -> Vec<DiffToken> {
    let mut tokens = Vec::new();
    let mut token_start: Option<(usize, usize)> = None;
    let mut code_unit_index = 0;

    for (index, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if let Some((byte_start, code_unit_start)) = token_start.take() {
                tokens.push(DiffToken {
                    text: text[byte_start..index].to_string(),
                    start: code_unit_offset + code_unit_start,
                    end: code_unit_offset + code_unit_index,
                    byte_start: byte_offset + byte_start,
                    byte_end: byte_offset + index,
                });
            }
        } else if token_start.is_none() {
            token_start = Some((index, code_unit_index));
        }
        code_unit_index += ch.len_utf16();
    }

    if let Some((byte_start, code_unit_start)) = token_start {
        tokens.push(DiffToken {
            text: text[byte_start..].to_string(),
            start: code_unit_offset + code_unit_start,
            end: code_unit_offset + code_unit_index,
            byte_start: byte_offset + byte_start,
            byte_end: byte_offset + text.len(),
        });
    }

    tokens
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn utf16_to_byte_index(text: &str, target_code_units: usize) -> usize {
    if target_code_units == 0 {
        return 0;
    }

    let mut code_units = 0;
    for (byte_index, ch) in text.char_indices() {
        if code_units >= target_code_units {
            return byte_index;
        }
        code_units += ch.len_utf16();
    }

    text.len()
}

fn slice_utf16(text: &str, start: usize, end: usize) -> String {
    let start_byte = utf16_to_byte_index(text, start);
    let end_byte = utf16_to_byte_index(text, end);
    text[start_byte..end_byte].to_string()
}

fn diff_token_values(
    base_values: &[String],
    candidate_values: &[String],
    base_offset: usize,
    candidate_offset: usize,
) -> Vec<DiffChunk> {
    let (prefix, base_end, candidate_end) = find_common_token_edges(base_values, candidate_values);
    let mut chunks = Vec::new();
    push_diff_chunk(
        &mut chunks,
        DiffChunk {
            base_start: base_offset,
            base_end: base_offset + prefix,
            candidate_start: candidate_offset,
            candidate_end: candidate_offset + prefix,
            equal: true,
        },
    );

    let base_middle_length = base_end - prefix;
    let candidate_middle_length = candidate_end - prefix;
    let paired_middle_length = base_middle_length.min(candidate_middle_length);
    for i in 0..paired_middle_length {
        let base_index = prefix + i;
        let candidate_index = prefix + i;
        push_diff_chunk(
            &mut chunks,
            DiffChunk {
                base_start: base_offset + base_index,
                base_end: base_offset + base_index + 1,
                candidate_start: candidate_offset + candidate_index,
                candidate_end: candidate_offset + candidate_index + 1,
                equal: base_values[base_index] == candidate_values[candidate_index],
            },
        );
    }

    push_diff_chunk(
        &mut chunks,
        DiffChunk {
            base_start: base_offset + prefix + paired_middle_length,
            base_end: base_offset + base_end,
            candidate_start: candidate_offset + prefix + paired_middle_length,
            candidate_end: candidate_offset + candidate_end,
            equal: false,
        },
    );
    push_diff_chunk(
        &mut chunks,
        DiffChunk {
            base_start: base_offset + base_end,
            base_end: base_offset + base_values.len(),
            candidate_start: candidate_offset + candidate_end,
            candidate_end: candidate_offset + candidate_values.len(),
            equal: true,
        },
    );

    chunks
}

fn find_common_token_edges(
    base_values: &[String],
    candidate_values: &[String],
) -> (usize, usize, usize) {
    let mut prefix = 0;
    while prefix < base_values.len()
        && prefix < candidate_values.len()
        && base_values[prefix] == candidate_values[prefix]
    {
        prefix += 1;
    }

    let mut base_end = base_values.len();
    let mut candidate_end = candidate_values.len();
    while base_end > prefix
        && candidate_end > prefix
        && base_values[base_end - 1] == candidate_values[candidate_end - 1]
    {
        base_end -= 1;
        candidate_end -= 1;
    }

    (prefix, base_end, candidate_end)
}

fn push_diff_chunk(chunks: &mut Vec<DiffChunk>, chunk: DiffChunk) {
    if chunk.base_start == chunk.base_end && chunk.candidate_start == chunk.candidate_end {
        return;
    }

    if let Some(last) = chunks.last_mut() {
        if last.equal == chunk.equal
            && last.base_end == chunk.base_start
            && last.candidate_end == chunk.candidate_start
        {
            last.base_end = chunk.base_end;
            last.candidate_end = chunk.candidate_end;
            return;
        }
    }

    chunks.push(chunk);
}

fn choose_candidate_diff_sections(
    preview: &str,
    base_tokens: &[DiffToken],
    intervals: &[DiffInterval],
) -> Vec<CandidateDiffSection> {
    if base_tokens.is_empty() || intervals.is_empty() {
        return vec![];
    }

    let normalized: Vec<DiffInterval> = intervals
        .iter()
        .map(|interval| normalize_diff_interval(*interval, base_tokens.len()))
        .filter(|interval| interval.end > interval.start)
        .collect();
    let changed_runs = merge_changed_token_intervals(&normalized);
    if changed_runs.is_empty() {
        return vec![];
    }

    let mut best_groups = vec![make_section_range(&changed_runs, 0, changed_runs.len() - 1)];
    let mut best_score = score_section_ranges(&best_groups, base_tokens);

    for split in 1..changed_runs.len() {
        let groups = vec![
            make_section_range(&changed_runs, 0, split - 1),
            make_section_range(&changed_runs, split, changed_runs.len() - 1),
        ];
        let score = score_section_ranges(&groups, base_tokens);
        if score <= best_score {
            best_score = score;
            best_groups = groups;
        }
    }

    best_groups
        .iter()
        .enumerate()
        .map(|(index, range)| CandidateDiffSection {
            role: if index == 0 {
                CandidateDiffSectionRole::Left
            } else {
                CandidateDiffSectionRole::Right
            },
            start: base_tokens
                .get(range.start)
                .map(|token| token.start)
                .unwrap_or(preview.len()),
            end: range
                .end
                .checked_sub(1)
                .and_then(|token_index| base_tokens.get(token_index))
                .map(|token| token.end)
                .unwrap_or(preview.len()),
            token_start: range.start,
            token_end: range.end,
            text: slice_token_range(preview, base_tokens, range.start, range.end),
        })
        .collect()
}

fn normalize_diff_interval(interval: DiffInterval, base_token_count: usize) -> DiffInterval {
    if interval.start < interval.end {
        return interval;
    }
    if interval.start < base_token_count {
        return DiffInterval {
            start: interval.start,
            end: interval.start + 1,
        };
    }
    if interval.start > 0 {
        return DiffInterval {
            start: interval.start - 1,
            end: interval.start,
        };
    }
    DiffInterval { start: 0, end: 0 }
}

fn merge_changed_token_intervals(intervals: &[DiffInterval]) -> Vec<DiffInterval> {
    if intervals.is_empty() {
        return vec![];
    }

    let mut sorted = intervals.to_vec();
    sorted.sort_by(|a, b| a.start.cmp(&b.start).then(a.end.cmp(&b.end)));
    let mut merged: Vec<DiffInterval> = Vec::new();

    for interval in sorted {
        if let Some(last) = merged.last_mut() {
            if interval.start <= last.end {
                last.end = last.end.max(interval.end);
                continue;
            }
        }
        merged.push(interval);
    }

    merged
}

fn make_section_range(
    intervals: &[DiffInterval],
    start_index: usize,
    end_index: usize,
) -> TokenRange {
    TokenRange {
        start: intervals[start_index].start,
        end: intervals[end_index].end,
    }
}

fn score_section_ranges(ranges: &[TokenRange], tokens: &[DiffToken]) -> usize {
    ranges
        .iter()
        .fold(ranges.len() * CANDIDATE_SECTION_PENALTY, |sum, range| {
            let start = tokens
                .get(range.start)
                .map(|token| token.start)
                .unwrap_or(0);
            let end = range
                .end
                .checked_sub(1)
                .and_then(|token_index| tokens.get(token_index))
                .map(|token| token.end)
                .unwrap_or(start);
            sum + end.saturating_sub(start)
        })
}

fn get_candidate_token_range_for_section(
    chunks: &[DiffChunk],
    section: &CandidateDiffSection,
) -> TokenRange {
    let start = map_base_boundary_to_candidate(chunks, section.token_start, BoundarySide::Start);
    let end = map_base_boundary_to_candidate(chunks, section.token_end, BoundarySide::End);
    TokenRange {
        start: start.min(end),
        end: start.max(end),
    }
}

#[derive(Debug, Clone, Copy)]
enum BoundarySide {
    Start,
    End,
}

fn map_base_boundary_to_candidate(
    chunks: &[DiffChunk],
    boundary: usize,
    side: BoundarySide,
) -> usize {
    if let Some(insertion) = chunks.iter().find(|chunk| {
        !chunk.equal
            && chunk.base_start == boundary
            && chunk.base_end == boundary
            && chunk.candidate_start != chunk.candidate_end
    }) {
        return match side {
            BoundarySide::Start => insertion.candidate_start,
            BoundarySide::End => insertion.candidate_end,
        };
    }

    for chunk in chunks {
        if boundary == chunk.base_start {
            return chunk.candidate_start;
        }
        if boundary == chunk.base_end {
            return chunk.candidate_end;
        }
        if boundary > chunk.base_start && boundary < chunk.base_end {
            if chunk.equal {
                return chunk.candidate_start + (boundary - chunk.base_start);
            }
            let base_length = chunk.base_end - chunk.base_start;
            let candidate_length = chunk.candidate_end - chunk.candidate_start;
            if base_length > 0 && candidate_length > 0 {
                let offset = boundary - chunk.base_start;
                return chunk.candidate_start
                    + ((offset * candidate_length) + (base_length / 2)) / base_length;
            }
            return match side {
                BoundarySide::Start => chunk.candidate_start,
                BoundarySide::End => chunk.candidate_end,
            };
        }
    }

    chunks.last().map(|chunk| chunk.candidate_end).unwrap_or(0)
}

fn candidate_changes_section(
    intervals: &[DiffInterval],
    section: &CandidateDiffSection,
    base_token_count: usize,
) -> bool {
    intervals.iter().any(|interval| {
        let normalized = normalize_diff_interval(*interval, base_token_count);
        normalized.start < section.token_end && normalized.end > section.token_start
    })
}

fn slice_token_range(text: &str, tokens: &[DiffToken], start: usize, end: usize) -> String {
    if start >= end {
        return String::new();
    }
    let start_byte = tokens
        .get(start)
        .map(|token| token.byte_start)
        .or_else(|| {
            tokens
                .get(end.saturating_sub(1))
                .map(|token| token.byte_end)
        })
        .unwrap_or(text.len());
    let end_byte = tokens
        .get(end.saturating_sub(1))
        .map(|token| token.byte_end)
        .unwrap_or(start_byte);
    text[start_byte..end_byte].to_string()
}

#[derive(Debug, Clone, Copy)]
struct V7CandidateSlot {
    island_index: usize,
    full_candidate_index: usize,
}

fn get_v7_candidate_slots(islands: &[Island]) -> Vec<V7CandidateSlot> {
    let mut v7_slots = Vec::new();
    let mut candidate_part_index = 0;
    for (island_index, island) in islands.iter().enumerate() {
        if !island.is_v7 {
            continue;
        }
        v7_slots.push(V7CandidateSlot {
            island_index,
            full_candidate_index: candidate_part_index + 1,
        });
        candidate_part_index += 2;
    }
    v7_slots
}

fn uses_full_alternating_candidate_shape(islands: &[Island], top_candidate: &[String]) -> bool {
    let last_full_candidate_index = get_v7_candidate_slots(islands)
        .last()
        .map(|slot| slot.full_candidate_index);
    last_full_candidate_index
        .map(|index| top_candidate.len() > index)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vietnamese(value: &str) -> Island {
        Island {
            island_type: IslandType::Vietnamese,
            value: value.to_string(),
            is_v7: false,
            left_space: false,
            right_space: false,
            explicit_spacing: false,
        }
    }

    fn v7(value: &str) -> Island {
        Island {
            is_v7: true,
            ..vietnamese(value)
        }
    }

    fn punctuation(value: &str) -> Island {
        Island {
            island_type: IslandType::Punctuation,
            value: value.to_string(),
            is_v7: false,
            left_space: false,
            right_space: false,
            explicit_spacing: false,
        }
    }

    fn section_summary(plan: &CandidateDiffPlan) -> Vec<(CandidateDiffSectionRole, String)> {
        plan.sections
            .iter()
            .map(|section| (section.role, section.text.clone()))
            .collect()
    }

    #[test]
    fn uses_zero_sections_when_visible_candidates_do_not_differ() {
        let plan = build_candidate_text_diff_plan(&[
            "ta mà ca trời mắm".to_string(),
            "ta mà ca trời mắm".to_string(),
        ]);

        assert_eq!(plan.sections, vec![]);
        assert_eq!(
            plan.candidates[0].changed_roles,
            Vec::<CandidateDiffSectionRole>::new()
        );
        assert_eq!(
            plan.candidates[1].changed_roles,
            Vec::<CandidateDiffSectionRole>::new()
        );
    }

    #[test]
    fn uses_one_section_for_single_differing_range() {
        let plan = build_candidate_text_diff_plan(&[
            "ta mà ca trời mắm".to_string(),
            "ta mà ca trời mắng".to_string(),
            "ta mà ca trời mắn".to_string(),
        ]);

        assert_eq!(
            section_summary(&plan),
            vec![(CandidateDiffSectionRole::Left, "mắm".to_string())]
        );
        assert_eq!(plan.candidates[1].sections[0].text, "mắng");
        assert!(plan.candidates[1].sections[0].changes);
    }

    #[test]
    fn uses_two_sections_when_differences_are_separated() {
        let plan = build_candidate_text_diff_plan(&[
            "alpha beta keep delta omega".to_string(),
            "alpha x keep delta omega".to_string(),
            "alpha beta keep y omega".to_string(),
            "alpha x keep y omega".to_string(),
        ]);

        assert_eq!(
            section_summary(&plan),
            vec![
                (CandidateDiffSectionRole::Left, "beta".to_string()),
                (CandidateDiffSectionRole::Right, "delta".to_string()),
            ]
        );
        assert_eq!(
            plan.candidates
                .iter()
                .map(|candidate| candidate.changed_roles.clone())
                .collect::<Vec<_>>(),
            vec![
                vec![],
                vec![CandidateDiffSectionRole::Left],
                vec![CandidateDiffSectionRole::Right],
                vec![
                    CandidateDiffSectionRole::Left,
                    CandidateDiffSectionRole::Right
                ],
            ]
        );
    }

    #[test]
    fn uses_one_section_for_adjacent_changed_positions() {
        let plan = build_candidate_text_diff_plan(&[
            "alpha beta gamma delta".to_string(),
            "x beta gamma delta".to_string(),
            "alpha y gamma delta".to_string(),
            "alpha beta z delta".to_string(),
        ]);

        assert_eq!(
            section_summary(&plan),
            vec![(
                CandidateDiffSectionRole::Left,
                "alpha beta gamma".to_string()
            )]
        );
    }

    #[test]
    fn uses_v7_candidate_parts_for_replacement_only_candidate_sections() {
        let fixed_context = (0..200).map(|_| "giữ").collect::<Vec<_>>().join(" ");
        let islands = vec![
            vietnamese(&fixed_context),
            v7("tro2ma1"),
            vietnamese(&fixed_context),
            v7("ko0"),
        ];
        let candidates = vec![
            vec!["trời mà".to_string(), "không".to_string()],
            vec!["dời mà".to_string(), "không".to_string()],
            vec!["trời mà".to_string(), "công".to_string()],
            vec!["dời mà".to_string(), "công".to_string()],
        ];
        let plan = build_candidate_diff_plan(&islands, &candidates, 5);

        assert_eq!(
            section_summary(&plan),
            vec![
                (CandidateDiffSectionRole::Left, "trời".to_string()),
                (CandidateDiffSectionRole::Right, "không".to_string()),
            ]
        );
        assert_eq!(plan.candidates[3].sections[0].text, "dời");
        assert_eq!(plan.candidates[3].sections[1].text, "công");
    }

    #[test]
    fn uses_v7_candidate_parts_for_full_shape_candidate_sections() {
        let islands = vec![
            vietnamese("tôi"),
            v7("tro2ma1"),
            vietnamese("ăn"),
            v7("ko0"),
            punctuation("."),
        ];
        let candidates = vec![
            vec!["tôi ", "trời mà", " ăn ", "không", "."],
            vec!["tôi ", "trời mà", " ăn ", "công", "."],
            vec!["tôi ", "dời mà", " ăn ", "không", "."],
        ]
        .into_iter()
        .map(|candidate| candidate.into_iter().map(String::from).collect())
        .collect::<Vec<Vec<String>>>();
        let plan = build_candidate_diff_plan(&islands, &candidates, 5);

        assert_eq!(plan.preview, "tôi trời mà ăn không.");
        assert_eq!(
            section_summary(&plan),
            vec![
                (CandidateDiffSectionRole::Left, "trời".to_string()),
                (CandidateDiffSectionRole::Right, "không".to_string()),
            ]
        );
    }

    #[test]
    fn maps_and_serializes_steno_keys() {
        assert_eq!(map_key_unique("a"), Some("S-"));
        assert_eq!(map_key_unique(" "), Some("*"));
        assert_eq!(map_key_unique("t"), Some("-D"));
        assert_eq!(map_key_unique("7"), Some("7"));
        assert_eq!(map_key_unique("/"), None);

        assert_eq!(
            serialize_stroke_keys(&["S-".to_string(), "A".to_string(), "-T".to_string()]),
            "SAT"
        );
        assert_eq!(serialize_stroke_keys(&["-T".to_string()]), "-T");
    }

    #[test]
    fn exposes_qwerty_keyboard_display_model() {
        let layout = qwerty_keyboard_layout();
        let rows = layout
            .iter()
            .map(|row| row.iter().map(|key| key.key.clone()).collect::<Vec<_>>())
            .collect::<Vec<_>>();

        assert_eq!(
            rows[0],
            vec!["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
        );
        assert_eq!(
            rows[1],
            vec!["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]
        );
        assert_eq!(
            rows[2],
            vec!["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "Enter"]
        );
        assert_eq!(
            rows[3],
            vec!["Shift", "z", "x", "c", "v", "b", "n", "m", "Shift"]
        );
        assert_eq!(rows[4], vec![" "]);
        assert_eq!(layout[2][10].width, Some(2.25));
        assert_eq!(layout[4][0].label, "Spacebar");
    }

    #[test]
    fn normalizes_qwerty_display_keys() {
        assert_eq!(
            normalize_qwerty_display_key("A", "KeyA"),
            Some("a".to_string())
        );
        assert_eq!(
            normalize_qwerty_display_key("!", "Digit1"),
            Some("1".to_string())
        );
        assert_eq!(
            normalize_qwerty_display_key(" ", "Space"),
            Some(" ".to_string())
        );
        assert_eq!(
            normalize_qwerty_display_key("Shift", "ShiftLeft"),
            Some("Shift".to_string())
        );
        assert_eq!(
            normalize_qwerty_display_key("Enter", "Enter"),
            Some("Enter".to_string())
        );
        assert_eq!(normalize_qwerty_display_key("ArrowLeft", "ArrowLeft"), None);
    }

    #[test]
    fn selects_candidates_and_renders_selection_with_island_spacing() {
        let candidates = vec![vec!["xin ".to_string(), "chào".to_string()]];
        assert_eq!(
            get_selected_candidate_text(&candidates, 0, None),
            Some("xin chào".to_string())
        );
        assert_eq!(get_selected_candidate_text(&candidates, 1, None), None);

        let islands = vec![v7("tro2ma1"), v7("ko0")];
        let candidates = vec![vec!["trời mà".to_string(), "không".to_string()]];
        assert_eq!(
            get_selected_candidate_text(&candidates, 0, Some(&islands)),
            Some("trời mà không".to_string())
        );
        assert_eq!(
            select_candidate_islands(&candidates, 0, Some(&islands)).unwrap(),
            vec![vietnamese("trời mà không")]
        );
    }

    #[test]
    fn converts_islands_for_inference_and_renders_visible_text() {
        let islands = vec![vietnamese("xin"), v7("tro2"), punctuation(".")];
        assert_eq!(render_visible_text(&islands, &[]), "xin [tro2].");
        assert_eq!(
            convert_islands_for_inference(&[v7("tro2ma1")]),
            vec!["".to_string(), "tro2ma1".to_string(), "".to_string()]
        );
    }

    #[test]
    fn matches_candidate_selection_suffixes() {
        assert_eq!(
            get_candidate_selection_match("-TS", 5),
            Some(CandidateSelectionMatch {
                candidate_index: 1,
                syllable_stroke: None
            })
        );
        assert_eq!(
            get_candidate_selection_match("KAOT", 5),
            Some(CandidateSelectionMatch {
                candidate_index: 0,
                syllable_stroke: Some("KAO".to_string())
            })
        );
        assert_eq!(get_candidate_selection_match("-Z", 2), None);
    }

    #[test]
    fn finds_and_replaces_piecemeal_targets() {
        let valid = ["a", "à", "ả", "ã", "á", "ạ", "ai", "tôi", "không", "thẹn"]
            .iter()
            .map(|value| value.to_string())
            .collect::<HashSet<_>>();

        let fixed_targets =
            find_piecemeal_syllable_targets(&[vietnamese("hello tôi không xyz thẹn")], &valid);
        assert_eq!(
            fixed_targets
                .iter()
                .map(|target| target.text.clone())
                .collect::<Vec<_>>(),
            vec!["thẹn", "không", "tôi"]
        );

        let islands = vec![v7("tro2ma1")];
        let target = find_piecemeal_syllable_targets(&islands, &valid)
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(
            replace_piecemeal_syllable(&islands, &target, "tôi"),
            vec![v7("tro2"), vietnamese("tôi")]
        );
        assert_eq!(get_piecemeal_entry_index("TK"), Some(3));
        assert_eq!(get_next_piecemeal_cursor_index(2, 9), Some(1));
        assert_eq!(get_next_piecemeal_cursor_index(0, 9), None);
    }
}
