use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

const CANDIDATE_SECTION_PENALTY: usize = 1;

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
    #[serde(default, rename = "leftSpace")]
    pub left_space: bool,
    #[serde(default, rename = "rightSpace")]
    pub right_space: bool,
    #[serde(default, rename = "explicitSpacing")]
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffToken {
    text: String,
    start: usize,
    end: usize,
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
    let base_tokens = tokenize_diff_text(&preview, 0);
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
            let start = text.len();
            text.push_str(&part_text);
            parts.push(RenderedCandidatePart {
                tokens: tokenize_diff_text(&part_text, start),
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
        let start = text.len();
        text.push_str(part_text);
        if v7_slots
            .iter()
            .any(|slot| slot.full_candidate_index == candidate_index)
        {
            parts.push(RenderedCandidatePart {
                tokens: tokenize_diff_text(part_text, start),
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
    let candidate_tokens = tokenize_diff_text(candidate, 0);
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

fn tokenize_diff_text(text: &str, offset: usize) -> Vec<DiffToken> {
    let mut tokens = Vec::new();
    let mut token_start: Option<usize> = None;

    for (index, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if let Some(start) = token_start.take() {
                tokens.push(DiffToken {
                    text: text[start..index].to_string(),
                    start: offset + start,
                    end: offset + index,
                });
            }
        } else if token_start.is_none() {
            token_start = Some(index);
        }
    }

    if let Some(start) = token_start {
        tokens.push(DiffToken {
            text: text[start..].to_string(),
            start: offset + start,
            end: offset + text.len(),
        });
    }

    tokens
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
    let start_char = tokens
        .get(start)
        .map(|token| token.start)
        .or_else(|| tokens.get(end.saturating_sub(1)).map(|token| token.end))
        .unwrap_or(text.len());
    let end_char = tokens
        .get(end.saturating_sub(1))
        .map(|token| token.end)
        .unwrap_or(start_char);
    text[start_char..end_char].to_string()
}

#[derive(Debug, Clone, Copy)]
struct V7CandidateSlot {
    full_candidate_index: usize,
}

fn get_v7_candidate_slots(islands: &[Island]) -> Vec<V7CandidateSlot> {
    let mut v7_slots = Vec::new();
    let mut candidate_part_index = 0;
    for island in islands {
        if !island.is_v7 {
            continue;
        }
        v7_slots.push(V7CandidateSlot {
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
}
