#!/bin/bash
set -e

# Run this script inside the training Docker container:
#   docker compose run --rm train bash train_lm.sh
#
# The container has Python (with tqdm), KenLM binaries, and the
# preprocess_corpus.py script pre-installed.
#
# Expected inputs (mounted into the container via docker-compose.yml):
#   data/corpus-full.txt  – raw Vietnamese text corpus (one sentence per line)
#
# Outputs (written to /app, also mounted as the repo root):
#   lm.binary  – compiled KenLM binary model
#   vocab.txt  – sorted vocabulary list (used by the inference engine)

DATA_DIR="data"
CORPUS="${DATA_DIR}/corpus-full.txt"
TOK="${DATA_DIR}/corpus.tok"
VOCAB="vocab.txt"
ARPA="lm.arpa"
BINARY="lm.binary"
KENLM_BIN="./kenlm/build/bin"

# 1. Preprocess with KenLM n-gram based syllable grouping
if [ -f "${TOK}" ] && [ -f "${VOCAB}" ]; then
    echo "Corpus already preprocessed. Skipping..."
else
    echo "Preprocessing corpus with KenLM n-gram based syllable grouping..."
    ./preprocess_corpus "${CORPUS}" "${TOK}" "${VOCAB}"
fi

# 2. Train KenLM (3-gram)
echo "Training KenLM (3-gram)..."
"${KENLM_BIN}/lmplz" -o 3 -S 50% --prune 0 0 1 < "${TOK}" \
  | awk '/^\\data\\/{found=1} found && !/^Name:lmplz/' > "${ARPA}"

# 3. Binarize
echo "Binarizing model..."
"${KENLM_BIN}/build_binary" -a 256 -q 8 trie "${ARPA}" "${BINARY}"

echo "Done."
echo "  Model    : ${BINARY}"
echo "  Vocabulary: ${VOCAB}"
