# Inference RS Web Demo

This is a web-based stenography demo for the V7 inference engine.

## Prerequisites

- Rust (Cargo)
- A V7 language model binary (`lm.binary`)
- `generated_regexes.json` in the root directory.

## Running the Server

1. Build the project:
   ```bash
   cd inference-rs
   cargo build --release
   ```

2. Run the server:
   ```bash
   ./target/release/inference-rs --server --port 3000 --static-dir ../static --model-path ../lm.binary
   ```
   (Adjust paths as necessary).

3. Open your browser at `http://localhost:3000`.

## Using the Demo

- **Typing:** Use your keyboard (mapped to Steno layout) to type syllables.
  - **Fixed Text:** Type standard steno strokes for single syllables.
  - **V7 Code:** Type steno strokes involving the Spacebar (`*`) to input partial 2-syllable codes.
- **Candidates:** When V7 codes are input, candidates will appear at the bottom.
- **Selection:** Select a candidate by clicking or using selection chords:
  - `TK` -> Candidate 1
  - `PW` -> Candidate 2
  - `HR` -> Candidate 3
  - `-FR` (Right F + Right R) -> Candidate 4
  - `-PB` (Right P + Right B) -> Candidate 5
- **Undo:** Press Spacebar (`*`) alone to undo the last stroke.

## How it Works

The frontend (`static/script.js`) captures QWERTY key events and maps them to Stenography keys. It maintains a state of "Islands" (Fixed Text or V7 Codes).
- **Fixed Text:** Parsed directly in the browser using `parse` and `assemble` functions.
- **V7 Codes:** Decoded in the browser from steno strokes into V7 format (Consonant + Vowel + Tone).
- **Inference:** The frontend sends the list of islands to the backend (`/infer`). The backend uses KenLM and Beam Search to find the most likely Vietnamese sentences matching the islands.
