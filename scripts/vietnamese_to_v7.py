#!/usr/bin/env python3
import re
import sys
import unicodedata


TONE_KIND = {
    "á": "sac", "ắ": "sac", "ấ": "sac", "é": "sac", "ế": "sac", "í": "sac",
    "ó": "sac", "ố": "sac", "ớ": "sac", "ú": "sac", "ứ": "sac", "ý": "sac",
    "à": "huyen", "ằ": "huyen", "ầ": "huyen", "è": "huyen", "ề": "huyen", "ì": "huyen",
    "ò": "huyen", "ồ": "huyen", "ờ": "huyen", "ù": "huyen", "ừ": "huyen", "ỳ": "huyen",
    "ả": "hoi", "ẳ": "hoi", "ẩ": "hoi", "ẻ": "hoi", "ể": "hoi", "ỉ": "hoi",
    "ỏ": "hoi", "ổ": "hoi", "ở": "hoi", "ủ": "hoi", "ử": "hoi", "ỷ": "hoi",
    "ã": "nga", "ẵ": "nga", "ẫ": "nga", "ẽ": "nga", "ễ": "nga", "ĩ": "nga",
    "õ": "nga", "ỗ": "nga", "ỡ": "nga", "ũ": "nga", "ữ": "nga", "ỹ": "nga",
    "ạ": "nang", "ặ": "nang", "ậ": "nang", "ẹ": "nang", "ệ": "nang", "ị": "nang",
    "ọ": "nang", "ộ": "nang", "ợ": "nang", "ụ": "nang", "ự": "nang", "ỵ": "nang",
}


def normalize_rime_start(ch: str) -> str:
    if ch in ("y", "Y"):
        return "i"
    decomp = unicodedata.normalize("NFD", ch)
    base = "".join(c for c in decomp if unicodedata.category(c) != "Mn")
    base = base.lower().replace("đ", "d")
    return base[:1]


def split_onset(word: str) -> tuple[str, str]:
    if word.startswith("qu"):
        return "w", word[2:]
    if word.startswith("gi"):
        return "z", word[2:]
    if word.startswith("ngh"):
        return "ng", word[3:]
    if word.startswith("gh"):
        return "g", word[2:]
    for src, code in [
        ("tr", "tr"), ("th", "th"), ("ch", "ch"), ("nh", "nh"), ("ng", "ng"),
        ("kh", "kh"), ("ph", "ph"), ("đ", "dd"), ("d", "d"), ("x", "x"), ("v", "v"),
        ("t", "t"), ("s", "s"), ("r", "r"), ("p", "p"), ("n", "n"), ("m", "m"),
        ("l", "l"), ("h", "h"), ("g", "g"), ("k", "k"), ("c", "k"), ("b", "b"),
    ]:
        if word.startswith(src):
            return code, word[len(src):]
    return "0", word


def detect_tone(word: str) -> str:
    for ch in word:
        tone = TONE_KIND.get(ch)
        if tone is not None:
            return tone
    return "ngang"


def tone_digit(word: str) -> str:
    tone = detect_tone(word)
    checked = word.endswith(("c", "ch", "p", "t"))
    if checked and tone == "sac":
        return "6"
    if checked and tone == "nang":
        return "7"
    return {
        "ngang": "0",
        "sac": "1",
        "huyen": "2",
        "hoi": "3",
        "nga": "4",
        "nang": "5",
    }.get(tone, "0")


VALID_V7_CONSONANTS = frozenset({
    "0", "b", "ch", "d", "dd", "g", "h", "k", "kh", "l", "m", "n",
    "ng", "nh", "p", "ph", "r", "s", "t", "th", "tr", "v", "w", "x", "z",
})
VALID_V7_VOWELS = frozenset({"a", "e", "i", "o", "u"})


def is_syllable_valid(word: str) -> bool:
    """Return True if *word* can be faithfully represented as a v7 code.

    A syllable is valid when its v7 encoding (onset + rime-start vowel + tone)
    falls within the set of combinations that the inference engine can decode
    back to at least one Vietnamese syllable.  Concretely this means:
      - The rime-start character (after NFD normalisation and diacritic removal)
        must be one of {a, e, i, o, u}.
      - The (onset, vowel) pair must not be the unsupported combination (w, u).
    """
    if not word:
        return False
    onset_code, rime = split_onset(word)
    if not rime:
        rime = word
    if not rime:
        return False
    rime_start = normalize_rime_start(rime[0])
    if not rime_start or rime_start not in VALID_V7_VOWELS:
        return False
    if onset_code == "w" and rime_start == "u":
        return False
    return True


def encode_word(word: str) -> str:
    onset_code, rime = split_onset(word)
    if not rime:
        rime = word
    rime_start = normalize_rime_start(rime[0])
    if not rime_start:
        rime_start = "a"
    return f"{onset_code}{rime_start}{tone_digit(word)}"


def vietnamese_to_v7(sentence: str) -> str:
    cleaned = re.sub(r"[^\w\s\u00C0-\u1EF9đĐ]", " ", sentence.lower())
    cleaned = re.sub(r"[\d_]", " ", cleaned)
    words = [w for w in cleaned.split() if w]
    return "".join(encode_word(word) for word in words)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: vietnamese_to_v7.py '<vietnamese sentence>'", file=sys.stderr)
        return 1
    text = " ".join(sys.argv[1:])
    print(vietnamese_to_v7(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
