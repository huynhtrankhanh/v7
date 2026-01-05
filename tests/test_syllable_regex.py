import unittest
import random
import re
import sys
import os

# Add repo root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from v7 import Syllable, CompleteSyllableTemplate, PartialSyllableTemplate
from ai.tokenizer import tokenizer, Triplet
from utils.preprocess import remove_diacritics

class TestSyllableRegex(unittest.TestCase):
    def setUp(self):
        # Collect all valid non-padding syllables
        self.valid_triplets = []
        self.valid_indices = []
        for i, t in enumerate(tokenizer.renum_triplet):
            if i != tokenizer.PADDING_TOKEN_INDEX and t is not None:
                self.valid_triplets.append(t)
                self.valid_indices.append(i)

        self.syllable_map = {
            i: tokenizer.renum[i] for i in self.valid_indices if i in tokenizer.renum
        }

    def test_complete_syllable_regex(self):
        # Test a random sample of syllables
        sample_indices = random.sample(self.valid_indices, min(100, len(self.valid_indices)))

        for idx in sample_indices:
            t = tokenizer.renum_triplet[idx]
            s = Syllable.from_triplet(t)
            template = CompleteSyllableTemplate(syllable=s)

            regex = template.get_regex()
            text = tokenizer.renum[idx]

            # Verify regex matches the text
            self.assertTrue(bool(re.fullmatch(regex, text)), f"Regex {regex} failed to match {text}")

            # Verify uniqueness (mostly): shouldn't match random other strings easily
            # Pick another random text
            other_idx = random.choice(self.valid_indices)
            if tokenizer.renum[other_idx] != text:
                # It *might* match if regex is loose, but Complete regex is escaped string, so it shouldn't
                self.assertFalse(bool(re.fullmatch(regex, tokenizer.renum[other_idx])),
                                 f"Regex {regex} matched unrelated {tokenizer.renum[other_idx]}")

    def test_partial_syllable_regex(self):
        # Test a random sample
        sample_indices = random.sample(self.valid_indices, min(20, len(self.valid_indices)))

        for idx in sample_indices:
            t = tokenizer.renum_triplet[idx]
            s = Syllable.from_triplet(t)

            # Create a PartialSyllableTemplate from this syllable
            # We need rhyme_first_letter
            norm_rhyme = remove_diacritics(s.rhyme)
            if not norm_rhyme:
                continue # Should not happen given valid triplets usually have rhymes

            template = PartialSyllableTemplate(
                consonant=s.consonant,
                rhyme_first_letter=norm_rhyme[0],
                tone=s.tone
            )

            regex = template.get_regex()
            pattern = re.compile(regex)

            # 1. Verify it matches the source syllable's text
            text = tokenizer.renum[idx]
            self.assertTrue(bool(pattern.fullmatch(text)),
                            f"Partial regex {regex} failed to match source {text} for template {template}")

            # 2. Verify against ALL syllables (property test style)
            # This ensures coverage and correctness
            # Optimization: Check all, but efficiently?
            # 17k is small enough for 20 samples -> 340k checks. fast enough.

            # To handle homophones:
            # If pattern matches s_text, then s MUST match template OR be a homophone of a match.
            # Simpler: If pattern matches s_text, then there exists a syllable s' such that s'.to_str() == s_text and template.matches(s')

            # Let's verify:
            # A: If template.matches(s), then pattern matches s.to_str()
            # B: If pattern matches s.to_str(), then s is "compatible" with template (possibly via homophone)

            # Pre-calculate matching texts for this template to verify B
            expected_matches = set()
            for i in self.valid_indices:
                other_t = tokenizer.renum_triplet[i]
                other_s = Syllable.from_triplet(other_t)
                if template.matches(other_s):
                    expected_matches.add(tokenizer.renum[i])

            for i in self.valid_indices:
                other_t = tokenizer.renum_triplet[i]
                other_s = Syllable.from_triplet(other_t)
                other_text = tokenizer.renum[i]

                is_match = bool(pattern.fullmatch(other_text))
                should_match = other_text in expected_matches

                if should_match:
                    self.assertTrue(is_match, f"Regex {regex} failed to match {other_text} which should match template {template}")
                else:
                    self.assertFalse(is_match, f"Regex {regex} matched {other_text} but it shouldn't match template {template}")

    def test_random_strings(self):
        # Verify that regexes don't match garbage
        garbage = ["", "abc", "123", "verylongstringthatshouldnotmatch", "b", "ba "]

        # Pick a random template
        idx = random.choice(self.valid_indices)
        t = tokenizer.renum_triplet[idx]
        s = Syllable.from_triplet(t)

        norm_rhyme = remove_diacritics(s.rhyme)
        if norm_rhyme:
            template = PartialSyllableTemplate(
                consonant=s.consonant,
                rhyme_first_letter=norm_rhyme[0],
                tone=s.tone
            )
            regex = template.get_regex()
            pattern = re.compile(regex)

            matching_garbage = [g for g in garbage if pattern.fullmatch(g)]
            # It's possible "b" or "abc" is a valid syllable?
            # Check against valid syllables
            valid_texts = set(self.syllable_map.values())

            for g in matching_garbage:
                 if g not in valid_texts:
                     self.fail(f"Regex {regex} matched invalid garbage '{g}'")

if __name__ == '__main__':
    unittest.main()
