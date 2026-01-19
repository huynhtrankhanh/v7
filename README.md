# V7 Text Prediction Engine

This project implements a high-performance Vietnamese text prediction engine using a specialized "V7" input format. It utilizes a 3-gram language model trained with KenLM to disambiguate and reconstruct Vietnamese sentences from compact encoded strings.

## Project Structure

*   `inference-rs/`: Rust source code for the inference engine (the core application).
*   `kenlm/`: The KenLM language model toolkit (used for training).
*   `data/`: Directory for corpus data (input text).
*   `preprocess_corpus.py`: Python script to clean and tokenize raw text.
*   `train_lm.sh`: Shell script to train and binarize the language model.
*   `generated_regexes.json`: Configuration file mapping V7 codes to candidate syllables.
*   `lm.binary`: The trained binary language model (generated artifact).

## Prerequisites

*   **OS:** Linux (Ubuntu recommended).
*   **Python:** 3.12+ (for preprocessing).
*   **Rust:** Latest stable toolchain (for inference).
*   **System Libraries:** `cmake`, `build-essential`, `libboost-all-dev`, `zlib1g-dev`, `libbz2-dev`, `liblzma-dev`.

## Installation & Setup

### 1. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 2. Build KenLM
The project relies on KenLM for model training.

```bash
cd kenlm
mkdir -p build && cd build
cmake ..
make -j$(nproc)
cd ../..
```

### 3. Build Inference Engine (Rust)

```bash
cd inference-rs
cargo build --release
cd ..
```

## Docker Support

The project includes `docker-compose` support to simplify running the inference engine with the necessary file mounts.

### 1. Build the Service

```bash
docker-compose build
```

### 2. Run Inference

Use `docker-compose run` to pass arguments to the container. The configuration automatically mounts `lm.binary` and `generated_regexes.json` from your local directory.

**Requirement:** You must have `lm.binary` generated in the project root (see "Usage Workflow" below).

```bash
docker-compose run --rm inference [v7_string]
```

**Example:**
```bash
docker-compose run --rm inference na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

## Usage Workflow

### 1. Prepare Corpus
Place your raw text corpus in `data/corpus-full.txt`. The file should contain raw Vietnamese text.

### 2. Preprocess & Train
Run the training script. This will:
1.  Preprocess `data/corpus-full.txt` into `data/corpus.tok` (tokenized, lowercased).
2.  Train a 3-gram language model (`lm.arpa`).
3.  Binarize the model into `lm.binary` for efficient loading.

```bash
./train_lm.sh
```

**Artifacts:**
*   `lm.binary`: The trained model file (placed in project root).

### 3. Run Inference
Use the compiled Rust binary to decode V7 strings. The binary expects `generated_regexes.json` and `lm.binary` to be in the current working directory.

```bash
./inference-rs/target/release/inference-rs [v7_string] --model_path lm.binary
```

**Example:**
```bash
./inference-rs/target/release/inference-rs na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

**Output:**
```
Top results:
1. [-27.8713] nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt
...
```

## V7 Input Format: Deep Dive

The V7 format is a highly compressed phonetic coding system. Unlike standard Telex, it requires precise adherence to specific mapping rules for consonants, rhymes, and tones.

**Structure:** `[Consonant][RhymeStart][Tone]`

### 1. Consonants
The input string must start with a valid consonant code. The parser matches the **longest** valid consonant code.

| Input Code | Vietnamese Sound | Notes |
| :--- | :--- | :--- |
| `k` | **c**, **k** | Use `k` for both `c` (ca) and `k` (ki). |
| `w` | **qu** | `w` + `y` -> `quy`, `w` + `a` -> `qua`. |
| `z` | **gi** | `z` + `a` -> `gia`. |
| `dd` | **đ** | Standard mapping. |
| `d` | **d** | Distinct from `đ`. |
| `0` | **(none)** | Use `0` for words starting with a vowel (e.g., `anh` -> `0...`). |
| `g` | **g**, **gh** | `g` handles both cases automatically. |
| `ng` | **ng**, **ngh** | `ng` handles both cases automatically. |

**Standard Consonants:** `b`, `ch`, `h`, `kh`, `l`, `m`, `n`, `nh`, `p`, `ph`, `r`, `s`, `t`, `th`, `tr`, `v`, `x`.

### 2. Rhyme Start
This is the **single character** that immediately follows the consonant.
*   It is strictly the **first letter** of the rhyme part of the word.
*   **Example:** For "quyết" (qu + yết), the consonant is `w` (qu) and the rhyme starts with `y`. -> `w` + `y`...
*   **Example:** For "anh" (vowel start + anh), the consonant is `0`, rhyme starts with `a`. -> `0` + `a`...

### 3. Tones (0-9)
Tones are represented by digits. The mapping is crucial and depends on whether the syllable ends with a **stop consonant** (`c`, `ch`, `p`, `t`).

**Open/Nasal Syllables (ending in vowel, m, n, ng, nh):**
*   `0`: **Ngang** (Level) - *ma, an*
*   `1`: **Sắc** (Acute) - *má, án*
*   `2`: **Huyền** (Grave) - *mà, àn*
*   `3`: **Hỏi** (Hook) - *mả, ản*
*   `4`: **Ngã** (Tilde) - *mã, ãn*
*   `5`: **Nặng** (Dot) - *mạ, ạn*

**Checked Syllables (Stop ending: c, ch, p, t):**
These syllables can *only* carry Sắc or Nặng tones. V7 separates them to improve prediction accuracy.
*   `6`: **Sắc** (Acute) - *mát, ách, cắp*
*   `7`: **Nặng** (Dot) - *mạt, ạch, cặp*

### Full Examples

| Word | Decomposition | V7 Code | Notes |
| :--- | :--- | :--- | :--- |
| **nay** | `n` + `ay` + Ngang | `na0` | `n` matches `n`, `a` is rhyme start, `0` is tone. |
| **trời** | `tr` + `ời` + Huyền | `tro2` | `tr` matches `tr`, `o` is rhyme start (`ơ` input as `o`), `2` is tone. |
| **đẹp** | `đ` + `ẹp` + Nặng (Stop) | `dde7` | `dd` matches `đ`, `e` is rhyme start, `7` is stop-tone Nặng. |
| **lắm** | `l` + `ắm` + Sắc | `la1` | `l` matches `l`, `a` is rhyme start (`ă` -> `a`), `1` is tone. |
| **quốc** | `qu` + `ốc` + Sắc (Stop) | `wo6` | `w` matches `qu`, `o` is rhyme start (`ố` -> `o`), `6` is stop-tone Sắc. |
| **anh** | `(none)` + `anh` + Ngang | `0a0` | `0` is empty consonant, `a` is rhyme start. |
| **nghiêng** | `ngh` + `iêng` + Ngang | `ngi0` | `ng` maps `ng/ngh`, `i` is rhyme start. |
| **giữa** | `gi` + `ữa` + Ngã | `zu4` | `z` matches `gi`, `u` is rhyme start (`ư` -> `u`). |