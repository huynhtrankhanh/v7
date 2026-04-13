import re
import sys
from tqdm import tqdm
from underthesea import word_tokenize

# Punctuation marks that are kept as individual tokens in the language model.
SUPPORTED_PUNCT = {'.', '!', ',', ';', ':'}


def _is_valid_token(token: str) -> bool:
    """Return True for word tokens that consist only of Unicode letters and
    underscores (the separator used by underthesea for multi-syllable words)
    with no digits."""
    if not token:
        return False
    for ch in token:
        if not (ch.isalpha() or ch == '_'):
            return False
    return True


def preprocess(input_path: str, tok_path: str, vocab_path: str) -> None:
    """Tokenise *input_path* with underthesea word segmentation and write:

    * *tok_path*  – one tokenised sentence per line, suitable for KenLM.
    * *vocab_path* – sorted list of unique tokens seen in the corpus.

    Supported punctuation marks (. ! , ; :) are kept as separate tokens.
    Multi-syllable words produced by underthesea are represented with an
    underscore joining their syllables (e.g. ``học_sinh``).
    """
    vocab: set = set()

    with (open(input_path, 'r', encoding='utf-8') as fin,
          open(tok_path, 'w', encoding='utf-8') as fout):
        for line in tqdm(fin, desc="Processing"):
            line = line.strip().lower()
            if not line:
                continue

            # underthesea word_tokenize with format='text' returns a string
            # where multi-syllable words are joined by underscores and words
            # are separated by spaces.
            try:
                segmented = word_tokenize(line, format='text')
            except Exception:
                continue

            tokens = []
            for token in segmented.split():
                if token in SUPPORTED_PUNCT:
                    tokens.append(token)
                    vocab.add(token)
                elif _is_valid_token(token):
                    tokens.append(token)
                    vocab.add(token)
                # Drop anything else (digits, mixed tokens, etc.)

            if tokens:
                fout.write(' '.join(tokens) + '\n')

    # Write sorted vocabulary list (one token per line).
    with open(vocab_path, 'w', encoding='utf-8') as fvocab:
        for word in sorted(vocab):
            fvocab.write(word + '\n')

    print(f"Vocabulary size: {len(vocab):,} tokens → {vocab_path}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python preprocess_corpus.py <input> <output.tok> <vocab.txt>")
        sys.exit(1)

    preprocess(sys.argv[1], sys.argv[2], sys.argv[3])
