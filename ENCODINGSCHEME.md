# Vietnamese Syllable Encoding Scheme (3-Letter)

This document describes a human-optimized 3-character encoding scheme for Vietnamese syllables using standard 36-key input (0-9, A-Z).

## Overview

A valid syllable `S` is encoded into `C1 C2 C3`.

1.  **C1 (Consonant)**: Direct mnemonic mapping.
2.  **C2 (Rhyme Group)**: The alphabetic group index of the rhyme.
3.  **C3 (Tone & Variant)**: Encodes the specific rhyme within the group (1 of 4) and the tone (0-7) using distinct key ranges.

## Character 1: Initial Consonant

| Consonant | Key | Logic |
| :--- | :--- | :--- |
| `0` (None) | `0` | Zero |
| `b` | `B` | **B** |
| `ch` | `C` | **C**h |
| `d` | `D` | **D** |
| `đ` | `E` | Next to D / **E** |
| `g` | `G` | **G** |
| `h` | `H` | **H** |
| `k` | `K` | **K** |
| `kh` | `Q` | **Q** ~ K |
| `l` | `L` | **L** |
| `m` | `M` | **M** |
| `n` | `N` | **N** |
| `ng` | `W` | **W** |
| `nh` | `J` | **J** |
| `p` | `P` | **P** |
| `ph` | `F` | **F** |
| `r` | `R` | **R** |
| `s` | `S` | **S** |
| `t` | `T` | **T** |
| `th` | `A` | **A** |
| `tr` | `Y` | **Y** |
| `v` | `V` | **V** |
| `x` | `X` | **X** |
| `z` | `Z` | **Z** |

## Character 2: Rhyme Group

The 106 rhymes are sorted alphabetically and split into groups of 4.
`C2` indicates which group the rhyme belongs to.

| Key | Group | Rhymes (Ordered) |
| :--- | :--- | :--- |
| `0` | A | `a`, `ai`, `am`, `an` |
| `1` | B | `ang`, `anh`, `ao`, `au` |
| `2` | C | `ay`, `e`, `em`, `en` |
| ... | ... | ... |

*(See `3letter_codec.py` for full sorted list)*

## Character 3: Tone & Variant

This character selects one of the 4 rhymes in the group (Variant) AND the Tone (0-7).
It uses **Key Ranges** so no calculation is needed.

### Ranges

*   **1st Rhyme in Group**: Use Keys **`0` - `7`**
    *   Tone 0 $\to$ `0`, Tone 1 $\to$ `1`, ..., Tone 7 $\to$ `7`.
*   **2nd Rhyme in Group**: Use Keys **`A` - `H`**
    *   Tone 0 $\to$ `A`, Tone 1 $\to$ `B`, ..., Tone 7 $\to$ `H`.
*   **3rd Rhyme in Group**: Use Keys **`I` - `P`**
    *   Tone 0 $\to$ `I`, Tone 1 $\to$ `J`, ..., Tone 7 $\to$ `P`.
*   **4th Rhyme in Group**: Use Keys **`Q` - `X`**
    *   Tone 0 $\to$ `Q`, Tone 1 $\to$ `R`, ..., Tone 7 $\to$ `X`.

### Example: "nghiêng"

1.  **Consonant**: `ng` $\to$ **`W`**.
2.  **Rhyme**: `iêng`.
    *   Sorted list: ..., `iên`, `iêng`, `iêu`, ...
    *   It falls into Group **`5`** (Key 5).
    *   In this group (`iêm`, `iên`, `iêng`, `iêu`), it is the **3rd** rhyme.
3.  **Tone**: `0` (Flat).
    *   3rd Rhyme uses Range **`I` - `P`**.
    *   Tone 0 is the 1st key in this range $\to$ **`I`**.

**Result**: `W5I`.
