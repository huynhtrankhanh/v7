# Dictionary mode reform

1. There is an inappropriate note on dictionary mode in README.md. Remove it.
2. Rework README_WEB.md to reflect the new changes.
3. The changes are as follows:
   * If there is a dictionary mode, inference is to infer the word with **zero context** using KenLM when **there is no corresponding entry in the dictionary file**. This is to entirely remove the possibility of dictionary misses.
   * Intermediate pre-inference form in IME:
     * V7 (non dictionary mode): [code1code2]
     * V7 (dictionary mode): [D: code1code2]
     * **ILLEGAL V7 CODE (for when at least one constituent code has zero inference candidates)**:
       * If dictionary mode: [DI: code1code2]
       * If not: [I: code1code2]
