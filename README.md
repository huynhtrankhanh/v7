# V7 Text Prediction Engine

This project implements a high-performance Vietnamese text prediction engine using a specialized "V7" input format. It utilizes a 3-gram language model trained with KenLM to disambiguate and reconstruct Vietnamese sentences from compact encoded strings. A web demo with a stenographic input interface is also included.

## Project Structure

*   `inference-rs/`: Rust source code for the inference engine (the core application, serves the web demo).
*   `src/`: TypeScript source for the web frontend (compiled by Vite into `static/script.js`).
*   `static/`: Static web assets (HTML, SVG diagrams, and the compiled `script.js`).
*   `tests/`: Jest unit tests for the web frontend logic.
*   `scripts/`: Helper scripts (e2e tests, Stripped Plover agent, etc.).
*   `practice-android/`: Android WebView wrapper that packages `static/practice.html` as a signed release app bundle.
*   `ime-android/`: Android input method that packages the stripped V7 WebUI and connects it to native composing text and inference settings.
*   `evaluator/`: Evaluation and dataset (JSONL) tooling, including the TypeScript port of the V7 tokenizer/candidate-enumeration logic.
*   `evaluation-server/`: Sandboxed HTTP evaluation for submitted executables; see [`evaluation-server/README.md`](evaluation-server/README.md).
*   `trainer/`: Separate Node.js/SQLite subsystem for consent-gated, adaptive V7 IME chord training.
*   `preprocess_corpus.py`: Python corpus preprocessor used by the Docker training build.
*   `train_lm.sh`: Shell script to preprocess and train the language model (intended to run inside the `train` Docker service).
*   `Dockerfile` / `docker-compose.yml`: Multi-stage Docker build and compose configuration.
*   `lm.binary`: Trained binary language model — **generated artifact**, not in the repository.

The Android IME also has an off-by-default, fully on-device LiteRT-LM stage
that can rerank KenLM's first 50 candidates with a user-installed Gemma 3 1B
IT model before results reach the keyboard WebUI. See the
[experimental reranker guide](ime-android/docs/experimental-reranking.md) for
the exact gated model download, Android Settings flow, research rationale,
failure behavior, and performance/licensing constraints.

## Docker Support

Docker is the recommended way to build and run the project. The `docker-compose.yml` defines four services:

| Service | Purpose |
| :--- | :--- |
| `inference` | Runs the Rust inference engine in server mode (web demo). |
| `train` | Preprocesses the corpus and trains the KenLM language model. |
| `stripped-plover` | Optional Stripped Plover TCP proxy for dictionary-based fallback strokes. |
| `practice-android` | Builds `static/practice.html` into a signed fullscreen Android App Bundle. |
| `trainer` | Runs the manually provisioned, FSRS-adaptive V7 IME training website on port 3001. |

### Run the IME trainer

The trainer is a separate Node.js subsystem. It uses the inference service's
HTTP API for predictive exercises, but does not launch or use Stripped Plover.

```bash
docker compose up -d inference trainer
read -rs password
printf '%s' "$password" |
  docker compose run --rm -T trainer npm run user:add -- learner
unset password
```

Open `http://localhost:3001` and sign in with the manually created account.
Users must explicitly consent to detailed telemetry and pass the external
keyboard NKRO chord check before practice begins. See
[`trainer/README.md`](trainer/README.md) for the data boundary, FSRS scheduling,
administration, API, and local test instructions.

### Build all services

```bash
docker compose build
```

### Run the Web Demo (Server Mode)

**Requirements:** `lm.binary` must exist in the project root (see "Training" below). It is mounted into the container automatically.

```bash
docker compose up inference
```

Access the demo at `http://localhost:3000`.

The language model can take roughly 20 seconds to load. During that startup
window, Compose reports the `inference` container as `health: starting`; wait
until it is healthy before sending requests:

```bash
docker compose up -d inference stripped-plover
docker compose ps
curl --fail http://localhost:3000/ > /dev/null
```

Both long-running services restart automatically unless explicitly stopped.
Their health checks verify the inference HTTP endpoint and the Stripped Plover
TCP listener.

### Docker validation and troubleshooting

Validate the Compose file and rebuild every image after changing dependencies:

```bash
docker compose config --quiet
docker compose build
docker compose up -d inference stripped-plover
docker compose ps
docker compose logs --tail=100 inference stripped-plover
```

The KenLM build requires Boost program-options, system, thread, and unit-test
development packages. These are installed by the multi-stage `Dockerfile`; no
host Boost installation is needed. The Rust dependency-cache layer also creates
a temporary empty binary target before `cargo fetch`, because Cargo validates
that a manifest has at least one target.

If `inference` is unhealthy, first confirm that `lm.binary` exists as a regular,
readable file in the repository root, then inspect `docker compose logs
inference`. A missing or invalid model prevents the server from becoming ready.
To discard only the stack's containers and network while preserving the
Stripped Plover dictionary volume, run:

```bash
docker compose down
```

### Run Inference from the Command Line

```bash
docker compose run --rm --entrypoint ./inference-rs/target/release/inference-rs inference <v7_string>
```

**Example:**
```bash
docker compose run --rm --entrypoint ./inference-rs/target/release/inference-rs inference na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

### Optional Stripped Plover Service

The `stripped-plover` service clones and builds the Stripped Plover repository at container build time. It exposes a TCP proxy on port `4020` and stores the dictionary database in a Docker volume so it persists across restarts.

```bash
docker compose up stripped-plover
```

The inference service automatically connects to Stripped Plover via the `STRIPPED_PLOVER_HOST` and `STRIPPED_PLOVER_PORT` environment variables when the service is running. It is optional; the inference engine works normally without it.

### Build the Practice Android App Bundle

The `practice-android` service packages `static/practice.html` as a release-mode Android App Bundle under package name `com.huynhtrankhanh.v7practice`. It uses a fullscreen native WebView wrapper and derives a deterministic signing key from the password supplied at build time.

```bash
docker compose build practice-android
docker compose up -d practice-android
docker compose exec practice-android build-practice-aab "1.0.0"
```

The command writes the signed bundle and SHA-256 checksum to `android-artifacts/`, and also generates Play Console assets in `android-artifacts/play-store/` plus the launcher icon resources required inside the bundle. Pass a third argument to supply an explicit Android `versionCode`:

```bash
docker compose exec practice-android build-practice-aab "1.0.0" 100
```

See `practice-android/README.md` for the signing model, version handling, and direct `docker exec` examples.

## Training the Language Model

### 1. Prepare Corpus

Place your raw Vietnamese text corpus at `data/corpus-full.txt` (one sentence per line).

### 2. Run the Training Container

The `train` Docker service handles everything: preprocessing your corpus, training a 3-gram KenLM model, and binarizing it.

```bash
docker compose run --rm train bash train_lm.sh
```

This will:
1.  Preprocess `data/corpus-full.txt` into `data/corpus.tok`.
2.  Train a 3-gram language model (`lm.arpa`).
3.  Binarize the model into `lm.binary` for efficient runtime loading.

**Output artifacts (written to the project root):**
*   `lm.binary` — the trained model file required by the inference engine.

## Building Locally (Without Docker)

If you prefer a local build, you will need to install the system dependencies and build KenLM yourself. Docker is strongly recommended instead.

### Prerequisites

*   **Rust:** Latest stable toolchain.
*   **System Libraries:** `cmake`, `build-essential`, `libboost-all-dev`, `zlib1g-dev`, `libbz2-dev`, `liblzma-dev`.
*   **Python 3.11+** with `tqdm` (for the training script's progress display).

### Build Steps

```bash
# 1. Build KenLM
git clone https://github.com/kpu/kenlm.git
cd kenlm && mkdir -p build && cd build && cmake .. && make -j$(nproc) && cd ../..

# 2. Build the Rust inference engine
cd inference-rs && cargo build --release && cd ..

# 3. Build the web frontend
npm ci && npm run build
```

### Full-stack test

With the local KenLM build above and the Stripped Plover service running, the
full browser/inference/dictionary integration test is:

```bash
docker compose up -d stripped-plover
npm run test:e2e
```

If KenLM was built somewhere other than `./kenlm`, set `KENLM_ROOT` to its
source directory; that directory must contain `build/lib/libkenlm.a` and
`build/lib/libkenlm_util.a`.

## Running Inference

### Command-Line Mode

The compiled Rust binary expects `lm.binary` in the current working directory.

#### A. Legacy Mode (Single String)

Pass a single raw V7 string. The engine decodes it as a standalone sentence.

```bash
./inference-rs/target/release/inference-rs na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

**Output:**
```
Top results:
1. nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt
...

Inference time: Xms
```

#### B. Fixed Text Islands Mode (JSON)

Pass a JSON array of strings to interleave existing fixed text with V7 code islands. Fixed text provides context for the prediction.

**Format:** `["Fixed Text", "V7 Code", "Fixed Text", "V7 Code", ...]`
*   The array **must** start with a Fixed Text element (use an empty string `""` if there is no preceding text).
*   **Alternating structure:** Even indices are Fixed Text, odd indices are V7 Code.
*   **Context Propagation:** The engine "reads" fixed text to update its internal state, ensuring that subsequent V7 predictions are contextually appropriate. A question mark (`?`), exclamation mark (`!`), or full stop (`.`) starts a fresh sentence state, so words before it cannot influence inference after it.

**Example:**
```bash
./inference-rs/target/release/inference-rs '["hôm nay ", "tro2", " rất ", "dde7"]'
```

**Output (JSON Mode):**
Returns a JSON array of candidate lists. Each list contains the predicted text for the corresponding V7 island.

```json
[["trời","tròn",...], ["đẹp","đến",...]]
```

### Server Mode (Web Demo)

```bash
./inference-rs/target/release/inference-rs --server --port 3000 --static-dir static
```

Access the demo at `http://localhost:3000`. See `README_WEB.md` for the full web demo documentation.

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

Original V7 source files in this repository are licensed under the
[0BSD License](LICENSE).

The bundled Android distribution is a combined work that includes Stripped
Plover. The APK is conveyed under GPL-3.0-or-later and contains its complete
Corresponding Source as `v7-ime-source.zip`, exportable from **V7 IME
settings → Save Corresponding Source**. This distribution-level GPL notice
does not replace the 0BSD license on original V7 source files. Stripped Plover
and other third-party components retain their respective copyright and license
notices. See [V7 IME for Android](ime-android/README.md) for the Android
distribution and source details.

## Acknowledgments

This project was originally inspired by the [v7](https://github.com/ducngg/v7) repository. While the current codebase represents a significant divergence in implementation and approach, we acknowledge the instrumental role of the original project in the development of this engine. See `ACKNOWLEDGMENTS.md` for more details and the original license.
