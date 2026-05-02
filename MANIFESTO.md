# Create training data for V7 fine tuning

1. We are to create a JSONL dataset to fulfill JSON inference requests. The JSONL dataset will be uploaded to the OpenAI finetuning interface, so it must be compliant to the OpenAI format. The starting prompt, so that the LLM knows the task to be performed, is "Perform the following v7 inference request: ". Then, the JSON inference request follows.
2. The JSON inference request format is clearly specified in the inference-rs CLI API. The CLI has a JSON interface, you are to follow the exact JSON schema.
3. The dataset has to be diverse. As you are an AI agent, you can generate Vietnamese sentences yourself. Make sure there are at least 1000 samples. Maximize the coverage rate for **possible v7 codes** and **possible inferenceable syllables**. Write a tracking script that tracks these metrics so you can maximize them.
4. An inference request consists of fixed text islands and v7 islands. A v7 island can never be empty, but fixed text islands can be empty. Please generate the dataset in a way that is diverse enough so the model can handle empty islands.
5. v7 islands can only result in lowercase Vietnamese text. So if the syllable has uppercase characters, it must be a fixed text island. Example: ["Ta ", "pha3ddi0dda1za7"], ["Nó ", "ku1lu3thu3mo7mi2", ", ", "kho0chi5za0ti6vo10a0"]

**Go ahead and generate that dataset! Thank you! Commit the dataset and auxiliary scripts to the repository.**

# Helpful resources for you
getInference.ts already does most of the steps. You just need to use it, then reformat to fit the OpenAI fine tuning format.

To mass generate Vietnamese text, use Gemini Flash. An API key will be provided.

The dataset doesn't have to just consist of sentences. Paragraphs are ok too!
