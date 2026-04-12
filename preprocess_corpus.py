import re
import sys
from tqdm import tqdm
from underthesea import word_tokenize

SUPPORTED_PUNCTUATION = ".,!;:"
NON_ALLOWED_RE = re.compile(rf"[^\w\s{re.escape(SUPPORTED_PUNCTUATION)}]", flags=re.UNICODE)
DIGITS_RE = re.compile(r"\d")
PUNCT_SPACING_RE = re.compile(rf"([{re.escape(SUPPORTED_PUNCTUATION)}])")


def open_corpus_with_fallback(path):
    encodings = ("utf-8-sig", "utf-16", "utf-16-le")
    last_error = None
    for encoding in encodings:
        try:
            f = open(path, 'r', encoding=encoding)
            f.read(1)
            f.seek(0)
            return f
        except UnicodeDecodeError as exc:
            last_error = exc
        except Exception:
            raise
    if last_error:
        raise last_error
    raise RuntimeError("Could not determine input encoding")

def preprocess(input_path, output_path):
    with open_corpus_with_fallback(input_path) as fin, open(output_path, 'w', encoding='utf-8') as fout:
        for line in tqdm(fin, desc="Processing"):
            line = line.strip().lower()
            if not line:
                continue

            segmented = word_tokenize(line, format="text")
            segmented = NON_ALLOWED_RE.sub(" ", segmented)
            segmented = DIGITS_RE.sub(" ", segmented)
            segmented = PUNCT_SPACING_RE.sub(r" \1 ", segmented)

            tokens = segmented.split()
            if tokens:
                fout.write(' '.join(tokens) + '\n')

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python preprocess_corpus.py <input> <output>")
        sys.exit(1)
    
    preprocess(sys.argv[1], sys.argv[2])
