#!/usr/bin/env python3
"""Generate a JSONL fine-tuning dataset for v7 inference.

Each record follows the OpenAI chat fine-tuning format:
  {"messages": [
    {"role": "user",      "content": "Perform the following v7 inference request: [...]"},
    {"role": "assistant", "content": "<correct Vietnamese text>"}
  ]}

Usage:
  python scripts/generate_dataset.py [output_path]

The default output path is dataset/finetune.jsonl.
"""

import json
import os
import re
import sys
from typing import Optional

# ---------------------------------------------------------------------------
# Bootstrap: make vietnamese_to_v7 importable from this script's location.
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(__file__))
from vietnamese_to_v7 import (
    encode_word,
    is_syllable_valid,
    normalize_rime_start,
    split_onset,
    tone_digit,
)

# ---------------------------------------------------------------------------
# Port of the regex-enumeration logic from regex_enum.rs / getInference.ts
# ---------------------------------------------------------------------------

def _enumerate_regex(pattern: str) -> list[str]:
    """Enumerate all literal strings that the structured regex *pattern* can match."""
    chars = list(pattern)
    idx = 0

    def expand() -> list[str]:
        nonlocal idx
        alternatives: list[list[str]] = []
        current: list[str] = [""]

        while idx < len(chars):
            c = chars[idx]

            if c == ")":
                break

            if c == "(":
                idx += 1
                if idx < len(chars) and chars[idx] == "?":
                    idx += 1
                    if idx < len(chars) and chars[idx] == ":":
                        idx += 1
                nested = expand()
                if idx < len(chars) and chars[idx] == ")":
                    idx += 1
                if idx < len(chars) and chars[idx] == "?":
                    idx += 1
                    new: list[str] = []
                    for s in current:
                        for n in nested:
                            new.append(s + n)
                        new.append(s)
                    current = new
                else:
                    new = [s + n for s in current for n in nested]
                    current = new
                continue

            if c == "[":
                idx += 1
                cls: list[str] = []
                while idx < len(chars) and chars[idx] != "]":
                    cls.append(chars[idx])
                    idx += 1
                if idx < len(chars):
                    idx += 1  # consume ']'
                if idx < len(chars) and chars[idx] == "?":
                    idx += 1
                    new = []
                    for s in current:
                        for cc in cls:
                            new.append(s + cc)
                        new.append(s)
                    current = new
                else:
                    current = [s + cc for s in current for cc in cls]
                continue

            if c == "|":
                alternatives.append(current)
                current = [""]
                idx += 1
                continue

            if c == "\\":
                idx += 1
                if idx < len(chars):
                    esc = chars[idx]
                    idx += 1
                    if idx < len(chars) and chars[idx] == "?":
                        idx += 1
                        new = []
                        for s in current:
                            new.append(s + esc)
                            new.append(s)
                        current = new
                    else:
                        current = [s + esc for s in current]
                continue

            idx += 1
            if idx < len(chars) and chars[idx] == "?":
                idx += 1
                new = []
                for s in current:
                    new.append(s + c)
                    new.append(s)
                current = new
            else:
                current = [s + c for s in current]

        alternatives.append(current)
        result: list[str] = []
        for alt in alternatives:
            result.extend(alt)
        return result

    return expand()


# ---------------------------------------------------------------------------
# Build the full candidates index: key "(consonant)_(vowel)_(tone)" → [syllables]
# ---------------------------------------------------------------------------

def _build_regex_map() -> dict[str, str]:
    """Port of generateStructuredRegexMap from getInference.ts."""

    def so(c: str, v: str) -> str:  # structured_onset
        if c == "0":   return ""
        if c == "w":   return "qu"
        if c == "g"  and v in ("e", "i"): return "gh"
        if c == "ng" and v in ("e", "i"): return "ngh"
        if c == "k"  and v in ("e", "i"): return "k"
        if c == "k":   return "c"
        return c

    a  = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)",
          "(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)",
          "(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)",
          "(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)",
          "(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)",
          "(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)",
          "(?:[ấắ][cpt]|á(?:ch?|[pt]))",
          "(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"]
    e  = ["(?:e(?:(?:ng?|[mo]))?|ê(?:(?:nh?|[mu]))?)",
          "(?:é(?:(?:ng?|[mo]))?|ế(?:(?:nh?|[mu]))?)",
          "(?:è(?:(?:ng?|[mo]))?|ề(?:(?:nh?|[mu]))?)",
          "(?:ẻ(?:(?:ng?|[mo]))?|ể(?:(?:nh?|[mu]))?)",
          "(?:ẽ(?:(?:ng?|[mo]))?|ễ(?:(?:nh?|[mu]))?)",
          "(?:ẹ(?:(?:ng?|[mo]))?|ệ(?:(?:nh?|[mu]))?)",
          "(?:é[cpt]|ế(?:ch|[pt]))",
          "(?:ẹ[cpt]|ệ(?:ch|[pt]))"]
    o  = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]|ă(?:m|ng?)|e(?:[no])?|a(?:(?:[imouy]|n(?:[gh])?))?))?)","(?:ớ(?:[imn])?|ố(?:(?:ng?|[im]))?|ó(?:(?:ng?|[aeim]))?|o(?:óng|é[no]|ắ(?:m|ng?)|á(?:[imouy]|n(?:[gh])?)))","(?:ờ(?:[imn])?|ồ(?:(?:ng?|[im]))?|ò(?:(?:ng?|[aeim]))?|o(?:òng|è[no]|ằ(?:m|ng?)|à(?:[imouy]|n(?:[gh])?)))","(?:ở(?:[imn])?|ổ(?:(?:ng?|[im]))?|ỏ(?:(?:ng?|[aeim]))?|o(?:ỏng|ẻ[no]|ẳ(?:m|ng?)|ả(?:[imouy]|n(?:[gh])?)))","(?:ỡ(?:[imn])?|ỗ(?:(?:ng?|[im]))?|õ(?:(?:ng?|[aeim]))?|o(?:õng|ẽ[no]|ẵ(?:m|ng?)|ã(?:[imouy]|n(?:[gh])?)))","(?:ợ(?:[imn])?|ộ(?:(?:ng?|[im]))?|ọ(?:(?:ng?|[aeim]))?|o(?:ọng|ẹ[no]|ặ(?:m|ng?)|ạ(?:[imouy]|n(?:[gh])?)))","(?:ớ[pt]|[óố][cpt]|o(?:ét|óc|ắ[cpt]|á(?:ch?|[pt])))","(?:ợ[pt]|[ọộ][cpt]|o(?:ẹt|ọc|ặ[cpt]|ạ(?:ch?|[pt])))"]
    u  = ["(?:ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?|u(?:(?:ng?|[aim]|ê(?:nh?)?|â(?:y|ng?)|ơ(?:[in])?|ô(?:ng?|[im])|y(?:(?:ên|nh?|[amu]))?))?)","(?:ướ(?:ng?|[imu])|ú(?:(?:ng?|[aimy]))?|ứ(?:(?:ng?|[aimu]))?|u(?:yến|ế(?:nh?)?|ấ(?:y|ng?)|ớ(?:[in])?|ố(?:ng?|[im])|ý(?:nh?|[amu])))","(?:ườ(?:ng?|[imu])|ù(?:(?:ng?|[aimy]))?|ừ(?:(?:ng?|[aimu]))?|u(?:yền|ề(?:nh?)?|ầ(?:y|ng?)|ờ(?:[in])?|ồ(?:ng?|[im])|ỳ(?:nh?|[amu])))","(?:ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aimy]))?|ử(?:(?:ng?|[aimu]))?|u(?:yển|ể(?:nh?)?|ẩ(?:y|ng?)|ở(?:[in])?|ổ(?:ng?|[im])|ỷ(?:nh?|[amu])))","(?:ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aimy]))?|ữ(?:(?:ng?|[aimu]))?|u(?:yễn|ễ(?:nh?)?|ẫ(?:y|ng?)|ỡ(?:[in])?|ỗ(?:ng?|[im])|ỹ(?:nh?|[amu])))","(?:ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aimy]))?|ự(?:(?:ng?|[aimu]))?|u(?:yện|ệ(?:nh?)?|ậ(?:y|ng?)|ợ(?:[in])?|ộ(?:ng?|[im])|ỵ(?:nh?|[amu])))","(?:ướ[cpt]|[úứ][cpt]|u(?:ớt|yết|ấ[ct]|ố[cpt]|ế(?:t|ch)|ý(?:ch|[pt])))","(?:ượ[cpt]|[ụự][cpt]|u(?:ợt|yệt|ậ[ct]|ộ[cpt]|ệ(?:t|ch)|ỵ(?:ch|[pt])))"]
    iz = ["(?:i(?:(?:nh?|[amu]))?|y(?:ê(?:ng?|[mu]))?)",
          "(?:ý|yế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)",
          "(?:ỳ|yề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)",
          "(?:ỷ|yể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)",
          "(?:ỹ|yễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)",
          "(?:ỵ|yệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)",
          "(?:yế[cpt]|í(?:ch|[pt]))",
          "(?:yệ[cpt]|ị(?:ch|[pt]))"]
    isv = ["(?:y|i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?)","(?:ý|iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"]
    ih  = ["i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?","(?:iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"]
    wa  = ["(?:ă(?:m|ng?)|â(?:y|ng?)|a(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ắ(?:m|ng?)|ấ(?:y|ng?)|á(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ằ(?:m|ng?)|ầ(?:y|ng?)|à(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ẳ(?:m|ng?)|ẩ(?:y|ng?)|ả(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ẵ(?:m|ng?)|ẫ(?:y|ng?)|ã(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ặ(?:m|ng?)|ậ(?:y|ng?)|ạ(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ấ[ct]|ắ[cpt]|á(?:ch?|[pt]))",
           "(?:ậ[ct]|ặ[cpt]|ạ(?:ch?|[pt]))"]
    we  = ["(?:ê(?:nh?)?|e(?:[no])?)",
           "(?:ế(?:nh?)?|é(?:[no])?)",
           "(?:ề(?:nh?)?|è(?:[no])?)",
           "(?:ể(?:nh?)?|ẻ(?:[no])?)",
           "(?:ễ(?:nh?)?|ẽ(?:[no])?)",
           "(?:ệ(?:nh?)?|ẹ(?:[no])?)",
           "(?:ét|ế(?:t|ch))",
           "(?:ẹt|ệ(?:t|ch))"]
    wi  = ["y(?:(?:ên|nh?|[amu]))?",
           "(?:yến|ý(?:(?:nh?|[amu]))?)",
           "(?:yền|ỳ(?:(?:nh?|[amu]))?)",
           "(?:yển|ỷ(?:(?:nh?|[amu]))?)",
           "(?:yễn|ỹ(?:(?:nh?|[amu]))?)",
           "(?:yện|ỵ(?:(?:nh?|[amu]))?)",
           "(?:yết|ý(?:ch|[pt]))",
           "(?:yệt|ỵ(?:ch|[pt]))"]
    wo  = ["(?:ông|ơ(?:[in])?)",
           "(?:ống|ớ(?:[in])?)",
           "(?:ồng|ờ(?:[in])?)",
           "(?:ổng|ở(?:[in])?)",
           "(?:ỗng|ỡ(?:[in])?)",
           "(?:ộng|ợ(?:[in])?)",
           "(?:ốc|ớt)",
           "(?:ộc|ợt)"]
    ko  = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"]
    ku  = ["(?:u(?:(?:ng?|[aim]|ô(?:ng?|[im])))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:ng?|[im])|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:ng?|[im])|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:ng?|[im])|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:ng?|[im])|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:ng?|[im])|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uố[cpt]|ướ[cpt]|[úứ][cpt])","(?:uộ[cpt]|ượ[cpt]|[ụự][cpt])"]
    za  = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)",
           "(?:[ấắ][cpt]|á(?:ch?|[pt]))",
           "(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"]
    ze  = ["e(?:(?:ng?|[mo]))?","é(?:(?:ng?|[mo]))?","è(?:(?:ng?|[mo]))?","ẻ(?:(?:ng?|[mo]))?","ẽ(?:(?:ng?|[mo]))?","ẹ(?:(?:ng?|[mo]))?","é[cpt]","ẹ[cpt]"]
    zo  = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"]
    zu  = ["(?:u(?:(?:ng?|[aim]|ô(?:i|ng)))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:i|ng)|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:i|ng)|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:i|ng)|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:i|ng)|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:i|ng)|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uốc|ướ[cpt]|[úứ][cpt])","(?:uộc|ượ[cpt]|[ụự][cpt])"]
    zi  = ["g(?:i(?:[mn])?|iê(?:[mnu]|ng|nh)?)",
           "g(?:í(?:[mn])?|iế(?:[mnu]|ng|nh)?)",
           "g(?:ì(?:[mn])?|iề(?:[mnu]|ng|nh)?)",
           "g(?:ỉ(?:[mn])?|iể(?:[mnu]|ng|nh)?)",
           "g(?:ĩ(?:[mn])?|iễ(?:[mnu]|ng|nh)?)",
           "g(?:ị(?:[mn])?|iệ(?:[mnu]|ng|nh)?)",
           "g(?:í[pt]|iế(?:[cpt]|ch))",
           "g(?:ị[pt]|iệ(?:[cpt]|ch))"]

    hard = {"b", "ch", "d", "g", "kh", "ng", "p", "ph", "r", "tr", "x", "đ"}
    consonants = [
        "0", "b", "ch", "d", "g", "h", "k", "kh", "l", "m", "n", "ng",
        "nh", "p", "ph", "r", "s", "t", "th", "tr", "v", "w", "x", "z", "đ",
    ]

    m: dict[str, str] = {}
    for c in consonants:
        for v in ["a", "e", "i", "o", "u"]:
            if c == "w" and v == "u":
                continue
            for i in range(8):
                k = f"{c}_{v}_{i}"
                if c == "w":
                    sv = {"a": wa, "e": we, "i": wi, "o": wo}[v][i]
                    m[k] = "qu" + sv
                    continue
                if c == "z":
                    if v == "i":
                        m[k] = zi[i]
                    else:
                        sv = {"a": za, "e": ze, "o": zo, "u": zu}[v][i]
                        m[k] = "gi" + sv
                    continue
                if v == "i":
                    iv = iz[i] if c == "0" else (ih[i] if c in hard else isv[i])
                    m[k] = so(c, v) + iv
                    continue
                sv = {"a": a, "e": e, "o": o, "u": u}[v][i]
                if c == "k" and v == "o":
                    sv = ko[i]
                if c == "k" and v == "u":
                    sv = ku[i]
                m[k] = so(c, v) + sv
    return m


def build_candidates_index() -> dict[str, list[str]]:
    """Return {key: [syllable, ...]} for all valid (consonant, vowel, tone) triples.

    The key format is "<structured_consonant>_<vowel_char>_<tone_digit>".
    """
    regex_map = _build_regex_map()
    index: dict[str, list[str]] = {}
    for key, pattern in regex_map.items():
        index[key] = _enumerate_regex(pattern)
    return index


def _v7_onset_to_structured(onset_v7: str) -> str:
    """Map a v7 onset code to its structured consonant name (used as index key)."""
    return "đ" if onset_v7 == "dd" else onset_v7


def _structured_to_v7_onset(structured: str) -> str:
    return "dd" if structured == "đ" else structured


def build_v7_to_syllables(
    index: dict[str, list[str]],
) -> dict[str, list[str]]:
    """Return {v7_code: [syllable, ...]} mapping every valid v7 code to Vietnamese syllables."""
    result: dict[str, list[str]] = {}
    for key, syllables in index.items():
        parts = key.split("_")
        structured_c = parts[0]
        v7_c = _structured_to_v7_onset(structured_c)
        vowel = parts[1]
        tone = parts[2]
        v7_code = v7_c + vowel + tone
        result[v7_code] = syllables
    return result


# ---------------------------------------------------------------------------
# Sentence → islands conversion
# ---------------------------------------------------------------------------

_WORD_RE = re.compile(
    r"[\u0041-\u005A\u0061-\u007A\u00C0-\u024F\u1E00-\u1EFF\u0110\u0111]+",
    re.UNICODE,
)


def _is_v7_word(word: str) -> bool:
    """True when *word* is all-lowercase and encodes to a valid v7 code."""
    if word != word.lower():
        return False
    # Must consist entirely of Vietnamese letters (no digits, punctuation, etc.)
    if not _WORD_RE.fullmatch(word):
        return False
    return is_syllable_valid(word)


def sentence_to_islands(sentence: str) -> Optional[tuple[list[str], str]]:
    """Convert a Vietnamese sentence into (islands_array, expected_text).

    Returns None when the sentence contains no encodable v7 syllables.

    Islands follow the strict-alternating format expected by the inference
    engine:  [fixed₀, v7₁, fixed₂, v7₃, …]
    Even positions are fixed-text islands (may be empty strings).
    Odd  positions are v7 islands (never empty).
    """
    words = sentence.split(" ")
    if not words:
        return None

    classified: list[tuple[str, bool]] = [
        (w, _is_v7_word(w)) for w in words if w
    ]

    if not any(is_v7 for _, is_v7 in classified):
        return None

    islands: list[str] = []
    fixed_buf: list[str] = []
    v7_words: list[str] = []
    in_v7 = False

    for word, is_v7 in classified:
        if is_v7:
            if not in_v7:
                # Flush fixed buffer (trailing space added if non-empty)
                fixed_text = " ".join(fixed_buf)
                if fixed_buf:
                    fixed_text += " "
                islands.append(fixed_text)
                fixed_buf = []
                in_v7 = True
            v7_words.append(word)
        else:
            if in_v7:
                # Flush v7 island
                v7_code = "".join(encode_word(w) for w in v7_words)
                islands.append(v7_code)
                v7_words = []
                in_v7 = False
            # Add space separator before the word if buffer is non-empty
            fixed_buf.append(word)

    # Final flush
    if in_v7:
        v7_code = "".join(encode_word(w) for w in v7_words)
        islands.append(v7_code)
    elif fixed_buf and islands:
        islands.append(" ".join(fixed_buf))

    if not islands:
        return None

    return islands, sentence


# ---------------------------------------------------------------------------
# Build training records
# ---------------------------------------------------------------------------

def make_record(islands: list[str], expected: str) -> dict:
    """Return an OpenAI chat fine-tuning record."""
    request_json = json.dumps(islands, ensure_ascii=False)
    return {
        "messages": [
            {
                "role": "user",
                "content": f"Perform the following v7 inference request: {request_json}",
            },
            {
                "role": "assistant",
                "content": expected,
            },
        ]
    }


# ---------------------------------------------------------------------------
# Diverse Vietnamese sentence corpus
# ---------------------------------------------------------------------------

SENTENCES: list[str] = [
    # ── Greetings / everyday ────────────────────────────────────────────────
    "xin chào bạn",
    "bạn có khỏe không",
    "tôi khỏe cảm ơn bạn",
    "hẹn gặp lại nhé",
    "chúc bạn một ngày tốt lành",
    "tạm biệt và hẹn gặp lại",
    "cảm ơn rất nhiều",
    "xin lỗi làm phiền bạn",
    "không có gì",
    "vui lòng cho tôi biết",
    # ── Family / relationships ───────────────────────────────────────────────
    "gia đình tôi có bốn người",
    "bố mẹ tôi sống ở quê",
    "anh trai tôi làm kỹ sư",
    "chị gái tôi dạy học",
    "em gái tôi học đại học",
    "con tôi còn nhỏ",
    "ông bà tôi đã già",
    "họ hàng nhà tôi rất đông",
    "vợ tôi nấu ăn rất ngon",
    "chồng cô ấy rất tốt bụng",
    "bạn bè tôi rất vui tính",
    "tình bạn là quý giá",
    "yêu thương gia đình",
    # ── Food / cooking ───────────────────────────────────────────────────────
    "cơm trắng với rau muống",
    "phở bò rất ngon",
    "bún bò huế cay và thơm",
    "bánh mì thịt nướng",
    "gỏi cuốn tôm thịt",
    "canh chua cá lóc",
    "thịt kho tàu",
    "cà ri gà với khoai tây",
    "bún riêu cua",
    "chả giò chiên giòn",
    "tôi thích ăn hủ tiếu",
    "món ăn này rất thơm ngon",
    "nước mắm là gia vị đặc trưng",
    "rau sống kèm bánh xèo",
    "chè ba màu ngọt mát",
    "trà đá giải khát",
    "cà phê sữa đá ngon",
    "sinh tố xoài thơm lừng",
    # ── Nature / weather ─────────────────────────────────────────────────────
    "trời hôm nay nắng đẹp",
    "mưa rào vào buổi chiều",
    "gió thổi mát rượi",
    "bầu trời xanh trong",
    "mặt trời mọc đàng đông",
    "trăng tròn sáng rõ",
    "sao đêm lấp lánh",
    "cây cối xanh tươi",
    "hoa nở rộ mùa xuân",
    "lá vàng rơi mùa thu",
    "tuyết rơi trắng xóa",
    "sóng biển dạt dào",
    "núi cao hùng vĩ",
    "sông dài uốn khúc",
    "rừng rậm hoang sơ",
    "đồng lúa chín vàng",
    "suối trong chảy róc rách",
    "hồ nước yên bình",
    # ── Work / study ────────────────────────────────────────────────────────
    "tôi đi làm mỗi ngày",
    "công việc rất bận rộn",
    "học sinh chăm chỉ học bài",
    "giáo viên giảng bài hay",
    "sinh viên ôn thi cuối kỳ",
    "văn phòng làm việc sạch sẽ",
    "họp hành nhiều quá",
    "dự án này rất phức tạp",
    "báo cáo nộp đúng hạn",
    "đồng nghiệp thân thiện",
    "lương tháng này tăng rồi",
    "tìm việc làm khó khăn",
    "kỹ năng mềm rất quan trọng",
    "kinh nghiệm làm việc cần thiết",
    "phỏng vấn xin việc hôm nay",
    # ── Technology / digital ────────────────────────────────────────────────
    "điện thoại thông minh",
    "máy tính xách tay",
    "mạng xã hội phổ biến",
    "internet tốc độ cao",
    "phần mềm mới cập nhật",
    "trí tuệ nhân tạo phát triển",
    "dữ liệu lớn xu hướng mới",
    "ứng dụng di động tiện lợi",
    "bảo mật thông tin quan trọng",
    "gọi video với bạn bè",
    "mua sắm trực tuyến tiện",
    # ── Travel / geography ──────────────────────────────────────────────────
    "tôi thích đi du lịch",
    "biển đẹp mùa hè",
    "vịnh hạ long nổi tiếng",
    "phố cổ hội an quyến rũ",
    "đà lạt thành phố ngàn hoa",
    "hà nội thủ đô ngàn năm",
    "thành phố hồ chí minh sầm uất",
    "huế cố đô lịch sử",
    "cần thơ miền tây sông nước",
    "nha trang biển xanh cát trắng",
    "đèo hải vân ngoạn mục",
    "chùa một cột di tích",
    "văn miếu quốc tử giám",
    "lăng bác kính trọng",
    "phú quốc đảo ngọc",
    # ── Health / body ────────────────────────────────────────────────────────
    "sức khỏe là vốn quý",
    "uống nhiều nước mỗi ngày",
    "tập thể dục thường xuyên",
    "ăn uống điều độ",
    "ngủ đủ giấc mỗi đêm",
    "khám bệnh định kỳ",
    "thuốc men đầy đủ",
    "bác sĩ chữa bệnh tận tâm",
    "y tế cộng đồng phát triển",
    "phòng bệnh hơn chữa bệnh",
    # ── Sports / hobbies ────────────────────────────────────────────────────
    "bóng đá môn thể thao vua",
    "đội tuyển quốc gia thi đấu",
    "bơi lội rất tốt cho sức khỏe",
    "chạy bộ buổi sáng sớm",
    "đạp xe khám phá thành phố",
    "leo núi thể thao mạo hiểm",
    "cầu lông sân trong nhà",
    "bóng bàn tập phản xạ",
    "thể dục yoga thư giãn",
    "câu cá bên hồ yên tĩnh",
    "vẽ tranh sở thích nghệ thuật",
    "đọc sách mở mang tri thức",
    "nghe nhạc thư giãn tâm hồn",
    "nấu ăn thú vị",
    # ── Culture / arts ───────────────────────────────────────────────────────
    "văn hóa việt nam phong phú",
    "lễ hội truyền thống đặc sắc",
    "tết nguyên đán vui vẻ",
    "múa rối nước nghệ thuật dân gian",
    "quan họ bắc ninh di sản",
    "cải lương miền nam đặc trưng",
    "ca huế trên sông hương",
    "áo dài trang phục truyền thống",
    "nón lá biểu tượng duyên dáng",
    # ── Economy / society ───────────────────────────────────────────────────
    "kinh tế phát triển mạnh",
    "xuất khẩu gạo hàng đầu",
    "du lịch đóng góp nhiều",
    "công nghiệp hóa hiện đại hóa",
    "nông nghiệp bền vững",
    "giáo dục toàn diện",
    "hội nhập quốc tế",
    "phát triển bền vững",
    "xóa đói giảm nghèo",
    "bảo vệ môi trường",
    # ── Simple short phrases ────────────────────────────────────────────────
    "đúng rồi",
    "không đúng",
    "có thể",
    "không biết",
    "được rồi",
    "thật sự",
    "rất hay",
    "tốt lắm",
    "quá đẹp",
    "thích quá",
    "biết rồi",
    "hiểu rồi",
    "nhớ mãi",
    "quên đi",
    "cần gì",
    "muốn gì",
    "làm gì",
    "đi thôi",
    "về nhà",
    "ngủ ngon",
    # ── With mixed case / proper nouns ─────────────────────────────────────
    "Hà Nội là thủ đô",
    "Sài Gòn phồn thịnh",
    "sông Hồng chảy qua hà nội",
    "núi Fansipan cao nhất",
    "Trường Sơn hùng vĩ",
    "biển Đông rộng lớn",
    "bán đảo Đông Dương",
    "châu Á phát triển",
    "Việt Nam đất nước xinh đẹp",
    "người Việt thân thiện",
    "tiếng Việt hay và phong phú",
    "ngôn ngữ Việt đặc biệt",
    "học tiếng Anh quan trọng",
    "tiếng Trung phổ biến",
    "tiếng Nhật khó học",
    # ── With punctuation ────────────────────────────────────────────────────
    "trời ơi đẹp quá",
    "ăn gì bây giờ",
    "đi đâu vui đây",
    "làm sao được",
    "sao lại như thế",
    "khi nào đến nơi",
    "tại sao lại khóc",
    "thế này thì sao",
    "không biết phải làm sao",
    "cuộc sống thật tươi đẹp",
    # ── Longer, richer sentences ────────────────────────────────────────────
    "mỗi buổi sáng tôi uống cà phê và đọc báo",
    "chiều tối tôi đi bộ trong công viên",
    "cuối tuần gia đình tôi đi picnic",
    "tôi thích nghe nhạc khi làm việc",
    "học tiếng anh mỗi ngày giúp tôi tiến bộ",
    "bạn bè giúp đỡ nhau khi khó khăn",
    "mùa hè nóng bức nhưng vui",
    "mùa đông lạnh giá và cô đơn",
    "mùa xuân hoa nở bướm bay",
    "mùa thu lá vàng rơi rụng",
    "con đường làng quê yên bình",
    "tiếng chim hót buổi ban mai",
    "ánh nắng chiều tà vàng ươm",
    "đêm trăng sáng trên mái đình",
    "tiếng trống hội làng vang vọng",
    "khói lam chiều tỏa trên mái nhà",
    "cánh cò trắng trên đồng xanh",
    "trẻ con chơi đùa vui vẻ",
    "người già ngồi tâm sự",
    "thanh niên làm việc hăng say",
    # ── v7 code diversity – consonant variations ─────────────────────────────
    "nhanh chậm đều đặn",
    "trên dưới trái phải",
    "trong ngoài sáng tối",
    "cao thấp rộng hẹp",
    "dài ngắn nặng nhẹ",
    "cứng mềm thô nhám",
    "ngọt chua mặn đắng",
    "thơm hôi tanh khai",
    "nóng lạnh ấm mát",
    "khô ướt nhớp nháp",
    "vui buồn giận hờn",
    "yêu ghét thương nhớ",
    "biết hiểu nhớ quên",
    "chạy nhảy bơi leo",
    "đi đứng ngồi nằm",
    "ăn uống ngủ nghỉ",
    "nói nghe nhìn đọc viết",
    "mua bán trao đổi",
    "trồng gặt xay giã",
    "xây dựng phá bỏ",
    # ── Additional diverse sentences ─────────────────────────────────────────
    "trăm năm tình nghĩa",
    "nghĩa tình sâu nặng",
    "tình yêu đôi lứa",
    "hạnh phúc gia đình",
    "niềm vui bé thơ",
    "tuổi thơ đẹp đẽ",
    "kỷ niệm khó phai",
    "ký ức tuổi thơ",
    "giấc mơ tươi sáng",
    "ước mơ bay xa",
    "khát vọng vươn lên",
    "nỗ lực phấn đấu",
    "thành công vinh quang",
    "thất bại bài học",
    "kiên nhẫn bền bỉ",
    "dũng cảm mạnh mẽ",
    "thông minh tài giỏi",
    "chăm chỉ cần cù",
    "trung thực thẳng thắn",
    "khiêm tốn nhã nhặn",
    # ── Sentences with empty-start v7 islands ─────────────────────────────
    "học bài chăm chỉ",
    "nấu cơm cho cả nhà",
    "tưới cây buổi sáng",
    "giặt quần áo sạch",
    "lau nhà sáng bóng",
    "đọc truyện thú vị",
    "xem phim hay lắm",
    "nghe radio buổi tối",
    "chơi game giải trí",
    "viết thư cho bạn",
    "gọi điện hỏi thăm",
    "nhắn tin chúc mừng",
    "tặng quà sinh nhật",
    "cùng nhau ca hát",
    "múa hát vui vẻ",
    "kể chuyện hài hước",
    "chia sẻ kinh nghiệm",
    "học hỏi lẫn nhau",
    "giúp đỡ mọi người",
    "lan tỏa yêu thương",
    # ── Mixed proper nouns + lowercase ───────────────────────────────────────
    "Hải Phòng cảng biển lớn",
    "Đà Nẵng thành phố đáng sống",
    "Cần Thơ thành phố miền tây",
    "An Giang lúa vàng mùa gặt",
    "Kiên Giang phú quốc đảo ngọc",
    "Lào Cai sapa cao nguyên",
    "Nghệ An quê bác hồ",
    "Thừa Thiên Huế cố đô",
    "Quảng Nam hội an phố cổ",
    "Bình Định võ cổ truyền",
    "Gia Lai cao nguyên hùng vĩ",
    "Bạc Liêu lúa tôm trù phú",
    "sông Mê Kông hùng vĩ",
    "vườn quốc gia Cúc Phương",
    "động Phong Nha kỳ vĩ",
    # ── More everyday conversation ──────────────────────────────────────────
    "hôm nay trời đẹp ghê",
    "hôm qua mưa to lắm",
    "ngày mai sẽ nắng",
    "tuần này bận quá",
    "tháng sau nghỉ lễ",
    "năm nay nhiều việc",
    "lúc trước dễ hơn",
    "bây giờ khó hơn nhiều",
    "sau này sẽ tốt hơn",
    "hiện tại đủ sống",
    "tương lai rộng mở",
    "quá khứ để học",
    "hiện tại để sống",
    "tương lai để xây",
    "mỗi ngày một ít",
    "từ từ sẽ xong",
    "cứ cố gắng lên",
    "chắc chắn sẽ được",
    "tin tưởng vào bản thân",
    "bước tiếp đừng dừng",
    # ── Proverbs / sayings ──────────────────────────────────────────────────
    "có công mài sắt có ngày nên kim",
    "học thầy không tày học bạn",
    "thương người như thể thương thân",
    "uống nước nhớ nguồn",
    "ăn quả nhớ kẻ trồng cây",
    "lời nói chẳng mất tiền mua",
    "nhất tự vi sư bán tự vi sư",
    "trăm hay không bằng tay quen",
    "giàu vì bạn sang vì vợ",
    "chớ thấy sóng cả mà ngã tay chèo",
    # ── Short poetic / lyrical ──────────────────────────────────────────────
    "bầu ơi thương lấy bí cùng",
    "nhiễu điều phủ lấy giá gương",
    "công cha như núi thái sơn",
    "nghĩa mẹ như nước trong nguồn",
    "anh em như thể tay chân",
    "bạn bè là nghĩa tương thân",
    "quê hương mỗi người chỉ một",
    "làng xóm tình nghĩa sâu đậm",
    "tiếng mẹ đẻ ngọt ngào",
    "lời ru mẹ đêm khuya",
    # ── Additional diverse food / culture ──────────────────────────────────
    "nem rán giòn tan",
    "xôi gấc đỏ tươi",
    "bánh chưng ngày tết",
    "mứt tết ngọt ngào",
    "hạt dưa đỏ đẹp",
    "cành đào hồng thắm",
    "cành mai vàng tươi",
    "phong bì lì xì đỏ",
    "pháo hoa rực rỡ",
    "đêm giao thừa ấm áp",
    # ── Additional nature / science ─────────────────────────────────────────
    "đất trời bao la",
    "vũ trụ bí ẩn",
    "thiên nhiên kỳ diệu",
    "khoa học tiến bộ",
    "phát minh thay đổi thế giới",
    "năng lượng mặt trời sạch",
    "điện gió tương lai",
    "nước biển dâng đe dọa",
    "biến đổi khí hậu toàn cầu",
    "bảo tồn thiên nhiên cấp bách",
    # ── All 5-vowel coverage focus ──────────────────────────────────────────
    "ba bảy bầu bắp bạn",          # a-vowel heavy
    "bé bền bệnh bếp bê",           # e-vowel heavy
    "bí bình biết bịnh bỉu",        # i-vowel heavy
    "bò bổ bộ bốn bỏ bọ",          # o-vowel heavy
    "bú bụ bùng búp bủn",           # u-vowel heavy
    "cá cành cao câu cam",
    "da đà dân dạo dài",
    "ga gần gấp gảy gặp",
    "ha hàng hạnh hảo hán",
    "khi khuya khác khoảng",
    "la làng lạnh lảo lại",
    "ma mạnh mảnh mặn mào",
    "na này nặng nào nắm",
    "pha phải phần phạt phải",
    "ra rằng rạng rảnh rảo",
    "sa sáng sặc sắp sạch",
    "ta tài tạm tắt tảng",
    "va vài vắng vạn vắc",
    "xa xanh xắp xảo xạo",
    # ── Additional mixed structures ──────────────────────────────────────────
    "đây là món ăn ngon",
    "đó là người bạn tốt",
    "kia là con đường đẹp",
    "nơi này rất yên tĩnh",
    "chỗ kia đông người",
    "lúc này thích nhất",
    "khi ấy còn nhỏ",
    "thời điểm đó khó khăn",
    "hoàn cảnh hiện tại tốt",
    "tình huống này phức tạp",
    "giải pháp cần sáng tạo",
    "phương pháp đúng đắn",
    "cách làm hiệu quả",
    "bước đi vững chắc",
    "con đường rõ ràng",
    # ── High-tone diversity ──────────────────────────────────────────────────
    "thác nước chảy mạnh",   # combinations with /ch/
    "chạy nhanh thoát khỏi",
    "chiếc xe đạp cũ",
    "chim hót véo von",
    "chuối xanh cây trái",
    "trái cây ngon ngọt",
    "trăng lên bầu trời",
    "trẻ em vui chơi",
    "trong sáng ngoài trời",
    "triết học sâu xa",
    "nhà nghiên cứu khoa học",
    "nhịp sống hối hả",
    "nhìn xa trông rộng",
    "nhân dân anh hùng",
    "nhẹ nhàng khéo léo",
    # ── Long sentences for multi-word v7 islands ─────────────────────────────
    "tôi yêu quê hương đất nước và con người việt nam",
    "học sinh chăm chỉ học bài mỗi ngày sẽ đạt kết quả tốt",
    "bầu trời trong xanh và không khí trong lành buổi sáng",
    "cây cối đơm hoa kết trái khi được chăm sóc tốt",
    "tiếng cười trẻ thơ là âm thanh vui nhất trên đời",
    "những cánh đồng lúa chín vàng dưới nắng chiều tắt",
    "dòng sông quê hương chảy mãi không ngừng nghỉ",
    "mỗi khi nhớ về quê hương lòng lại bâng khuâng",
    "người thầy đã truyền đạt tri thức cho thế hệ trẻ",
    "công trình xây dựng hoàn thành đúng tiến độ",
]

# ---------------------------------------------------------------------------
# Coverage-boosting syllable list (one per v7 code not already covered)
# ---------------------------------------------------------------------------

def _all_valid_v7_codes() -> list[str]:
    """Return all 992 valid v7 code strings."""
    consonants = [
        "0", "b", "ch", "d", "dd", "g", "h", "k", "kh", "l", "m", "n",
        "ng", "nh", "p", "ph", "r", "s", "t", "th", "tr", "v", "w", "x", "z",
    ]
    vowels = ["a", "e", "i", "o", "u"]
    tones = list(range(8))
    codes = []
    for c in consonants:
        for v in vowels:
            if c == "w" and v == "u":
                continue
            for t in tones:
                codes.append(f"{c}{v}{t}")
    return codes


# ---------------------------------------------------------------------------
# Main generation
# ---------------------------------------------------------------------------

def _collect_from_sentences(
    sentences: list[str],
    covered: set[str],
) -> list[dict]:
    """Convert each sentence to one or more training records."""
    records: list[dict] = []
    for sentence in sentences:
        result = sentence_to_islands(sentence)
        if result is None:
            continue
        islands, expected = result

        # Record which v7 codes this sample covers
        for idx in range(1, len(islands), 2):
            seg = islands[idx]
            # Walk the v7 segment to extract individual codes
            pos = 0
            while pos < len(seg):
                # Try 2-char onsets first
                for olen in (2, 1):
                    onset = seg[pos:pos+olen]
                    if onset in {
                        "ch", "dd", "gh", "kh", "ng", "nh", "ph", "th", "tr",
                        "ngh", "qu",  # handled externally
                        "b", "d", "g", "h", "k", "l", "m", "n", "p", "r", "s",
                        "t", "v", "w", "x", "z", "0",
                    }:
                        rest = seg[pos+olen:]
                        if len(rest) >= 2:
                            vowel = rest[0]
                            tone_c = rest[1]
                            if vowel in "aeiou" and tone_c.isdigit():
                                covered.add(onset + vowel + tone_c)
                                pos += olen + 2
                                break
                else:
                    pos += 1  # skip unparseable character
                    continue
                # successfully consumed a code – restart inner loop
            # end while

        records.append(make_record(islands, expected))
    return records


def _coverage_boost_records(
    v7_to_syl: dict[str, list[str]],
    covered: set[str],
    all_codes: list[str],
) -> list[dict]:
    """For each uncovered v7 code, emit a minimal training record."""
    records: list[dict] = []
    for code in all_codes:
        if code in covered:
            continue
        syllables = v7_to_syl.get(code)
        if not syllables:
            continue
        # Pick the shortest syllable (usually the simplest form)
        syl = min(syllables, key=len)
        islands = ["", code]
        expected = syl
        covered.add(code)
        records.append(make_record(islands, expected))
    return records


def _variant_records(base_records: list[dict]) -> list[dict]:
    """Generate additional variant records with alternate island structures.

    For records that already start with an empty fixed island, produce a
    variant where the fixed island contains "Ví dụ: " to demonstrate
    non-empty leading fixed text.  Also produce a variant that appends a
    trailing fixed island to show empty/non-empty endings.
    """
    variants: list[dict] = []
    for rec in base_records:
        msgs = rec["messages"]
        content = msgs[0]["content"]
        prefix = "Perform the following v7 inference request: "
        if not content.startswith(prefix):
            continue
        islands = json.loads(content[len(prefix):])

        # Variant A: prepend "Ví dụ: " to empty leading fixed text
        if islands and islands[0] == "" and len(islands) >= 2:
            new_islands = ["Ví dụ: "] + islands[1:]
            new_expected = "Ví dụ: " + msgs[1]["content"]
            variants.append(make_record(new_islands, new_expected))

        # Variant B: append trailing empty fixed island
        if islands and len(islands) % 2 == 0:
            # ends with a v7 island – add empty trailing fixed
            new_islands = islands + [""]
            variants.append(make_record(new_islands, msgs[1]["content"]))

    return variants


def _ensure_dir(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def main() -> int:
    output_path = sys.argv[1] if len(sys.argv) > 1 else "dataset/finetune.jsonl"

    print("Building candidates index…")
    index = build_candidates_index()
    v7_to_syl = build_v7_to_syllables(index)
    all_codes = _all_valid_v7_codes()
    print(f"  Total valid v7 codes: {len(all_codes)}")

    covered: set[str] = set()

    print("Converting sentences to training records…")
    records = _collect_from_sentences(SENTENCES, covered)
    print(f"  Records from natural sentences: {len(records)}")

    print("Adding coverage-boost records…")
    boost = _coverage_boost_records(v7_to_syl, covered, all_codes)
    records.extend(boost)
    print(f"  Coverage-boost records added: {len(boost)}")

    print("Generating structural variants…")
    variants = _variant_records(records[:500])  # limit to avoid blowup
    records.extend(variants)
    print(f"  Variant records added: {len(variants)}")

    print(f"Total records before dedup: {len(records)}")

    # Deduplicate by (user content) to avoid near-identical samples
    seen: set[str] = set()
    deduped: list[dict] = []
    for rec in records:
        key = rec["messages"][0]["content"]
        if key not in seen:
            seen.add(key)
            deduped.append(rec)
    records = deduped
    print(f"Total records after dedup: {len(records)}")

    coverage_pct = 100.0 * len(covered) / len(all_codes)
    print(f"v7 code coverage: {len(covered)}/{len(all_codes)} ({coverage_pct:.1f}%)")

    _ensure_dir(output_path)
    with open(output_path, "w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"Dataset written to {output_path} ({len(records)} records).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
