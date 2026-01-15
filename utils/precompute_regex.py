import json
import os
import sys

# Add repo root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from v7 import PartialSyllableTemplate, Syllable
from ai.tokenizer import tokenizer
from utils.preprocess import remove_diacritics

def precompute_regexes():
    print("Precomputing regexes...")
    regex_map = {}

    # Identify all unique keys from the tokenizer
    unique_keys = set()
    for t in tokenizer.renum_triplet:
        if t is None:
            continue

        rhyme = remove_diacritics(t.rhyme)
        if not rhyme:
            continue

        key = (t.consonant, rhyme[0], t.tone)
        unique_keys.add(key)

    print(f"Found {len(unique_keys)} unique PartialSyllableTemplate combinations.")

    count = 0
    for consonant, rhyme_first_letter, tone in unique_keys:
        template = PartialSyllableTemplate(
            consonant=consonant,
            rhyme_first_letter=rhyme_first_letter,
            tone=tone
        )
        regex = template.get_regex()

        # Key format: "consonant_rhymefirstletter_tone"
        # We need to be careful with separators if keys can contain them.
        # Consonants are like 'kh', 'ng'. Rhyme letters are single chars. Tones are ints.
        # Underscore seems safe enough if letters are a-z.
        # But wait, to be safe, maybe use a structured key or a separator that won't clash.
        # JSON keys must be strings.
        # "kh_a_0" looks fine.

        key_str = f"{consonant}_{rhyme_first_letter}_{tone}"
        regex_map[key_str] = regex

        count += 1
        if count % 100 == 0:
            print(f"Processed {count}/{len(unique_keys)}")

    output_path = os.path.join("ai", "generated_regexes.json")
    print(f"Saving {len(regex_map)} regexes to {output_path}...")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(regex_map, f, ensure_ascii=False, indent=2)

    print("Done.")

if __name__ == "__main__":
    precompute_regexes()
