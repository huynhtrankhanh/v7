# V7 Web Demo Documentation

This document describes the implementation and usage of the V7 Text Prediction Engine web demo.

## Overview

The web demo provides a real-time stenographic input interface for the V7 inference engine. It is designed to be used with a QWERTY keyboard mapped to a stenographic layout, or a dedicated steno machine configured as a QWERTY keyboard.

## Key Features

- **Real-time Inference:** Decodes V7 code islands in context with fixed text islands.
- **Ambiguity Management:** Presents up to 5 candidates for V7 islands.
- **Seamless Mode Switching:** Automatically switches between fully specified syllables (fixed text) and partially specified V7 islands based on the input chord.
- **History & Undo:** Supports undoing the last action (syllable entry, V7 island entry, or candidate selection) using the `*` key.
- **Smart Spacing:** Automatically manages spacing between different types of content (Vietnamese text, punctuation, capitals) to prevent double spacing.
- **Emily Symbols:** Supports Emily symbol strokes with configurable attachment spacing.
- **Mobile Friendly:** Optimized for display on mobile devices with external keyboards.

## Island Types & Spacing Rules

The frontend organizes text into "islands" to manage spacing intelligently. The types are:

*   **Vietnamese:** Whole syllables or V7 partially specified syllable pairs.
*   **Punctuation:** `.` `,` `!` `?`.
*   **Capital Letter:** Literal uppercase letters.
*   **Spacing:** Explicit Space or Newline.
*   **Emily:** Emily symbol output (e.g. punctuation-like symbols with explicit attachment spacing).

**Spacing Rules:**
*   **Vietnamese ↔ Vietnamese:** Space added.
*   **Vietnamese → Capital:** Space added (e.g., `Xin Chào`).
*   **Punctuation → Vietnamese:** Space added (e.g., `. Xin`).
*   **Punctuation → Capital:** Space added (e.g., `. A`).
*   **Capital → Capital:** No space (e.g., `USA`).
*   **Capital → Vietnamese:** No space (e.g., `The`).
*   **Punctuation → Punctuation:** No space.
*   **Any ↔ Spacing:** No extra space added.
*   **Emily Symbols:** Explicit attachment metadata controls whether spacing is added around the symbol.

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

![Steno Keyboard Layout](static/keyboard.svg)

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

### Space & Newline
- `S-P`: Inserts a Space Island.
- `Enter`: Inserts a Newline Island.

### Escape Hatch
- Stroke `#S-`: 
    - Selects the top candidate if any.
    - Collapses all ambiguity.
    - Clears the undo buffer.
    - Switches to a raw text area for direct typing.
    - Press `Esc` to return to steno mode (undo buffer remains empty).

### Literal Uppercase
- `Shift + [Letter]`: Appends the uppercase letter literally as a Capital Island. Spacing is determined by the spacing rules (e.g. no space if previous was capital).

### Punctuation
Standard steno chords for punctuation:
- `TP-PL`: Period (`.`)
- `KW-BG`: Comma (`,`)
- `KW-PL`: Question mark (`?`)
- `TP-BG`: Exclamation mark (`!`)

Punctuation marks are inserted as Punctuation Islands without trailing spaces. Spacing after punctuation is handled automatically by the spacing rules.

### Emily Symbols
Emily symbol strokes (starter `SKWH`) follow the upstream spacing behavior. Attachment keys control spacing around the symbol in the `space` attachment method:
- No attachment keys: no surrounding spaces (symbol attaches to both sides).
- `A`: insert space before the symbol.
- `O`: insert space after the symbol.
- `AO`: insert spaces on both sides.

Spacing is not applied for `{*!}` and `{*?}` retrospective space macros.

### Shortcuts
- `Ctrl+C`: Copies the entire text buffer to the clipboard if no text is selected.

### Stripped Plover Integration
The web demo can optionally integrate with Stripped Plover for strokes that do not match the built-in rules. Press the `#` key (Q on the QWERTY layout) to toggle Stripped Plover mode. When enabled, all strokes are routed to Stripped Plover. When disabled, unrecognized strokes are sent to Stripped Plover as a one-shot translation.

Use the Dictionary Management panel in the UI to upload JSON/Python dictionaries, remove dictionaries, and add/update/remove individual entries.

## Single-Syllable Mode Orthographic Rules (Deterministic)

This section is the complete rule set for **single-syllable mode** (i.e., strokes entered **without** `*` held). It is intentionally exhaustive so you can determine exactly what every valid stroke will output.

### Parsing Order (strict, greedy, left-to-right)

For single-syllable mode, each stroke is parsed in this exact order:

1. Optional capitalization marker: `#`
2. Optional on-glide marker: `S`
3. Initial consonant (longest match, 4 keys -> 1 key)
4. Vowel nucleus (longest match, 4 keys -> 1 key) **(required)**
5. Final consonant (longest match, 2 keys -> 1 key, optional)
6. Tone (all remaining keys, optional)

If any stage fails (especially vowel or leftover tone parsing), the stroke is **ignored** (no text output, no state mutation).

### 1) Initial Consonants (after optional `#` and optional leading `S`)

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

Additional deterministic onset orthography:

- Define vowel classes used below:
  - **Back-vowel group:** `a, ă, â, o, ô, ơ, u, ư, ua/uô, ưa/ươ`
  - **Front-vowel group:** `e, ê, i, iê/ia, y`
- `TPW` (`ng/ngh`) outputs:
  - `ng` when on-glide is present OR vowel is in the back-vowel group
  - `ngh` otherwise (front-vowel group)
- `TKPW` (`g`) outputs:
  - `g` when on-glide is present OR vowel is in the back-vowel group
  - `gh` otherwise
- `KWH` (`gi`) outputs:
  - `g` when **no on-glide** and vowel is `i` or `iê/ia`
  - `gi` in all other cases
- `K` (`c`) outputs:
  - `q` when on-glide is present
  - `c` when no on-glide and vowel is in the back-vowel group
  - `k` when no on-glide and vowel is in the front-vowel group

### 2) Vowels (required nucleus)

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

### 3) Final Consonants (optional coda)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `FP` | j (i/y) | `RP` | nh |
| `F` | w (u/o) | `P` | m |
| `R` | n | `FR` | ng |

Final rendering rules:

- `F` (`w`) renders as:
  - `u` if vowel is one of: `iê/ia, ư, ưa/ươ, ê, u, ă, â, i`
  - `o` otherwise
- `FP` (`j`) renders as:
  - `y` if vowel is `ă` or `â`
  - `i` otherwise
- `P`, `R`, `FR`, `RP` usually render as `m`, `n`, `ng`, `nh`, except under stop-tone conversion (below).

### 4) Tones (remaining right-hand keys after coda parsing)

Tones are determined by the remaining keys after matching the final consonant.

| Steno Keys | Tone | Diacritic | Example |
| :--- | :--- | :--- | :--- |
| *(None)* | Ngang | (none) | ma |
| `L` | Sắc | Acute (´) | má |
| `G` | Huyền | Grave (`) | mà |
| `B` | Hỏi | Hook (?) | mả |
| `LG` | Ngã | Tilde (~) | mã |
| `BG` | Nặng | Dot (.) | mạ |
| `BL` | Sắc (Stop) | Acute (´) | mát |
| `BLG` | Nặng (Stop) | Dot (.) | mạt |

Stop-tone conversion (`BL` / `BLG`) is strict:

- Allowed only when steno coda is one of:
  - `P` -> output coda `p`
  - `R` -> output coda `t`
  - `FR` -> output coda `c`
  - `RP` -> output coda `ch`
- `BL` forces tone to `sắc`; `BLG` forces tone to `nặng`.
- This reflects Vietnamese checked-syllable orthography where stop codas are written `-p/-t/-c/-ch` rather than the nasal outputs of `P/R/FR/RP`.
- If `BL`/`BLG` appears with no coda or with codas `F`/`FP`, the stroke is **invalid and ignored**.

### 5) On-Glide (`S` immediately after optional `#`)

On-glide is only read from the **leading** `S` position (before onset parsing). It modifies nucleus construction as follows:

- General rule:
  - open syllable (no coda): prefix `o` before the nucleus
  - closed syllable (has coda): prefix `o` and attach tone mark to the main vowel letter
- Specialized behavior by vowel:
  - `iê/ia`:
    - no coda -> `uy` + accented `a`
    - has coda -> `uy` + accented `ê`
  - `i`:
    - has coda -> `u` + accented `y`
    - no coda:
      - if onset is `c` -> `u` + accented `y`
      - otherwise -> accented `u` + `y`
  - `ă` with rendered coda `w/j` (from steno codas `F`/`FP`): replaces base with accented `a`; prefix is:
    - `u` if onset is `c`
    - `o` otherwise
  - `â` or `ê`: uses `u` + accented vowel (not `o` prefix form)
  - any vowel with onset `c`: uses `u` + accented vowel (reflects `qu...` behavior)

### 6) Vowel-shape resolution rules (what actually gets written)

These are applied after parse and before final coda rendering:

- `iê/ia`:
  - no coda -> `ia` form (with proper tone placement)
  - has coda -> `iê`/`yê` form (tone on `ê`)
  - onset empty + no on-glide + has coda uses `yê...`
- `ua/uô`:
  - no coda -> `ua` (tone on `u`)
  - has coda -> `uô` (tone on `ô`)
- `ưa/ươ`:
  - no coda -> `ưa` (tone on `ư`)
  - has coda -> `ươ` (tone on `ơ`)
- `ă` + (`w` or `j` coda): nucleus written with `a`-tone series (orthographic `au/ay`-type behavior).

### 7) Capitalization (`#`)

`#` uppercases the first output character of the assembled syllable.

### 8) Complete validity / ignore conditions

A single-syllable stroke is ignored if any of these occurs:

1. No valid vowel can be matched after optional `#`, optional leading `S`, and onset parsing.
2. After optional coda parsing, remaining keys are neither empty nor a valid tone key sequence.
3. `BL`/`BLG` is used without a compatible coda (`P`, `R`, `FR`, `RP`).
4. Any extra unmatched key remains at the end of parse.

### 9) Step-by-step deterministic input recipe

To enter a syllable with certainty:

1. Decide whether syllable-initial capitalization is needed (`#` or not).
2. Decide whether you need on-glide (`S` before onset) for `o/u` medial behavior (`qua`, `hoa`, `uy...` patterns).
3. Enter onset keys using the longest onset pattern from the table.
4. Enter exactly one vowel pattern (longest match principle).
5. Optionally enter one coda pattern.
6. Optionally enter tone keys:
   - plain tones: `L`, `G`, `B`, `LG`, `BG`
   - stop tones only with stop codas: `BL` or `BLG`
7. Ensure no extra keys remain; otherwise the stroke will be ignored.

### 10) Practical certainty notes

- The parser is greedy for onset and vowel; if two options share prefixes, the longest valid one wins.
- On-glide is only the leading `S`, not any later `S` that belongs to another pattern.
- Single-syllable mode is strictly orthographic assembly; there is no language-model inference in this path.
- If a stroke is ignored, nothing is partially committed.

## V7 Island Rules (Two-Syllable Islands)

A V7 Island allows encoding two syllables in a single stroke by using the keyboard as two separate halves. **V7 mode is exclusively activated by holding down the `*` (Spacebar) key while entering the stroke.**

**Structure:** `[Left Syllable]*[Right Syllable]`

#### Keyboard Zones (Mirrored Layout)

The V7 layout is designed to be **perfectly mirrored** between the left and right hands.

![V7 Layout Zones](static/v7_layout_zones.svg)

*   **Left Hand:** Uses the standard QWERTY keys `Q, W, E, R, A` for consonants, `S, D, F` for tones, and `C, V` for vowels.
*   **Right Hand:** Mirrors the left hand using `P, O, I, U, ;` for consonants, `L, K, J` for tones, and `N, M` for vowels.

#### Consonant Patterns (Onsets)

The following patterns show which keys to press for each consonant. The dots represent the relative positions of the 5 consonant keys for each hand.

![V7 Consonant Bitmasks](static/v7_onsets.svg)

#### Tone and Vowel Patterns

Tones use 3 bits (3 keys), while vowels use 2 bits (2 keys).

![V7 Tones and Vowels](static/v7_tones_vowels.svg)

#### Component Mappings

#### Consonants
| Consonant | Left Hand Keys | Right Hand Keys |
| :--- | :--- | :--- |
| **0** | `(None)` | `(None)` |
| **b** | `# + S + P` | `-T + -S + -P` |
| **ch** | `S + T + H` | `-S + -L + -F` |
| **d** | `# + T + P + H` | `-T + -L + -P + -F` |
| **dd** | `# + S + T` | `-T + -S + -L` |
| **g** | `# + S + T + P` | `-T + -S + -L + -P` |
| **h** | `H` | `-F` |
| **k** | `# + T` | `-T + -L` |
| **kh** | `# + S + T + H` | `-T + -S + -L + -F` |
| **l** | `# + S + H` | `-T + -S + -F` |
| **m** | `P + H` | `-P + -F` |
| **n** | `T + P + H` | `-L + -P + -F` |
| **ng** | `# + T + P` | `-T + -L + -P` |
| **nh** | `# + S + T + P + H` | `-T + -S + -L + -P + -F` |
| **p** | `P` | `-P` |
| **ph** | `T + P` | `-L + -P` |
| **r** | `# + H` | `-T + -F` |
| **s** | `S + T + P` | `-S + -L + -P` |
| **t** | `T` | `-L` |
| **th** | `T + H` | `-L + -F` |
| **tr** | `# + T + H` | `-T + -L + -F` |
| **v** | `# + P` | `-T + -P` |
| **w** | `# + S` | `-T + -S` |
| **x** | `# + P + H` | `-T + -P + -F` |
| **z** | `S + T + P + H` | `-S + -L + -P + -F` |

#### Vowels
| Vowel | Left Hand Keys | Right Hand Keys | Notes |
| :--- | :--- | :--- | :--- |
| **a** | `A` | `U` |  |
| **o** | `O` | `E` |  |
| **i** | `A + O` | `U + E` |  |
| **e/u** | `(None)` | `(None)` | Default `e`. Becomes `u` if `-D` (Left) or `-Z` (Right) is pressed. |

#### Tones
| Tone | Left Hand Keys | Right Hand Keys |
| :--- | :--- | :--- |
| **Ngang** (0) | `(None)` | `(None)` |
| **Sắc** (1) | `K` | `-G` |
| **Huyền** (2) | `W` | `-B` |
| **Ngã** (4) | `K + W` | `-G + -B` |
| **Hỏi** (3) | `R` | `-R` |
| **Sắc (Stop)** (6) | `K + R` | `-G + -R` |
| **Nặng** (5) | `W + R` | `-B + -R` |
| **Nặng (Stop)** (7) | `K + W + R` | `-G + -B + -R` |

## Usage

**CRITICAL: MODE SWITCHING**

The system automatically distinguishes between two input modes based on the `*` (Spacebar) key:

1.  **Single Syllable Mode:** Type your stroke **WITHOUT** holding down the `*` key.
2.  **V7 Island Mode (Two Syllables):** Type your stroke **WHILE HOLDING DOWN** the `*` key.

---

### Single Syllable Entry (Fixed Text)

Most common Vietnamese syllables can be fully specified using standard steno chords. These are immediately converted to text and added to the sentence.

*   **Action:** Press the keys for a single syllable.
*   **Result:** Unambiguous text is inserted immediately.

### V7 Island Entry (Predictive Text)

A V7 island represents two syllables partially specified. This mode leverages the V7 inference engine to predict the best candidates based on the surrounding context.

*   **Action:** Hold down the `*` key (Spacebar) while pressing the keys for the two syllables.
*   **Result:** A list of 5 candidates appears at the bottom. The main text display shows a preview of the top candidate.

### Candidate Selection

When candidates are displayed, you must select one to proceed. Use the following keys (standard steno chords):
- `-T`: Candidate 1
- `-TS`: Candidate 2
- `-S`: Candidate 3
- `-D`: Candidate 4
- `-Z`: Candidate 5

Selecting a candidate collapses the ambiguity and merges the choice into the fixed text context.
Candidate selection keys can also be combined with **single-syllable** strokes in the same chord: the candidate is selected first, then the syllable is appended, and this combined action is treated as a single undo step.
If the combined chord does not form a valid single-syllable stroke, it is ignored.

### Undo

The `*` key (Spacebar) pressed by itself undoes the previous action (syllable entry, island entry, or candidate selection).

---

## Implementation Details

- **Frontend:** Written in vanilla JavaScript (`static/script.js`). Uses `fetch` to communicate with the `/infer` endpoint.
- **Backend:** The Rust binary `inference-rs` serves static files from `static/` and handles API requests using the `axum` framework.
- **Inference Mode:** Utilizes the "Fixed Text Islands" mode of the inference engine to provide context-aware predictions.
