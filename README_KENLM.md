# KenLM Model Training

This document describes how to train the KenLM language model used by the V7 inference engine.

## Overview

The training pipeline uses:
- A **Python preprocessor** (`preprocess_corpus.py`) to normalize raw corpus text into KenLM training text.
- **KenLM** (`lmplz` + `build_binary`) to train and binarize a 3-gram language model.

Both are run inside a dedicated **Docker training container**. No manual installation of KenLM or Python packages is required on the host.

## Training with Docker (Recommended)

### Prerequisites

- Docker and Docker Compose installed on the host.
- A raw Vietnamese text corpus at `data/corpus-full.txt` (one sentence per line).

### Run Training

```bash
docker compose run --rm train bash train_lm.sh
```

This single command will:
1. Preprocess `data/corpus-full.txt` into `data/corpus.tok`.
2. Train a 3-gram KenLM model (`lm.arpa`).
3. Binarize the model into `lm.binary` using the trie format with 8-bit quantization.

### Output Artifacts

The runtime artifact is written to the project root (mounted from the host via `docker-compose.yml`):

| File | Description |
| :--- | :--- |
| `lm.binary` | Compiled KenLM binary model — loaded by the inference engine at startup. |

`lm.binary` must be present in the project root before starting the inference server.

## What the Preprocessor Does

`preprocess_corpus.py` is the historical training preprocessor. It:
- Lowercases the text.
- Removes non-alphanumeric characters (keeping Vietnamese diacritics).
- Normalizes whitespace.
- Writes one whitespace-normalized sentence per line.

## Training Parameters

The training script (`train_lm.sh`) uses these KenLM options:

```bash
lmplz -o 3 --prune 0 0 1 < data/corpus.tok > lm.arpa
build_binary -a 256 -q 8 trie lm.arpa lm.binary
```

- **3-gram** order.
- **Trigram pruning:** unigrams and bigrams are kept in full; trigrams with count 1 are pruned.
- **Trie format** with 8-bit quantization for a compact binary file.

## Using the Trained Model

Once `lm.binary` is in the project root, start the inference server:

```bash
docker compose up inference
```

Or run CLI inference directly:

```bash
docker compose run --rm --entrypoint ./inference-rs/target/release/inference-rs inference na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

See `README.md` for the full usage documentation.
