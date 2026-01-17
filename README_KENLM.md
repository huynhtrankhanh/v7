# KenLM Text Prediction

This document describes the steps taken to train a KenLM language model and use it for Vietnamese text prediction based on v7 regex constraints.

## Prerequisites

- Ubuntu environment
- Python 3.12
- `p7zip-full`, `build-essential`, `libboost-all-dev`, `cmake` (installed via apt)
- `kenlm` (built from source)

## 1. Corpus Preparation

The corpus was extracted from `../corpus-full.7z` into `data/corpus-full.txt`.

A preprocessing script `preprocess_corpus.py` was created to:
- Lowercase the text.
- Remove non-alphanumeric characters (keeping Vietnamese characters).
- Normalize whitespace.

Command used:
```bash
./bin/python preprocess_corpus.py data/corpus-full.txt data/corpus.tok
```

## 2. KenLM Model Training

We trained a 3-gram language model using `lmplz` and converted it to binary format for faster loading.

Commands used:
```bash
# Train ARPA model
./kenlm/build/bin/lmplz -o 3 < data/corpus.tok > lm.arpa

# Convert to binary
./kenlm/build/bin/build_binary lm.arpa lm.binary
```

The resulting `lm.binary` is placed in the project root.

## 3. Inference

The `inference.py` script reproduces the parsing logic from `demo.py` and adds a beam search decoding step using the trained KenLM model.

It takes a v7 compact string as input, parses it into syllable templates, finds candidate words for each template, and uses the language model to find the most probable sentence.

### Usage

```bash
./bin/python inference.py [v7_string]
```

Example:
```bash
./bin/python inference.py na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

Output:
```
1. [-27.8713] nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt
...
```
