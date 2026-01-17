import sys
import os
import re
import kenlm
import heapq
from v7 import PartialSyllableTemplate, Syllable, SyllableTemplate
from ai.tokenizer import tokenizer

# Load the KenLM model
MODEL_PATH = "lm.binary"
if not os.path.exists(MODEL_PATH):
    print(f"Error: Model file '{MODEL_PATH}' not found. Please train the model first.")
    sys.exit(1)

model = kenlm.Model(MODEL_PATH)

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
            # raise ValueError(f"Could not parse consonant at index {i}: {v7_string[i:]}")
            # If no consonant matches, it might be a syllable starting with a vowel (empty consonant)?
            # But v7 spec usually implies explicit consonants.
            # Let's check if 'missing consonant' is handled by empty string if it's in the map.
            # In Vietnamese, syllables without explicit consonant usually have empty string consonant.
            # If our tokenizer has empty string as consonant:
            if '' in valid_consonants_map:
                 matched_key = ''
                 # Don't advance i
            else:
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

def get_candidates(template: PartialSyllableTemplate) -> list[str]:
    """
    Returns a list of candidate words that match the given template.
    """
    candidates = []
    # We iterate over the vocabulary to find matches.
    # Optimization: This could be precomputed or indexed if slow.
    for i, t in enumerate(tokenizer.renum_triplet):
        if i == tokenizer.PADDING_TOKEN_INDEX or t is None:
            continue
        
        s = Syllable.from_triplet(t)
        if template.matches(s):
            text = tokenizer.renum.get(i)
            if text:
                candidates.append(text)
    return candidates

def beam_search(templates: list[PartialSyllableTemplate], beam_width=100):
    """
    Performs beam search to find the most likely sentence using KenLM.
    """
    # Initial state: (score, [words], state)
    # KenLM state for n-gram context
    
    initial_state = kenlm.State()
    model.BeginSentenceWrite(initial_state)
    
    # Beam: list of tuples (score, words_list, lm_state)
    beam = [(0.0, [], initial_state)]
    
    for template in templates:
        candidates = get_candidates(template)
        if not candidates:
            print(f"Warning: No candidates found for template {template}")
            # If no candidates, we might have to skip or insert a placeholder?
            # For now, let's just abort this branch or treat it as a skip.
            # Or maybe add a placeholder "<?>"
            candidates = ["<?>"]
        
        new_beam = []
        
        for score, words, state in beam:
            for word in candidates:
                # Calculate new score
                new_state = kenlm.State()
                
                # word_score = model.Score(state, word, new_state) # This expects a single word string?
                # kenlm python binding: model.Score(state, word, out_state)
                # Note: kenlm usually handles spaces in 'word' as multiple tokens if using BaseSingleModel?
                # But here 'word' is a syllable from our tokenizer.
                # It might be a single token or multiple chars. 
                # KenLM treats input string as space-separated tokens.
                # Our syllables are usually single words (in the sense of tokens), but might contain spaces? 
                # Vietnamese syllables don't contain spaces.
                
                # However, our candidate words are from tokenizer.renum which are strings.
                # Let's assume they are single tokens for KenLM or we pass them as is.
                
                # If word is "<?>", give it a penalty?
                if word == "<?>":
                    word_score = -10.0 # Heavy penalty
                    # state doesn't change much?
                    new_state = state 
                else:
                    try:
                        word_score = model.BaseScore(state, word, new_state)
                    except Exception:
                        # Fallback if something weird happens (e.g. unknown char)
                        word_score = -20.0
                        new_state = state
                
                new_total_score = score + word_score
                new_beam.append((new_total_score, words + [word], new_state))
        
        # Keep top K
        # We want largest scores (log probabilities are negative, closer to 0 is better)
        new_beam.sort(key=lambda x: x[0], reverse=True)
        beam = new_beam[:beam_width]
        
    return beam

def main():
    # v7_input = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7"
    # Let's take input from args or use the default
    if len(sys.argv) > 1:
        v7_input = sys.argv[1]
    else:
        v7_input = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7"
        
    print(f"Input v7 string: {v7_input}")

    try:
        templates = parse_v7_string(v7_input)
    except ValueError as e:
        print(f"Error parsing input: {e}")
        return

    print(f"Parsed {len(templates)} templates.")
    
    print("Running Beam Search...")
    best_beams = beam_search(templates)
    
    print("\nTop results:")
    for i, (score, words, _) in enumerate(best_beams[:5]):
        sentence = " ".join(words)
        print(f"{i+1}. [{score:.4f}] {sentence}")

if __name__ == "__main__":
    main()
