import os
import re
import sys
import glob
from tqdm import tqdm
from underthesea import word_tokenize

# Punctuation marks that are kept as individual tokens in the language model.
SUPPORTED_PUNCT = {'.', '!', ',', ';', ':'}


def _is_valid_token(token: str) -> bool:
    """Return True for word tokens consisting only of Unicode letters and
    underscores (the separator used by underthesea for multi-syllable words)
    with no digits."""
    if not token:
        return False
    for ch in token:
        if not (ch.isalpha() or ch == '_'):
            return False
    return True


def _read_file(path: str) -> str:
    """Read a text file, auto-detecting UTF-16 vs UTF-8 encoding."""
    with open(path, 'rb') as f:
        raw = f.read(4)
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        enc = 'utf-16'
    else:
        enc = 'utf-8'
    try:
        with open(path, encoding=enc, errors='replace') as f:
            return f.read()
    except Exception:
        with open(path, encoding='latin-1', errors='replace') as f:
            return f.read()


def _iter_lines(input_path: str):
    """Yield all lines from *input_path* (file or directory of .txt files)."""
    if os.path.isdir(input_path):
        pattern = os.path.join(input_path, '**', '*.txt')
        files = sorted(glob.glob(pattern, recursive=True))
        for fpath in tqdm(files, desc="Reading files"):
            text = _read_file(fpath)
            yield from text.splitlines()
    else:
        text = _read_file(input_path)
        yield from tqdm(text.splitlines(), desc="Processing lines")


def preprocess(input_path: str, tok_path: str, vocab_path: str) -> None:
    """Tokenise *input_path* (file or directory) with underthesea word
    segmentation and write:

    * *tok_path*   – one tokenised sentence per line, suitable for KenLM.
    * *vocab_path* – sorted list of unique tokens seen in the corpus.

    Supported punctuation marks (. ! , ; :) are kept as separate tokens.
    Multi-syllable words produced by underthesea are represented with an
    underscore joining their syllables (e.g. ``học_sinh``).
    """
    vocab: set = set()
    written = 0

    with open(tok_path, 'w', encoding='utf-8') as fout:
        for line in _iter_lines(input_path):
            line = line.strip().lower()
            if not line:
                continue

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

            if tokens:
                fout.write(' '.join(tokens) + '\n')
                written += 1

    print(f"Sentences written : {written:,}")
    print(f"Vocabulary size   : {len(vocab):,} tokens")

    with open(vocab_path, 'w', encoding='utf-8') as fvocab:
        for word in sorted(vocab):
            fvocab.write(word + '\n')
    print(f"Vocabulary written: {vocab_path}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python preprocess_corpus.py <input_file_or_dir> <output.tok> <vocab.txt>")
        sys.exit(1)

    preprocess(sys.argv[1], sys.argv[2], sys.argv[3])
