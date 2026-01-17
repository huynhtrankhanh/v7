**Text prediction with KenLM:**

We now have a regex. We have a pipeline which takes in some constraints and produces a regex.

The task is from the regex, we predict the most meaningful Vietnamese text using KenLM.

To achieve this, first, train a language model with KenLM.

In the parent directory, there's the corpus-full.7z. You are free to extract it, install extra packages to analyze it. We're on Ubuntu.

Use the corpus to train a KenLM model, and put the model in the current project directory. After that, write inference code to generate the Vietnamese text that satisfies the regex.

**The regex generation pipeline is in demo.py. You are to create inference.py that reproduces this pipeline, and does the extra step of inferencing.**

**You also have to put the code you use to generate the language model in the project directory.**

**You have to document your work.**
