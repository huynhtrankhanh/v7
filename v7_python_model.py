import argparse
import json
import math
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


CONSONANT_CODES = [
    "dd",
    "ch",
    "kh",
    "ng",
    "nh",
    "ph",
    "th",
    "tr",
    "b",
    "d",
    "g",
    "h",
    "k",
    "l",
    "m",
    "n",
    "p",
    "r",
    "s",
    "t",
    "v",
    "w",
    "x",
    "z",
    "0",
]

ONSET_TO_CODE = {
    "đ": "dd",
    "qu": "w",
    "gi": "z",
    "gh": "g",
    "g": "g",
    "ngh": "ng",
    "ng": "ng",
    "ch": "ch",
    "kh": "kh",
    "nh": "nh",
    "ph": "ph",
    "th": "th",
    "tr": "tr",
    "b": "b",
    "c": "k",
    "k": "k",
    "q": "k",
    "d": "d",
    "h": "h",
    "l": "l",
    "m": "m",
    "n": "n",
    "p": "p",
    "r": "r",
    "s": "s",
    "t": "t",
    "v": "v",
    "x": "x",
}

ONSETS_SORTED = sorted(ONSET_TO_CODE.keys(), key=len, reverse=True)
TOKEN_RE = re.compile(r"\w+|[^\w\s]", re.UNICODE)
WORD_ONLY_RE = re.compile(r"^[^\W\d_]+$", re.UNICODE)

TONE_CHAR_MAP = {
    "a": ("a", 0), "á": ("a", 1), "à": ("a", 2), "ả": ("a", 3), "ã": ("a", 4), "ạ": ("a", 5),
    "ă": ("ă", 0), "ắ": ("ă", 1), "ằ": ("ă", 2), "ẳ": ("ă", 3), "ẵ": ("ă", 4), "ặ": ("ă", 5),
    "â": ("â", 0), "ấ": ("â", 1), "ầ": ("â", 2), "ẩ": ("â", 3), "ẫ": ("â", 4), "ậ": ("â", 5),
    "e": ("e", 0), "é": ("e", 1), "è": ("e", 2), "ẻ": ("e", 3), "ẽ": ("e", 4), "ẹ": ("e", 5),
    "ê": ("ê", 0), "ế": ("ê", 1), "ề": ("ê", 2), "ể": ("ê", 3), "ễ": ("ê", 4), "ệ": ("ê", 5),
    "i": ("i", 0), "í": ("i", 1), "ì": ("i", 2), "ỉ": ("i", 3), "ĩ": ("i", 4), "ị": ("i", 5),
    "o": ("o", 0), "ó": ("o", 1), "ò": ("o", 2), "ỏ": ("o", 3), "õ": ("o", 4), "ọ": ("o", 5),
    "ô": ("ô", 0), "ố": ("ô", 1), "ồ": ("ô", 2), "ổ": ("ô", 3), "ỗ": ("ô", 4), "ộ": ("ô", 5),
    "ơ": ("ơ", 0), "ớ": ("ơ", 1), "ờ": ("ơ", 2), "ở": ("ơ", 3), "ỡ": ("ơ", 4), "ợ": ("ơ", 5),
    "u": ("u", 0), "ú": ("u", 1), "ù": ("u", 2), "ủ": ("u", 3), "ũ": ("u", 4), "ụ": ("u", 5),
    "ư": ("ư", 0), "ứ": ("ư", 1), "ừ": ("ư", 2), "ử": ("ư", 3), "ữ": ("ư", 4), "ự": ("ư", 5),
    "y": ("y", 0), "ý": ("y", 1), "ỳ": ("y", 2), "ỷ": ("y", 3), "ỹ": ("y", 4), "ỵ": ("y", 5),
}

RIME_LETTER_NORMALIZE = {
    "ă": "a",
    "â": "a",
    "ê": "e",
    "ô": "o",
    "ơ": "o",
    "ư": "u",
    "y": "i",
}


def tokenize_keep_everything(text: str) -> List[str]:
    return TOKEN_RE.findall(text)


def is_word_token(token: str) -> bool:
    return bool(WORD_ONLY_RE.match(token))


def split_onset(word: str) -> Tuple[str, str]:
    for onset in ONSETS_SORTED:
        if word.startswith(onset):
            return onset, word[len(onset):]
    return "", word


def strip_tone_char(ch: str) -> str:
    base, _ = TONE_CHAR_MAP.get(ch, (ch, 0))
    return base


def detect_tone(word: str) -> int:
    tone = 0
    for ch in word:
        if ch in TONE_CHAR_MAP:
            _, tone = TONE_CHAR_MAP[ch]
            if tone != 0:
                return tone
    return tone


def strip_tone_word(word: str) -> str:
    return "".join(strip_tone_char(ch) for ch in word)


def is_stop_coda(stripped_word: str) -> bool:
    return stripped_word.endswith("c") or stripped_word.endswith("ch") or stripped_word.endswith("p") or stripped_word.endswith("t")


def normalize_rime_first_letter(ch: str) -> str:
    base = strip_tone_char(ch)
    return RIME_LETTER_NORMALIZE.get(base, base)


def encode_word_to_v7(word: str) -> Optional[str]:
    lowered = word.lower()
    if not lowered:
        return None
    onset, rime = split_onset(lowered)
    if not rime:
        return None
    code_consonant = ONSET_TO_CODE.get(onset, "0" if onset == "" else None)
    if code_consonant is None:
        return None
    tone = detect_tone(lowered)
    stripped_word = strip_tone_word(lowered)
    if is_stop_coda(stripped_word):
        if tone == 1:
            v7_tone = 6
        elif tone == 5:
            v7_tone = 7
        else:
            return None
    else:
        v7_tone = tone
    rime_first = normalize_rime_first_letter(rime[0])
    if len(rime_first) != 1 or not rime_first.isalpha():
        return None
    return f"{code_consonant}_{rime_first}_{v7_tone}"


def parse_v7_string(v7_string: str) -> List[str]:
    remaining = v7_string
    syllables: List[str] = []
    sorted_codes = sorted(CONSONANT_CODES, key=len, reverse=True)
    while remaining:
        matched = None
        for code in sorted_codes:
            if remaining.startswith(code):
                matched = code
                remaining = remaining[len(code):]
                break
        if matched is None:
            raise ValueError(f"Could not parse consonant at: {remaining}")
        if len(remaining) < 2:
            raise ValueError(f"Incomplete syllable at: {remaining}")
        rime = remaining[0]
        tone = remaining[1]
        if not tone.isdigit():
            raise ValueError(f"Expected tone digit, got: {tone}")
        syllables.append(f"{matched}_{rime}_{tone}")
        remaining = remaining[2:]
    return syllables


class TransformerReranker:
    def __init__(self, model_path: str, max_length: int = 128):
        try:
            import torch
            from transformers import AutoModelForMaskedLM, AutoTokenizer
        except ImportError as exc:  # pragma: no cover - import errors environment-dependent
            raise RuntimeError(
                "Transformer dependencies are required. Install from requirements.txt first."
            ) from exc

        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, use_fast=True)
        self.model = AutoModelForMaskedLM.from_pretrained(model_path)
        self.model.eval()
        self.max_length = max_length
        self.mask_id = self.tokenizer.mask_token_id
        if self.mask_id is None:
            raise RuntimeError("Loaded model tokenizer has no mask token; use a masked-LM model.")

    def _candidate_span(self, left_text: str, candidate: str, right_text: str) -> Tuple[List[int], int, int]:
        left_ids = self.tokenizer(left_text, add_special_tokens=False)["input_ids"]
        full_ids = self.tokenizer(left_text + candidate + right_text, add_special_tokens=False)["input_ids"]
        cand_ids = self.tokenizer(candidate, add_special_tokens=False)["input_ids"]
        start = len(left_ids)
        end = min(start + len(cand_ids), len(full_ids))
        return full_ids, start, end

    def score(self, left_text: str, candidate: str, right_text: str) -> float:
        input_ids, start, end = self._candidate_span(left_text, candidate, right_text)
        if start >= end:
            return -1e9
        if len(input_ids) > self.max_length:
            window_start = max(0, start - (self.max_length // 2))
            window_end = min(len(input_ids), window_start + self.max_length)
            input_ids = input_ids[window_start:window_end]
            start = max(0, start - window_start)
            end = min(len(input_ids), end - window_start)

        total = 0.0
        with self.torch.no_grad():
            for idx in range(start, end):
                masked = list(input_ids)
                target = masked[idx]
                masked[idx] = self.mask_id
                batch = self.torch.tensor([masked], dtype=self.torch.long)
                out = self.model(batch).logits[0, idx]
                log_probs = self.torch.log_softmax(out, dim=-1)
                total += float(log_probs[target])
        return total


@dataclass
class TrainedV7Model:
    code_to_forms: Dict[str, List[Tuple[str, int]]]
    total_observations: int

    @classmethod
    def from_json(cls, path: str) -> "TrainedV7Model":
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(
            code_to_forms={k: [(w, int(c)) for w, c in v] for k, v in data["code_to_forms"].items()},
            total_observations=int(data["total_observations"]),
        )

    def to_json(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "code_to_forms": self.code_to_forms,
                    "total_observations": self.total_observations,
                },
                f,
                ensure_ascii=False,
            )

    def _candidate_score(
        self,
        reranker: Optional[TransformerReranker],
        left_text: str,
        right_text: str,
        candidate: str,
        count: int,
    ) -> float:
        base_score = math.log(count + 1.0)
        if reranker is None:
            return base_score
        return base_score + reranker.score(left_text, candidate, right_text)

    def infer_islands(
        self,
        islands: Sequence[str],
        beam_width: int = 40,
        max_candidates_per_code: int = 24,
        reranker: Optional[TransformerReranker] = None,
    ) -> List[List[str]]:
        if not islands:
            return []
        beams: List[Tuple[float, List[str], str]] = [(0.0, [], "")]
        for idx, segment in enumerate(islands):
            if idx % 2 == 0:
                beams = [(score, decoded + [segment], full_text + segment) for score, decoded, full_text in beams]
                continue

            code_keys = parse_v7_string(segment)
            right_text = islands[idx + 1] if idx + 1 < len(islands) else ""

            active = beams
            for code_idx, code_key in enumerate(code_keys):
                expanded: List[Tuple[float, List[str], str]] = []
                is_last_in_island = code_idx == len(code_keys) - 1
                per_step_right = right_text if is_last_in_island else ""
                forms = self.code_to_forms.get(code_key, [])
                if not forms:
                    forms = [(code_key.replace("_", ""), 1)]
                forms = forms[:max_candidates_per_code]
                for score, decoded, full_text in active:
                    for rank, (candidate, count) in enumerate(forms):
                        left = full_text
                        spacer = "" if (left.endswith(" ") or left == "" or left.endswith("\n")) else " "
                        candidate_with_space = f"{spacer}{candidate}"
                        cand_score = self._candidate_score(
                            reranker=reranker,
                            left_text=left,
                            right_text=per_step_right,
                            candidate=candidate_with_space,
                            count=count,
                        )
                        rank_penalty = 0.01 * rank
                        new_full = full_text + candidate_with_space
                        expanded.append((score + cand_score - rank_penalty, decoded + [candidate], new_full))
                expanded.sort(key=lambda x: x[0], reverse=True)
                active = expanded[:beam_width]

            merged = []
            for score, decoded, full_text in active:
                merged.append((score, decoded[:-len(code_keys)] + [" ".join(decoded[-len(code_keys):])], full_text))
            beams = merged[:beam_width]

        beams.sort(key=lambda x: x[0], reverse=True)
        return [decoded for _, decoded, _ in beams[:beam_width]]


def train_model(
    corpus_lines: Iterable[str],
    max_forms_per_code: int = 128,
) -> TrainedV7Model:
    code_to_forms_counts: Dict[str, Counter] = defaultdict(Counter)
    total_observations = 0

    for line in corpus_lines:
        tokens = tokenize_keep_everything(line)
        for token in tokens:
            if not is_word_token(token):
                continue
            code = encode_word_to_v7(token)
            if not code:
                continue
            code_to_forms_counts[code][token] += 1
            total_observations += 1

    code_to_forms = {
        code: [(word, int(count)) for word, count in counts.most_common(max_forms_per_code)]
        for code, counts in code_to_forms_counts.items()
    }
    return TrainedV7Model(code_to_forms=code_to_forms, total_observations=total_observations)


def train_from_file(
    corpus_path: str,
    output_path: str,
    max_forms_per_code: int = 128,
) -> None:
    start = time.time()
    with open(corpus_path, "r", encoding="utf-8") as f:
        model = train_model(f, max_forms_per_code=max_forms_per_code)
    model.to_json(output_path)
    elapsed_ms = int((time.time() - start) * 1000)
    print(f"Saved model to {output_path} ({model.total_observations} samples, {elapsed_ms}ms)")


def _main() -> None:
    parser = argparse.ArgumentParser(description="Train V7 Python model for transformer reranking.")
    parser.add_argument("--corpus", required=True, help="Input corpus file path.")
    parser.add_argument("--output", default="v7_python_model.json", help="Output model json path.")
    parser.add_argument("--max-forms-per-code", type=int, default=128)
    args = parser.parse_args()
    train_from_file(
        corpus_path=args.corpus,
        output_path=args.output,
        max_forms_per_code=args.max_forms_per_code,
    )


if __name__ == "__main__":
    _main()
