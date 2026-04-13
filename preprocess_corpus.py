import os
import sys
import glob
from collections import Counter
from tqdm import tqdm

# Punctuation marks that are kept as individual tokens in the language model.
SUPPORTED_PUNCT = {'.', '!', ',', ';', ':'}

# Number of most-frequent bigrams + trigrams to use for syllable grouping.
TOP_NGRAMS = 144000

# Memory management constraints for n-gram counting
PRUNE_THRESHOLD = 3_000_000 # Max number of unique n-grams to hold in RAM
PRUNE_KEEP = 1_000_000      # How many top n-grams to keep when pruning


def _is_valid_syllable(token: str) -> bool:
    """Return True for tokens consisting only of Unicode letters (no digits,
    underscores, or other characters).  This identifies bare Vietnamese
    syllables before any grouping step."""
    if not token:
        return False
    return all(ch.isalpha() for ch in token)


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


def _tokenize_line(line: str):
    """Split a lowercased line character-by-character into syllable tokens
    and supported punctuation.  Non-letter, non-punctuation characters act as
    delimiters and are silently dropped."""
    tokens = []
    current = ''
    for ch in line:
        if ch.isalpha():
            current += ch
        elif ch in SUPPORTED_PUNCT:
            if current:
                if _is_valid_syllable(current):
                    tokens.append(current)
                current = ''
            tokens.append(ch)
        else:
            if current:
                if _is_valid_syllable(current):
                    tokens.append(current)
                current = ''
    if current and _is_valid_syllable(current):
        tokens.append(current)
    return tokens


def _count_ngrams(input_path: str):
    """First pass: count consecutive syllable bigrams and trigrams.
    Periodically prunes the counters based on capacity to prevent Out-Of-Memory (OOM) 
    errors, safely handling extremely long single lines."""
    bigrams: Counter = Counter()
    trigrams: Counter = Counter()
    
    # We track how many items we've processed to avoid calling len() on every iteration
    items_since_check = 0
    CHECK_INTERVAL = 200_000 

    for line in _iter_lines(input_path):
        line = line.strip().lower()
        if not line:
            continue
            
        syllables = [t for t in _tokenize_line(line) if _is_valid_syllable(t)]
        n_syllables = len(syllables)
        
        # Consolidate into a single loop to allow mid-line pruning
        for i in range(n_syllables - 1):
            # Add bigram
            bigrams[(syllables[i], syllables[i + 1])] += 1
            
            # Add trigram (if not at the very end)
            if i < n_syllables - 2:
                trigrams[(syllables[i], syllables[i + 1], syllables[i + 2])] += 1
                
            items_since_check += 1
            
            # Capacity-based Pruning
            if items_since_check >= CHECK_INTERVAL:
                # Only prune if we've actually breached the RAM threshold
                if len(bigrams) > PRUNE_THRESHOLD:
                    bigrams = Counter(dict(bigrams.most_common(PRUNE_KEEP)))
                if len(trigrams) > PRUNE_THRESHOLD:
                    trigrams = Counter(dict(trigrams.most_common(PRUNE_KEEP)))
                items_since_check = 0 # Reset interval counter

    # Final safety prune before returning
    if len(bigrams) > PRUNE_THRESHOLD:
        bigrams = Counter(dict(bigrams.most_common(PRUNE_KEEP)))
    if len(trigrams) > PRUNE_THRESHOLD:
        trigrams = Counter(dict(trigrams.most_common(PRUNE_KEEP)))

    return bigrams, trigrams


def _select_top_ngrams(bigrams: Counter, trigrams: Counter, top_k: int = TOP_NGRAMS):
    """Return (bigram_set, trigram_set) for the *top_k* most frequent n-grams
    (bigrams and trigrams ranked together by raw frequency)."""
    combined = []
    for gram, count in bigrams.items():
        combined.append(('_'.join(gram), count))
    for gram, count in trigrams.items():
        combined.append(('_'.join(gram), count))
    combined.sort(key=lambda x: -x[1])
    selected = {gram for gram, _ in combined[:top_k]}
    bigram_set = {g for g in selected if g.count('_') == 1}
    trigram_set = {g for g in selected if g.count('_') == 2}
    return bigram_set, trigram_set


def _group_syllables(syllables: list, trigram_set: set, bigram_set: set) -> list:
    """Greedily group consecutive syllables using the selected n-grams.
    At each position a trigram match is preferred over a bigram match."""
    result = []
    i = 0
    while i < len(syllables):
        if i + 2 < len(syllables):
            tg = f"{syllables[i]}_{syllables[i + 1]}_{syllables[i + 2]}"
            if tg in trigram_set:
                result.append(tg)
                i += 3
                continue
        if i + 1 < len(syllables):
            bg = f"{syllables[i]}_{syllables[i + 1]}"
            if bg in bigram_set:
                result.append(bg)
                i += 2
                continue
        result.append(syllables[i])
        i += 1
    return result


def preprocess(input_path: str, tok_path: str, vocab_path: str) -> None:
    """Tokenise *input_path* (file or directory) using KenLM n-gram statistics
    and write:

    * *tok_path* – one tokenised sentence per line, suitable for KenLM.
    * *vocab_path* – sorted list of unique tokens seen in the corpus.
    """
    print("Pass 1: counting syllable bigrams and trigrams...")
    bigrams, trigrams = _count_ngrams(input_path)
    print(f"  Found {len(bigrams):,} unique bigrams, {len(trigrams):,} unique trigrams")
    bigram_set, trigram_set = _select_top_ngrams(bigrams, trigrams, TOP_NGRAMS)
    print(
        f"  Selected {len(trigram_set):,} trigrams and {len(bigram_set):,} bigrams"
        f" (top {TOP_NGRAMS:,} total)"
    )

    print("Pass 2: grouping syllables and writing corpus...")
    vocab: set = set()
    written = 0

    with open(tok_path, 'w', encoding='utf-8') as fout:
        for line in _iter_lines(input_path):
            line = line.strip().lower()
            if not line:
                continue

            raw_tokens = _tokenize_line(line)

            # Group runs of syllables; leave punctuation tokens in-place.
            result_tokens: list = []
            syllable_buf: list = []

            for tok in raw_tokens:
                if _is_valid_syllable(tok):
                    syllable_buf.append(tok)
                else:
                    if syllable_buf:
                        result_tokens.extend(
                            _group_syllables(syllable_buf, trigram_set, bigram_set)
                        )
                        syllable_buf = []
                    result_tokens.append(tok)
            if syllable_buf:
                result_tokens.extend(
                    _group_syllables(syllable_buf, trigram_set, bigram_set)
                )

            if result_tokens:
                for tok in result_tokens:
                    vocab.add(tok)
                fout.write(' '.join(result_tokens) + '\n')
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
