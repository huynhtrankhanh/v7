from v7 import PartialSyllableTemplate
from ai.tokenizer import tokenizer

def parse_v7_string(v7_string: str):
    """
    Parses a v7 string (compact format: consonant + rhyme_start + tone)
    into a list of PartialSyllableTemplate.

    Example: na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
    """
    # Get all valid consonants from the tokenizer
    # And allow 'dd' as an alias for 'đ'
    valid_consonants_map = {}
    for t in tokenizer.renum_triplet:
        if t:
            valid_consonants_map[t.consonant] = t.consonant

    valid_consonants_map['dd'] = 'đ'

    # Sort keys by length descending
    sorted_keys = sorted(valid_consonants_map.keys(), key=len, reverse=True)

    templates = []
    i = 0
    n = len(v7_string)

    while i < n:
        # 1. Match Consonant
        matched_key = None
        for key in sorted_keys:
            if v7_string.startswith(key, i):
                matched_key = key
                i += len(key)
                break

        if matched_key is None:
            raise ValueError(f"Could not parse consonant at index {i}: {v7_string[i:]}")

        consonant = valid_consonants_map[matched_key]

        # 2. Match Rhyme Start Letter (1 char)
        if i >= n:
            raise ValueError("Unexpected end of string while looking for rhyme start")
        rhyme_start = v7_string[i]
        i += 1

        # 3. Match Tone (1 char, digit)
        if i >= n:
            raise ValueError("Unexpected end of string while looking for tone")
        tone_char = v7_string[i]
        if not tone_char.isdigit():
             raise ValueError(f"Expected digit for tone at index {i}, got {tone_char}")
        tone = int(tone_char)
        i += 1

        templates.append(PartialSyllableTemplate(
            consonant=consonant,
            rhyme_first_letter=rhyme_start,
            tone=tone
        ))

    return templates

def main():
    v7_input = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7"
    print(f"Input v7 string: {v7_input}")

    try:
        templates = parse_v7_string(v7_input)
    except ValueError as e:
        print(f"Error parsing input: {e}")
        return

    print(f"Parsed {len(templates)} templates.")

    print("\nGenerating regex constraints:")
    regexes = []
    for idx, t in enumerate(templates):
        regex = t.get_regex()
        regexes.append(regex)
        print(f"Word {idx+1}: {regex}")

    full_sentence_regex = r"\s+".join(regexes)
    print("\nFull Sentence Regex:")
    print(full_sentence_regex)

if __name__ == "__main__":
    main()
