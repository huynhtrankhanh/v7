import torch
import torch.nn.functional as F
from dataclasses import dataclass
from typing import List, Optional, Union
import math
from abc import ABC, abstractmethod

from ai.model import GPT, GPTConfig
from ai.tokenizer import tokenizer, Triplet
from ai.configs import MODEL_SIZES, DEVICE, MAX_SEQUENCE_LEN, BASE_MODEL_CHECKPOINT_PATH
from utils.preprocess import standardize_data, remove_diacritics
from utils.regex_gen import generate_regex_from_strings
import re

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
    rhyme_first_letter: Union[str, List[str]]
    tone: int

    def matches(self, s: Syllable) -> bool:
        if s.consonant != self.consonant:
            return False
        if s.tone != self.tone:
            return False

        # Normalize rhyme to remove diacritics before checking
        normalized_rhyme = remove_diacritics(s.rhyme)

        # Handle multiple letters
        templates = self.rhyme_first_letter
        if isinstance(templates, str):
            templates = [templates]

        # Check if matches any
        for tmpl in templates:
            normalized_template_letter = remove_diacritics(tmpl)
            if normalized_rhyme.startswith(normalized_template_letter):
                return True

        return False

    def get_regex(self) -> str:
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

# Functions

def load_model(path: str = BASE_MODEL_CHECKPOINT_PATH, model_size: str = 'base') -> GPT:
    """Loads the GPT model."""
    config = GPTConfig(**MODEL_SIZES[model_size])
    model = GPT(config)

    # Load checkpoint
    if not path:
        raise ValueError("Checkpoint path must be provided")

    print(f"Loading model from {path}...")
    checkpoint = torch.load(path, map_location=torch.device(DEVICE))

    state_dict = checkpoint['model_state_dict'] if 'model_state_dict' in checkpoint else checkpoint

    # Clean up state dict keys
    new_state_dict = {}
    for key, value in state_dict.items():
        new_key = key.replace('module.', '')
        new_state_dict[new_key] = value

    model.load_state_dict(new_state_dict)
    model.to(DEVICE)
    model.eval()
    return model

def predict(context: List[Syllable], template: List[SyllableTemplate], model: GPT, beam_width: int = 10, num_candidates: int = 1) -> List[List[Syllable]]:
    """
    Predicts the next syllables based on context and templates using beam search.
    """
    context_tokens = []

    # Use tokenizer's optimized lookup
    for syl in context:
        key = (syl.consonant, syl.rhyme, syl.tone)
        token_id = tokenizer.crt_to_token_id.get(key)

        if token_id is not None:
            context_tokens.append(token_id)
        else:
            print(f"Warning: Could not find token for syllable {syl}")
            # If we skip, the context might be broken.
            # But GPT needs tokens.
            # We could try to map to something close or just ignore.
            continue

    # Run beam search
    result_tokens_list = beam_search(model, context_tokens, template, beam_width, num_candidates)

    candidates = []
    for result_tokens in result_tokens_list:
        # Convert result tokens to Syllables
        result_syllables = []
        for token_id in result_tokens:
            t = tokenizer.renum_triplet[token_id]
            if t:
                result_syllables.append(Syllable.from_triplet(t))
            else:
                # Should not happen for valid tokens
                result_syllables.append(Syllable(consonant="", rhyme="", tone=0))
        candidates.append(result_syllables)

    return candidates

def beam_search(model: GPT, context_tokens: List[int], templates: List[SyllableTemplate], beam_width: int, num_candidates: int = 1) -> List[List[int]]:
    """
    Performs beam search to find the sequence of tokens that best matches the templates.
    """
    # Start with the context
    # Beam state: (sequence_of_tokens, score)
    # We only care about the *generated* part matching the templates.

    # Initial beam
    beams = [(context_tokens, 0.0)] # List of (tokens, log_prob)

    for i, template in enumerate(templates):
        new_beams = []

        for seq, score in beams:
            # Prepare input
            # We only need the last context_len tokens, but model handles it?
            # Model config says block_size. We should truncate.
            input_seq = seq[-model.config.block_size:]

            input_tensor = torch.tensor([input_seq], dtype=torch.long, device=DEVICE)

            with torch.no_grad():
                logits, _ = model(input_tensor)
                # Get logits for the last token
                next_token_logits = logits[0, -1, :] # (Vocab_size)

                # Log softmax
                next_token_probs = F.log_softmax(next_token_logits, dim=-1)

                # Filter candidates based on template
                valid_indices = []
                for token_id, t in enumerate(tokenizer.renum_triplet):
                    if token_id == tokenizer.PADDING_TOKEN_INDEX: continue
                    if not t: continue

                    # Convert triplet to syllable to check with template matches method
                    # Optimization: maybe create Syllable only if needed or reuse logic?
                    # Since SyllableTemplate expects Syllable, we must provide it.
                    s = Syllable.from_triplet(t)

                    if template.matches(s):
                        valid_indices.append(token_id)

                if not valid_indices:
                    continue

                valid_tensor = torch.tensor(valid_indices, device=DEVICE)
                valid_probs = next_token_probs[valid_tensor]

                # Get top-k from valid ones
                k = min(beam_width, len(valid_indices))
                top_k_vals, top_k_inds = torch.topk(valid_probs, k)

                for val, ind in zip(top_k_vals, top_k_inds):
                    token_id = valid_indices[ind.item()]
                    new_beams.append((seq + [token_id], score + val.item()))

        # Keep top beam_width beams globally
        new_beams.sort(key=lambda x: x[1], reverse=True)
        beams = new_beams[:beam_width]

        if not beams:
            break

    if not beams:
        return []

    # Return top num_candidates generated parts
    return [seq[len(context_tokens):] for seq, score in beams[:num_candidates]]
