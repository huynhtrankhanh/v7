**Text prediction with KenLM:**

We now have a regex. We have a pipeline which takes in some constraints and produces a regex.

The task is from the regex, we predict the most meaningful Vietnamese text using KenLM.

To achieve this, first, train a language model with KenLM.

In the parent directory,
