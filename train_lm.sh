#!/bin/bash
set -e

INPUT_PATH="${1:-data/corpus-full.txt}"
OUTPUT_PATH="${2:-data/corpus.tok}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
KENLM_BIN_DIR="${KENLM_BIN_DIR:-./kenlm/build/bin}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Error: $PYTHON_BIN is not available."
    exit 1
fi

if [ ! -f "$INPUT_PATH" ]; then
    echo "Error: input corpus not found at $INPUT_PATH"
    exit 1
fi

if [ ! -x "$KENLM_BIN_DIR/lmplz" ] || [ ! -x "$KENLM_BIN_DIR/build_binary" ]; then
    echo "Error: KenLM binaries not found in $KENLM_BIN_DIR"
    exit 1
fi

if ! "$PYTHON_BIN" -c "import underthesea" >/dev/null 2>&1; then
    echo "Installing Python dependencies from requirements.txt..."
    if command -v pip3 >/dev/null 2>&1; then
        pip3 install -r requirements.txt
    elif command -v pip >/dev/null 2>&1; then
        pip install -r requirements.txt
    else
        echo "Error: pip is not available to install Python dependencies."
        exit 1
    fi
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

# 1. Preprocess
if [ -f "$OUTPUT_PATH" ]; then
    echo "Corpus already preprocessed. Skipping..."
else
    echo "Preprocessing corpus..."
    "$PYTHON_BIN" preprocess_corpus.py "$INPUT_PATH" "$OUTPUT_PATH"
fi

# 2. Train KenLM
echo "Training KenLM (3-gram)..."
"$KENLM_BIN_DIR"/lmplz -o 3 --prune 0 0 1 < "$OUTPUT_PATH" > lm.arpa

# 3. Binarize
echo "Binarizing model..."
"$KENLM_BIN_DIR"/build_binary -a 256 -q 8 trie lm.arpa lm.binary

echo "Done. Model saved to lm.binary"
