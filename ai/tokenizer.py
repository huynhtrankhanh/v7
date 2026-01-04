import json
from dataclasses import dataclass
from typing import List, Tuple

from utils.decorators import singleton
from utils.path import resource_path

Word = str

@dataclass
class Triplet:
    consonant: str
    rhyme: str
    tone: int

    def unpack(self):
        return self.consonant, self.rhyme, self.tone
    def __iter__(self):
        return iter(self.unpack())

@singleton
class Tokenizer:
    def __init__(
        self, 
        enum_path=resource_path("checkpoints/enum.json"), 
        renum_path=resource_path("checkpoints/renum.json"), 
        renum_crt_path=resource_path("checkpoints/renum_crt.json"),
        verbose=1
    ):  
        self.location = "<ai.tokenizer.Tokenizer>"
        self.PADDING_TOKEN_INDEX = 0
        
        with open(enum_path, 'r', encoding='utf-8') as f:
            self.enum: dict[str, int] = json.load(f)
        # renum.json is a list where index is the key
        with open(renum_path, 'r', encoding='utf-8') as f:
            renum_list = json.load(f)
            self.renum: dict[int, str] = {i: v for i, v in enumerate(renum_list)}

        with open(renum_crt_path, 'r', encoding='utf-8') as f:
            self.renum_crt: list[tuple[str, str, int]] = json.load(f)

        # renum_crt is a list of [c, r, t]
        self.renum_triplet = [None] + [Triplet(consonant=c, rhyme=r, tone=t) for c, r, t in self.renum_crt[1:]]
        
        # Build reverse map for Syllable lookup (optimization)
        self.crt_to_token_id = {}
        for idx, t in enumerate(self.renum_triplet):
            if t:
                key = (t.consonant, t.rhyme, t.tone)
                # Store list of token_ids for this CRT (synonyms/homophones)
                # But here we just want *any* token matching the syllable to reconstruct context.
                # Usually we want the most frequent one? Or just any?
                # The tokenizer doesn't have frequency info readily available here unless we load it.
                # For now, just store the first one encountered or append.
                if key not in self.crt_to_token_id:
                    self.crt_to_token_id[key] = idx

        if verbose:
            print(f"{self.location} Loaded: {len(self.renum_triplet)} tokens")

                            
    def tokenize(self, words: list[str]) -> list[int]:
        return [self.enum[word] for word in words if word in self.enum]
    def detokenize(self, tensor: list[int]) -> list[Word]:
        return [self.renum.get(id, "") for id in tensor]
    def analyze(self, tensor: list[int]) -> list[tuple[str, str, int]]:
        return [self.renum_crt[id] for id in tensor]
    def triplets(self, tensor: list[int]) -> list[Triplet]:
        return [self.renum_triplet[id] for id in tensor]

tokenizer = Tokenizer()
