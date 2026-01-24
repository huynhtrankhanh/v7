# V7 Web Demo Documentation

This document describes the implementation and usage of the V7 Text Prediction Engine web demo.

## Overview

The web demo provides a real-time stenographic input interface for the V7 inference engine. It is designed to be used with a QWERTY keyboard mapped to a stenographic layout, or a dedicated steno machine configured as a QWERTY keyboard.

## Key Features

- **Real-time Inference:** Decodes V7 code islands in context with fixed text islands.
- **Ambiguity Management:** Presents up to 5 candidates for V7 islands.
- **Seamless Mode Switching:** Automatically switches between fully specified syllables (fixed text) and partially specified V7 islands based on the input chord.
- **History & Undo:** Supports undoing the last action (syllable entry, V7 island entry, or candidate selection) using the `*` key.
- **Mobile Friendly:** Optimized for display on mobile devices with external keyboards.

## Getting Started

### Prerequisites

- Build the Rust inference engine: `cd inference-rs && cargo build --release`.
- Ensure `lm.binary` and `generated_regexes.json` are in the project root.

### Running the Server

Start the inference engine in server mode:

```bash
./inference-rs/target/release/inference-rs --server --port 3000 --static-dir static
```

Access the demo at `http://localhost:3000`.

## Stenographic Layout

The demo uses a QWERTY-to-Steno mapping:

| QWERTY | Steno | QWERTY | Steno |
| :--- | :--- | :--- | :--- |
| `Q` | `#` | `U` | `-F` |
| `A` | `S-` | `J` | `-R` |
| `W` | `T-` | `I` | `-P` |
| `S` | `K-` | `K` | `-B` |
| `E` | `P-` | `O` | `-L` |
| `D` | `W-` | `L` | `-G` |
| `R` | `H-` | `P` | `-T` |
| `F` | `R-` | `;` | `-S` |
| `C` | `A` | `T, G` | `-D` |
| `V` | `O` | `Y, H` | `-Z` |
| `N` | `E` | `Space` | `*` |
| `M` | `U` | | |

## Stenography Rules

The system parses strokes greedily in the following order: **Initial Consonant** (longest match) -> **Vowel** (longest match) -> **Final Consonant** (longest match) -> **Tone** (remaining keys).

If a stroke cannot be parsed according to these rules, it is **ignored**. An ignored stroke does not change the internal state or the text buffer, and it does not affect the parsing of subsequent strokes.

### 1. Initial Consonants (Left Hand)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `PW` | b | `TPH` | n |
| `K` | c | `TPR` | nh |
| `KH` | ch | `TPW` | ng/ngh |
| `KWR` | d | `P` | p |
| `TK` | đ | `R` | r |
| `TP` | ph | `KP` | s |
| `TKPW` | g/gh | `T` | t |
| `H` | h | `TH` | th |
| `KWH` | gi | `TR` | tr |
| `KHR` | kh | `W` | v |
| `HR` | l | `WR` | x |
| `PH` | m | | |

*   **Orthography Rules:**
    *   `TPW` (`ng`): Automatically becomes `ngh` when followed by front vowels (`i`, `e`, `ê`).
    *   `TKPW` (`g`): Automatically becomes `gh` when followed by front vowels.
    *   `K` (`c`): Automatically becomes `k` when followed by front vowels, or `q` if the "on-glide" (S key) is present.

### 2. Vowels (Thumbs)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `A` | a | `OEU` | iê/ia |
| `AE` | ă | `AEU` | ua/uô |
| `AO` | â | `AOE` | ưa/ươ |
| `E` | e | `AOU` | ư |
| `AU` | ê | `OU` | ơ |
| `EU` | i | `OE` | ô |
| `O` | o | `AOEU` | y |
| `U` | u | | |

### 3. Final Consonants (Right Hand)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `FP` | j (i/y) | `RB` | ch |
| `F` | w (u/o) | `PB` | nh |
| `P` | p | `L` | n |
| `R` | t | `PL` | m |
| `FR` | c | `B` | ng |

*   **Orthography Rules:**
    *   `F` (`w`): Becomes `u` (e.g., *sau*) or `o` (e.g., *sao*) depending on the preceding vowel.
    *   `FP` (`j`): Becomes `y` (e.g., *tay*) or `i` (e.g., *tai*) depending on the preceding vowel.

### 4. Tones (Right Hand - Remaining Keys)

Tones are determined by the remaining keys after matching the final consonant.

| Steno Keys | Tone | Diacritic | Example |
| :--- | :--- | :--- | :--- |
| *(None)* | Ngang | (none) | ma |
| `T` | Sắc | Acute (´) | má |
| `S` | Huyền | Grave (`) | mà |
| `G` | Hỏi | Hook (?) | mả |
| `TS` | Ngã | Tilde (~) | mã |
| `GS` | Nặng | Dot (.) | mạ |

### 5. On-Glide (S-)
The Left `S` key (mapped to `A` on QWERTY) can act as an "on-glide" modifier if it's not part of another valid initial consonant sequence. It typically introduces a medial `u` or `o` sound (e.g., *hoa*, *tuân*) or modifies `c` to `q` (e.g., *qua*).

### 6. Capitalization (#)
The `#` key (mapped to `Q` on QWERTY) capitalizes the first letter of the resulting syllable.

## Usage

### Syllable Entry (Fixed Text)
Most common Vietnamese syllables can be fully specified using standard steno chords. These are immediately converted to text and added to the sentence.

### V7 Island Entry
A V7 island represents two syllables partially specified. A stroke that includes a separator (`*` or `-`) and doesn't match a fully specified syllable will be treated as a V7 island. The engine will infer the best candidates based on the current context.

### Candidate Selection
When candidates are displayed, use the following chords to select one:
- `TK`: Candidate 1
- `PW`: Candidate 2
- `HR`: Candidate 3
- `-FR`: Candidate 4
- `-PB`: Candidate 5

Selecting a candidate collapses the ambiguity and merges it into the fixed text context.

### Undo
The `*` key (Spacebar) by itself undoes the previous stroke.

## Implementation Details

- **Frontend:** Written in vanilla JavaScript (`static/script.js`). Uses `fetch` to communicate with the `/infer` endpoint.
- **Backend:** The Rust binary `inference-rs` serves static files from `static/` and handles API requests using the `axum` framework.
- **Inference Mode:** Utilizes the "Fixed Text Islands" mode of the inference engine to provide context-aware predictions.