**inference-rs should support two modes:**

* Inference with no fixed text: just `inference-rs [v7 code]`, which is the current behavior
* Inference with **FIXED TEXT ISLANDS:**
  A JSON array of strings is passed as the parameter.
  ```
  inference-rs ["đây là ", "mo7ka1zi2ddo1ra6", "kì lạ"]
  ```
  The first element is a fixed text island, the second element is an island of v7 code needing to be expanded, the third element is a fixed text island, and so forth. They alternate.

  **The first element is always a fixed text island.** If there is no fixed text island at the beginning, supply an empty string as the first element.


  **Inference strategy:** This is a modification of the existing beam search code. However, as there are **fixed text islands**, which can contain punctuation or numbers, which are not recognized by the model, the whole thing has to be purified using the exact same logic as the preprocess_corpus.py. After that the inference process can start.

  **Output:** Multiple candidates. Each candidate is an array of predicted text of v7 islands. Fixed text islands don't need to be outputted.
