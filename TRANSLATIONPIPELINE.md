# Translation Pipeline

This document explains how user input is converted into final Vietnamese text using the `v7gpt` Large Language Model (LLM) within the v7 input method.

## Tokenization

Unlike many standard LLMs that use Byte-Pair Encoding (BPE), `v7gpt` uses a **Vietnamese syllable-based tokenization**.

*   **Vocabulary**: The vocabulary consists of approximately 17,789 tokens, representing complete Vietnamese words/syllables plus a padding token.
*   **Mapping**: Each token maps to a specific integer. The tokenizer maintains mappings for:
    *   Word to Integer (`enum.json`)
    *   Integer to Word (`renum.json`)
    *   Integer to Consonant-Rhyme-Tone (CRT) decomposition (`renum_crt.json`)

This approach allows the model to operate directly at the level of meaningful Vietnamese linguistic units.

## User Input Processing

When a user types input (e.g., `xin chaof` for "xin chào"):

1.  **Parsing**: The input string is separated into segments based on tone markers and other rules.
2.  **Constraint Extraction**: Each segment is analyzed to determine the constraints for Consonant, Rhyme, and Tone (CRT). This creates a set of "Matching Triplets" that the generated text must satisfy.

## Generation Strategy

The model does not use complex search algorithms like Beam Search. Instead, it employs a **Greedy Search with Constraints** strategy.

### The Process

The generation process iterates through each segment of the user input:

1.  **Context**: The process starts with a context (defaulting to "tôi" if empty).
2.  **Prediction**: The LLM predicts the probability distribution for the next token based on the current context.
3.  **Filtering & Selection**:
    *   The predicted tokens are sorted by probability in descending order.
    *   The system iterates through this sorted list and selects the **first token** that satisfies the constraints derived from the user's input for the current position.
    *   **Constraints**: The candidate word must match the required Consonant, Rhyme, and Tone.
4.  **Update**: The selected word is appended to the context, and the process repeats for the next input segment.

### Final Word Handling

For the final segment of the input, the process is slightly different to offer suggestions:
*   Instead of picking just one word, the system collects up to a limit (e.g., 36) of valid candidates from the sorted prediction list.
*   These candidates form the list of possible phrases presented to the user.

### Why this strategy?

This "Greedy Constraint-Satisfying" approach is efficient and effective for an Input Method Editor (IME) because:
*   It ensures the output strictly adheres to what the user typed (phonetically).
*   It prioritizes the most linguistically probable words that fit the typing pattern.
*   It avoids the computational overhead of Beam Search while still leveraging the LLM's contextual understanding.
