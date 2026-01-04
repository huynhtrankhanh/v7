* You are to produce a stripped version of v7

* It acts as a library. The primary interface is this

  ```
  predict(context: Syllables[], template: SyllableTemplate[]) -> Syllables[]
  ```

* Only LLM inference is supported. The dictionary based inference code must be deleted.

* All UI code must be deleted. All keyboard capture code must be deleted.
