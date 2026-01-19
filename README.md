# `v7` Input Method

This project implements the `v7` Vietnamese input method, designed to be a faster typing method by predicting words based on partial input (Consonant + Tone).

## Input Format

`v7` combines features from VNI and Telex.

### Special Consonants
- `g`: Represents `g` and `gh`.
- `ng`: Represents `ng` and `ngh`.
- `z`: Represents `gi`. (e.g., `z6` → `giúp`, `giết`)
- `dd`: Represents `đ` (Telex style). (e.g., `dd4` → `đã`, `đỗ`)
- `w`: Represents `qu`.
- `0`: No initial consonant.

### Tones (VNI Style)
The system uses an 8-tone system (compatible with standard 6-tone analysis):
- `0`: No tone (`tuân`, `câm`)
- `1`: Acute (`cấm`, `tấn`)
- `2`: Grave (`tuần`, `cầm`)
- `3`: Hook (`tẩn`, `cẩm`)
- `4`: Tilde (`mãi`, `rã`)
- `5`: Underdot (`nhậm`, `mạnh`)
- `6`: Checked Acute (`cấp`, `tất` - ends with p, t, c, ch)
- `7`: Checked Underdot (`nhập`, `mạch` - ends with p, t, c, ch)

### Vowels
You do not need to type diacritics for vowels (ă, â, ê, ô, ơ, ư). Just type the base vowel (`a`, `e`, `o`, `u`) and the system predicts the correct one.

### Example
Input: `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7`
Output: `nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt`

## How It Works

The system uses a corpus to learn the probability of words and sentences.
1.  **Preprocessing**: The `preprocess_corpus.py` script cleans the corpus.
2.  **Inference**: The system (e.g., implemented in Rust in `inference-rs`) parses the v7 string into syllable templates and searches for the most likely sentence using a language model.

## Corpus Preprocessing

Use `preprocess_corpus.py` to prepare your text data:

```bash
python preprocess_corpus.py <input_file> <output_file>
```

## Language Model

See [README_KENLM.md](README_KENLM.md) for details on training the KenLM model and running inference.
