# V7 Text Prediction Engine

This project implements a high-performance Vietnamese text prediction engine using a specialized "V7" input format. It utilizes a 3-gram language model trained with KenLM to disambiguate and reconstruct Vietnamese sentences from compact encoded strings.

## Project Structure

*   `inference-rs/`: Rust source code for the inference engine (the core application).
*   `kenlm/`: The KenLM language model toolkit (used for training).
*   `data/`: Directory for corpus data (input text).
*   `preprocess_corpus.py`: Python script to clean and tokenize raw text.
*   `train_lm.sh`: Shell script to train and binarize the language model.
*   Structured regex generation: Runtime builds V7 regex mappings directly from in-code structured logic.
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

Use `docker-compose run` to pass arguments to the container. The configuration automatically mounts `lm.binary` from your local directory.

**Requirement:** You must have `lm.binary` generated in the project root (see "Usage Workflow" below).

```bash
docker-compose run --rm inference [v7_string]
```

**Example:**
```bash
docker-compose run --rm inference na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

### Optional Stripped Plover Service

The `docker-compose.yml` file includes an optional `stripped-plover` service that clones and builds the Stripped Plover repository at container build time. It exposes a TCP proxy on port `4020` and stores the dictionary database in a Docker volume so it persists across restarts.

```bash
docker-compose up stripped-plover
```

The inference service is configured to connect to Stripped Plover via `STRIPPED_PLOVER_HOST` and `STRIPPED_PLOVER_PORT` when the container is available. This service is optional; the inference engine continues to run normally without it.

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
Use the compiled Rust binary to decode V7 strings. The binary expects `lm.binary` to be in the current working directory.

#### Input Modes

The engine supports two modes of operation:

**A. Legacy Mode (Single String)**
Pass a single raw V7 string. The engine will decode it as a standalone sentence.

```bash
./inference-rs/target/release/inference-rs na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

**B. Fixed Text Islands Mode (JSON)**
Pass a JSON array of strings to interleave existing fixed text with V7 code islands. This is ideal for editing within existing sentences, as the fixed text provides context for the prediction.

**Format:** `["Fixed Text", "V7 Code", "Fixed Text", "V7 Code", ...]`
*   The array **must** start with a Fixed Text element (use an empty string `""` if there is no preceding text).
*   **Alternating structure:** Even indices are Fixed Text, odd indices are V7 Code.
*   **Context Propagation:** The engine "reads" the fixed text to update its internal state, ensuring that subsequent V7 predictions are contextually appropriate. Fixed text is automatically "purified" (punctuation removed) to match the model's training data.

**Example:**
```bash
# Context: "hôm nay " -> Prediction for "tro2" -> Context " rất " -> Prediction for "dde7"
./inference-rs/target/release/inference-rs '["hôm nay ", "tro2", " rất ", "dde7"]'
```

**Output (JSON Mode):**
Returns a JSON array of candidate lists. Each list contains the predicted text for the corresponding V7 island.

```json
[["trời","tròn",...], ["đẹp","đến",...]]
```

### Mocked Model Mode
If the KenLM model file (`lm.binary`) is not available, or you wish to test the server integration without loading the heavy model, you can run the server in mocked mode. This mode uses a simple "dumb" inference strategy that returns valid candidates based on the dictionary but without context-aware scoring. The mocked mode is a compile-time feature flag, which also skips building KenLM.

```bash
cd inference-rs
cargo build --release --features mocked-model
cd ..
./inference-rs/target/release/inference-rs --server
```

## V7 Input Format: Deep Dive

The V7 format is a highly compressed phonetic coding system. Unlike standard Telex, it requires precise adherence to specific mapping rules for consonants, rimes, and tones.

**Structure:** `[Consonant][RimeStart][Tone]`

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

### 2. Rime Start
This is the **single character** that immediately follows the consonant.
*   It corresponds to the first letter of the rime, **normalized** to its base Latin vowel (removing diacritics).
*   **Normalization Rule:** `ă`, `â`, `a` -> `a`; `ê`, `e` -> `e`; `ô`, `ơ`, `o` -> `o`; `ư`, `u` -> `u`; `i`, `y` -> `i`. (Note: Both `i` and `y` are normalized to `i`).
*   **Example:** For "quyết" (qu + yết), the consonant is `w` (qu). The rime starts with `y`. Normalized: `i`. Input: `wi`.
*   **Example:** For "anh" (vowel start + anh), the consonant is `0`, rime starts with `a`. Normalized: `a`. Input: `0a`.

### 3. Tones (0-7)
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
| **nay** | `n` + `ay` + Ngang | `na0` | `n` matches `n`, `a` is rime start, `0` is tone. |
| **trời** | `tr` + `ời` + Huyền | `tro2` | `tr` matches `tr`, `o` is rime start (`ơ` -> `o`), `2` is tone. |
| **đẹp** | `đ` + `ẹp` + Nặng (Stop) | `dde7` | `dd` matches `đ`, `e` is rime start, `7` is stop-tone Nặng. |
| **lắm** | `l` + `ắm` + Sắc | `la1` | `l` matches `l`, `a` is rime start (`ă` -> `a`), `1` is tone. |
| **quốc** | `qu` + `ốc` + Sắc (Stop) | `wo6` | `w` matches `qu`, `o` is rime start (`ố` -> `o`), `6` is stop-tone Sắc. |
| **anh** | `(none)` + `anh` + Ngang | `0a0` | `0` is empty consonant, `a` is rime start. |
| **nghiêng** | `ngh` + `iêng` + Ngang | `ngi0` | `ng` maps `ng/ngh`, `i` is rime start. |
| **giữa** | `gi` + `ữa` + Ngã | `zu4` | `z` matches `gi`, `u` is rime start (`ư` -> `u`), `4` is tone. |

## License

This project is licensed under the [0BSD License](LICENSE).

## Acknowledgments

This project was originally inspired by the [v7](https://github.com/ducngg/v7) repository. While the current codebase represents a significant divergence in implementation and approach, we acknowledge the instrumental role of the original project in the development of this engine. See `ACKNOWLEDGMENTS.md` for more details and the original license.
