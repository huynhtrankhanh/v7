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