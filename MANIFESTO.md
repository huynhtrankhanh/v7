* You are to produce a stripped version of v7

* It acts as a library. The primary interface is this

  ```
  predict(context: Syllables[], template: SyllableTemplate[]) -> Syllables[]
  ```

* Only LLM inference is supported. The dictionary based inference code must be deleted.

* All UI code must be deleted. All keyboard capture code must be deleted.

* A Syllable is a data structure that definitively defines a Vietnamese syllable.

* A SyllableTemplate defines the general schema of acceptable syllables, and the LLM is constrained to generate an array of Syllables that matches the list of SyllableTemplates.

* The code currently uses a very greedy decoding strategy. You are to change the decoding logic to use beam search instead to find the most suitable string. Despite doing a more comprehensive search, the search must still be fast enough since it's run whenever the user inputs something.

* Document your design decisions.

* You have to download the AI model because it's not included in the repo. But at the same time, you are not allowed to commit the downloaded AI model to the repository as Git can't track very large files.

* Include a demo that calls the library to produce a coherent Vietnamese sentence from a list of SyllableTemplates.
