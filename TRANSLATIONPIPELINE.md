# Translation Pipeline

This document explains how user input is converted into final Vietnamese text using the `v7gpt` Large Language Model (LLM) within the v7 input method.

## Tokenization

Unlike many standard LLMs that use Byte-Pair Encoding (BPE), `v7gpt` uses a **Vietnamese syllable-based tokenization**.

*   **Vocabulary**: The vocabulary consists of approximately 17,789 tokens, representing complete Vietnamese words/syllables plus a padding token.
*   **Mapping**: The tokenizer maintains mappings loaded from JSON files. This is defined in `ai/tokenizer.py` (lines 14-23):

    ```python
    with open(enum_path, 'r', encoding='utf-8') as f:
        self.enum: dict[str, int] = json.load(f)
    with open(renum_path, 'r', encoding='utf-8') as f:
        self.renum: dict[int, str] = json.load(f)
    with open(renum_crt_path, 'r', encoding='utf-8') as f:
        self.renum_crt: list[tuple[str, str, int]] = json.load(f)
    ```

    *   `enum.json`: Word to Integer
    *   `renum.json`: Integer to Word
    *   `renum_crt.json`: Integer to Consonant-Rhyme-Tone (CRT) decomposition

## User Input Processing

When a user types input (e.g., `xin chaof` for "xin chào"), it is processed in `imethod/v7ai.py`.

1.  **Parsing**: The input string is separated into segments based on tone markers. This uses `seperate_raws` inherited from `imethod/v7.py` (lines 135-141):
    ```python
    pattern = r'[a-zA-Z{}]+(?:\d|$)'.format(re.escape(self.end_of_rhyme))
    raws = re.findall(pattern, raws)
    ```

2.  **Constraint Extraction**: Each segment is analyzed to determine the constraints for Consonant, Rhyme, and Tone (CRT). This happens in `predict` within `imethod/v7ai.py` (lines 68-69):
    ```python
    raws_parts = [self.parse(raw.lower()) for raw in raws]
    CRsTs = [self.find(raw_parts) for raw_parts in raws_parts]
    ```
    This creates a set of "Matching Triplets" (`CRsTs`) that the generated text must satisfy.

## Generation Strategy

The model does not use complex search algorithms like Beam Search. Instead, it employs a **Greedy Search with Constraints** strategy. This logic is implemented in `imethod/v7ai.py`.

### The Process

The core logic resides in `top_1_predict` in `imethod/v7ai.py`.

1.  **Context**: The process starts with a context (defaulting to "tôi" if empty) (lines 64-65).
2.  **Prediction**: The LLM predicts the probability distribution for the next token based on the current context. It calls `next` from `ai/utils.py` (lines 9-27), which returns sorted indices of logits:
    ```python
    # From ai/utils.py
    logits = model(tokens)[0]
    logits = logits[:, -1, :]
    sorted_indices = torch.argsort(logits, dim=-1, descending=True)
    ```

3.  **Filtering & Selection**:
    *   The system iterates through the sorted predictions and selects the first token that satisfies the constraints.
    *   This is shown in `imethod/v7ai.py` (lines 118-124):
    ```python
    prediction = next(self.model, [context])[0]
    prediction.remove(0)

    for triplet, word in zip(tokenizer.triplets(prediction), tokenizer.detokenize(prediction)):
        if self.accept(triplet, CRsT, word, vni_tones):
            context += ' ' + word
            current_result.append(word)
            break
    ```
    *   **Constraints**: The `accept` method (lines 37-59 in `imethod/v7ai.py`) verifies if the candidate matches the user's input rule:
    ```python
    if tone != tone_rule:
        return False
    if rhyme not in rhymes_rule:
        return False
    # ... consonant checks ...
    ```

4.  **Update**: The selected word is appended to the context, and the process repeats for the next input segment.

### Final Word Handling

For the final segment of the input, the process collects multiple candidates to offer suggestions. This is also in `top_1_predict` (lines 129-136):

```python
LIMIT = 36
results: List[Phrase] = []
for triplet, word in zip(tokenizer.triplets(prediction), tokenizer.detokenize(prediction)):
    if len(results) >= LIMIT:
        break
    if self.accept(triplet, CRsTs[-1], word, vni_tones):
        results.append(' '.join(current_result + [word]))
```

### Why this strategy?

This "Greedy Constraint-Satisfying" approach is efficient and effective for an Input Method Editor (IME) because:
*   It ensures the output strictly adheres to what the user typed (phonetically).
*   It prioritizes the most linguistically probable words that fit the typing pattern.
*   It avoids the computational overhead of Beam Search while still leveraging the LLM's contextual understanding.
