#!/bin/bash
set -e

# 1. Preprocess
if [ -f "data/corpus.tok" ]; then
    echo "Corpus already preprocessed. Skipping..."
else
    echo "Preprocessing corpus..."
    ./bin/python preprocess_corpus.py data/corpus-full.txt data/corpus.tok
fi

# 2. Train KenLM
echo "Training KenLM (3-gram)..."
./kenlm/build/bin/lmplz -o 3 < data/corpus.tok > lm.arpa

# 3. Binarize
echo "Binarizing model..."
./kenlm/build/bin/build_binary lm.arpa lm.binary

echo "Done. Model saved to lm.binary"
