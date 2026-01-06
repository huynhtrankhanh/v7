from dataclasses import dataclass
from abc import ABC, abstractmethod
import re
import json
import os

from ai.tokenizer import tokenizer, Triplet
from utils.preprocess import remove_diacritics
from utils.regex_gen import generate_regex_from_strings

# Load precomputed regexes
PRECOMPUTED_REGEXES = {}
try:
    regex_path = os.path.join(os.path.dirname(__file__), "ai", "generated_regexes.json")
    with open(regex_path, "r", encoding="utf-8") as f:
        PRECOMPUTED_REGEXES = json.load(f)
except Exception as e:
    print(f"Warning: Could not load precomputed regexes from {regex_path}: {e}")

# Data Structures
@dataclass
class Syllable:
    consonant: str
    rhyme: str
    tone: int

    def __str__(self):
        # This is a rough reconstruction, mostly for debugging
        return f"{self.consonant}{self.rhyme}{self.tone}"

    def to_str(self) -> str:
        """Converts Syllable to its string representation using the tokenizer."""
        key = (self.consonant, self.rhyme, self.tone)
        token_id = tokenizer.crt_to_token_id.get(key)
        if token_id is not None:
             return tokenizer.renum.get(token_id, "")
        return str(self)

    @staticmethod
    def from_triplet(t: Triplet):
        return Syllable(consonant=t.consonant, rhyme=t.rhyme, tone=t.tone)

class SyllableTemplate(ABC):
    @abstractmethod
    def matches(self, s: Syllable) -> bool:
        pass

    @abstractmethod
    def get_regex(self) -> str:
        """Returns a regex string that matches the string representation of any syllable matching this template."""
        pass

@dataclass
class CompleteSyllableTemplate(SyllableTemplate):
    syllable: Syllable # Represents a complete syllable

    def matches(self, s: Syllable) -> bool:
        return (self.syllable.consonant == s.consonant and
                self.syllable.rhyme == s.rhyme and
                self.syllable.tone == s.tone)

    def get_regex(self) -> str:
        return re.escape(self.syllable.to_str())

@dataclass
class PartialSyllableTemplate(SyllableTemplate):
    consonant: str
    rhyme_first_letter: str
    tone: int

    def matches(self, s: Syllable) -> bool:
        if s.consonant != self.consonant:
            return False
        if s.tone != self.tone:
            return False

        # Normalize rhyme to remove diacritics before checking
        normalized_rhyme = remove_diacritics(s.rhyme)
        # Also normalize the template letter just in case
        normalized_template_letter = remove_diacritics(self.rhyme_first_letter)

        if not normalized_rhyme.startswith(normalized_template_letter):
            return False
        return True

    def get_regex(self) -> str:
        # Normalize template letter for lookup key
        normalized_template_letter = remove_diacritics(self.rhyme_first_letter)
        key = f"{self.consonant}_{normalized_template_letter}_{self.tone}"

        if key in PRECOMPUTED_REGEXES:
            return PRECOMPUTED_REGEXES[key]

        # Fallback to dynamic generation if not found (shouldn't happen for valid vocab inputs)
        matching_strings = []
        for i, t in enumerate(tokenizer.renum_triplet):
            if i == tokenizer.PADDING_TOKEN_INDEX or t is None:
                continue

            s = Syllable.from_triplet(t)
            if self.matches(s):
                # We use the string representation from the tokenizer
                text = tokenizer.renum.get(i)
                if text:
                    matching_strings.append(text)

        return generate_regex_from_strings(matching_strings)
