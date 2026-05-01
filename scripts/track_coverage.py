#!/usr/bin/env python3
"""Track v7 code coverage and inferenceable-syllable coverage for a dataset.

Usage:
  python scripts/track_coverage.py [dataset_path]

The default dataset path is dataset/finetune.jsonl.

Metrics reported
----------------
v7_codes_covered      : fraction of the 992 valid (consonant × vowel × tone)
                        codes that appear at least once in a v7 island.
syllables_covered     : fraction of distinct Vietnamese syllables (the correct
                        answer per syllable position) seen in the dataset out of
                        all syllables enumerated from the regex candidates index.
"""

import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from generate_dataset import (
    build_candidates_index,
    build_v7_to_syllables,
    _all_valid_v7_codes,
)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

_ONSET_2 = {"ch", "dd", "kh", "ng", "nh", "ph", "th", "tr"}
_ONSET_1 = {"b", "d", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "x", "z", "0"}


def _extract_v7_codes(v7_island: str) -> list[str]:
    """Extract individual v7 codes from a concatenated v7 island string."""
    codes: list[str] = []
    pos = 0
    while pos < len(v7_island):
        matched = False
        for olen in (2, 1):
            onset = v7_island[pos:pos + olen]
            if onset in _ONSET_2 or (olen == 1 and onset in _ONSET_1):
                rest = v7_island[pos + olen:]
                if len(rest) >= 2 and rest[0] in "aeiou" and rest[1].isdigit():
                    codes.append(onset + rest[0] + rest[1])
                    pos += olen + 2
                    matched = True
                    break
        if not matched:
            pos += 1
    return codes


def _extract_syllables_from_assistant(text: str) -> list[str]:
    """Split the assistant response into individual Vietnamese syllables."""
    return [w for w in re.split(r"\s+", text.strip()) if w]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    dataset_path = sys.argv[1] if len(sys.argv) > 1 else "dataset/finetune.jsonl"

    if not os.path.exists(dataset_path):
        print(f"ERROR: dataset not found at {dataset_path}", file=sys.stderr)
        return 1

    print("Building candidates index…")
    index = build_candidates_index()
    v7_to_syl = build_v7_to_syllables(index)
    all_codes = _all_valid_v7_codes()

    # All syllables that can theoretically appear (union of all candidates)
    all_syllables: set[str] = set()
    for syls in index.values():
        all_syllables.update(syls)
    print(f"  Total valid v7 codes         : {len(all_codes)}")
    print(f"  Total inferenceable syllables: {len(all_syllables)}")

    print(f"\nReading {dataset_path}…")
    records = []
    with open(dataset_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(f"  Records: {len(records)}")

    # ── Collect statistics ────────────────────────────────────────────────
    seen_v7_codes: set[str] = set()
    seen_syllables: set[str] = set()
    v7_code_freq: Counter = Counter()
    syllable_freq: Counter = Counter()
    island_count_dist: Counter = Counter()
    empty_leading_fixed = 0
    total_v7_islands = 0

    prefix = "Perform the following v7 inference request: "

    for rec in records:
        msgs = rec.get("messages", [])
        user_msg = next((m["content"] for m in msgs if m["role"] == "user"), "")
        asst_msg = next((m["content"] for m in msgs if m["role"] == "assistant"), "")

        if not user_msg.startswith(prefix):
            continue

        islands: list[str] = json.loads(user_msg[len(prefix):])
        island_count_dist[len(islands)] += 1

        if islands and islands[0] == "":
            empty_leading_fixed += 1

        for i, island in enumerate(islands):
            if i % 2 == 1:  # v7 island
                total_v7_islands += 1
                codes = _extract_v7_codes(island)
                seen_v7_codes.update(codes)
                for c in codes:
                    v7_code_freq[c] += 1

        # Syllables from assistant response
        for syl in _extract_syllables_from_assistant(asst_msg):
            # Remove punctuation
            clean = syl.strip(".,!?;:\"'«»""''()")
            if clean:
                seen_syllables.add(clean)
                syllable_freq[clean] += 1

    # ── Coverage numbers ──────────────────────────────────────────────────
    v7_covered = len(seen_v7_codes)
    syl_covered = len(seen_syllables & all_syllables)

    print("\n══ Coverage Report ════════════════════════════════════════")
    print(f"  v7 codes covered     : {v7_covered:4d} / {len(all_codes)}  "
          f"({100*v7_covered/len(all_codes):.1f}%)")
    print(f"  Syllables covered    : {syl_covered:4d} / {len(all_syllables)}  "
          f"({100*syl_covered/len(all_syllables):.1f}%)")
    print(f"  Total records        : {len(records)}")
    print(f"  Total v7 islands     : {total_v7_islands}")
    print(f"  Empty leading fixed  : {empty_leading_fixed}  "
          f"({100*empty_leading_fixed/max(len(records),1):.1f}% of records)")

    print("\n── Island-count distribution ──────────────────────────────")
    for cnt in sorted(island_count_dist):
        print(f"  {cnt} islands: {island_count_dist[cnt]} records")

    print("\n── Top-20 most-frequent v7 codes ──────────────────────────")
    for code, freq in v7_code_freq.most_common(20):
        print(f"  {code:6s}  {freq:4d}x")

    print("\n── Top-20 most-frequent syllables ─────────────────────────")
    for syl, freq in syllable_freq.most_common(20):
        print(f"  {syl:20s}  {freq:4d}x")

    # ── Uncovered codes ───────────────────────────────────────────────────
    uncovered = sorted(set(all_codes) - seen_v7_codes)
    if uncovered:
        print(f"\n── Uncovered v7 codes ({len(uncovered)}) ──")
        for i in range(0, min(len(uncovered), 60), 10):
            print("  " + "  ".join(uncovered[i:i+10]))
    else:
        print("\n✓ All valid v7 codes are covered!")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
