import re
import sys

from tqdm import tqdm


def preprocess(input_path, output_path):
    with open(input_path, "r", encoding="utf-8") as fin, open(
        output_path, "w", encoding="utf-8"
    ) as fout:
        for line in tqdm(fin, desc="Processing"):
            line = line.lower()
            line = re.sub(r"[^\w\s]", " ", line)
            line = re.sub(r"[\d_]", " ", line)

            tokens = line.split()
            if tokens:
                fout.write(" ".join(tokens) + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python preprocess_corpus.py <input> <output>")
        sys.exit(1)

    preprocess(sys.argv[1], sys.argv[2])
