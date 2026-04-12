import re
import sys
from tqdm import tqdm
from underthesea import word_tokenize

SUPPORTED_PUNCTUATION = ".,!;:"
NON_ALLOWED_RE = re.compile(rf"[^\w\s{re.escape(SUPPORTED_PUNCTUATION)}]", flags=re.UNICODE)
DIGITS_RE = re.compile(r"\d")
PUNCT_SPACING_RE = re.compile(rf"([{re.escape(SUPPORTED_PUNCTUATION)}])")

def preprocess(input_path, output_path):
    with open(input_path, 'r', encoding='utf-8') as fin, open(output_path, 'w', encoding='utf-8') as fout:
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
