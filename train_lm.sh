#!/bin/bash
set -e

INPUT_PATH="${1:-data/corpus-full.txt}"
OUTPUT_PATH="${2:-data/corpus.tok}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Error: $PYTHON_BIN is not available."
    exit 1
fi

if [ ! -f "$INPUT_PATH" ]; then
    echo "Error: input corpus not found at $INPUT_PATH"
    exit 1
fi

# 1. Preprocess
if [ -f "$OUTPUT_PATH" ]; then
    echo "Corpus already preprocessed. Skipping..."
else
    echo "Preprocessing corpus..."
    "$PYTHON_BIN" preprocess_corpus.py "$INPUT_PATH" "$OUTPUT_PATH"
fi

# 2. Train KenLM
echo "Training KenLM (3-gram)..."
./kenlm/build/bin/lmplz -o 3 --prune 0 0 1 < "$OUTPUT_PATH" > lm.arpa

# 3. Binarize
echo "Binarizing model..."
./kenlm/build/bin/build_binary -a 256 -q 8 trie lm.arpa lm.binary

echo "Done. Model saved to lm.binary"
