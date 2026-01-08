import modal
import sys
import os

# Define the image with necessary dependencies
image = modal.Image.debian_slim(python_version="3.10") \
    .pip_install(
        "vllm>=0.4.0",
        "outlines",
        "transformers",
        "torch",
        "accelerate"
    ) \
    .add_local_dir("ai", remote_path="/root/ai") \
    .add_local_dir("utils", remote_path="/root/utils") \
    .add_local_dir("checkpoints", remote_path="/root/checkpoints") \
    .add_local_file("v7.py", remote_path="/root/v7.py") \
    .add_local_file("demo.py", remote_path="/root/demo.py")

app = modal.App("constrained-decoding-jules")

@app.function(image=image, gpu="A10G", timeout=600, secrets=[modal.Secret.from_name("huggingface-secret")])
def generate_constrained_text():
    import sys
    sys.path.append("/root")
    from demo import parse_v7_string
    import outlines
    import torch
    import os

    # Ensure HF_TOKEN is available
    if "HF_TOKEN" not in os.environ:
        print("Warning: HF_TOKEN not set. Make sure 'huggingface-secret' is attached.")

    # 1. Generate Regex
    v7_input = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7"
    print(f"Input v7 string: {v7_input}")

    try:
        templates = parse_v7_string(v7_input)
    except Exception as e:
        print(f"Error parsing v7 string: {e}")
        return

    regexes = [t.get_regex() for t in templates]
    # Allow flexible spacing
    full_regex = r"\s+".join(regexes)

    # Debug: Print regex start
    print(f"Generated Regex Constraint (length {len(full_regex)})")

    # 2. Initialize Model via Outlines (Transformers)
    model_name = "Qwen/Qwen2-7B-Instruct"
    print(f"Loading model: {model_name}")

    try:
        from outlines.backends import get_regex_logits_processor, REGEX_DEFAULT_BACKEND
        from outlines.models import Transformers
        from transformers import AutoModelForCausalLM, AutoTokenizer, LogitsProcessorList

        # Load HuggingFace Model
        hf_model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        tokenizer = AutoTokenizer.from_pretrained(model_name)

        # Create outlines wrapper
        model = Transformers(hf_model, tokenizer)

        prompt = "Dựa trên cấu trúc ngữ âm, câu đầy đủ và có ý nghĩa nhất là: "
        input_ids = tokenizer.encode(prompt, return_tensors="pt").to(hf_model.device)
        attention_mask = torch.ones_like(input_ids).to(hf_model.device)

        class DelayedLogitsProcessor:
            def __init__(self, prompt_length, processor, tokenizer):
                self.prompt_length = prompt_length
                self.processor = processor
                self.tokenizer = tokenizer

            def __call__(self, input_ids, scores):
                # Only pass the generated portion to outlines processor
                generated_ids = input_ids[:, self.prompt_length:]

                # Check for EOS/PAD tokens in the generated part to avoid crashing outlines
                # If a sequence already has EOS, we shouldn't enforce regex on subsequent PADs
                # But logits processor is for the *next* token.

                # If the last token was EOS, we probably don't care about scores anymore
                # (HF generation usually handles this, but processor is called anyway).

                # We simply wrap the call in try-except to be robust against "No next state found"
                # which usually happens if beam search explores a path that outlines considers invalid
                # (maybe due to EOS/PAD or beam expansion issues).

                try:
                    return self.processor(generated_ids, scores)
                except ValueError as e:
                    # If outlines fails to find next state, it means the sequence prefix is invalid according to regex.
                    # We should mask everything to kill this beam?
                    # Or just return scores as is (let it finish if it wants)?
                    # Returning -inf is safer to kill the beam.
                    print(f"Outlines invalid state for beam: {e}")
                    # Mask all
                    scores[:] = -float("inf")
                    return scores

        prompt_length = input_ids.shape[1]

        # Create outlines processor
        logits_processor_inner = get_regex_logits_processor(REGEX_DEFAULT_BACKEND, model, full_regex)

        delayed_processor = DelayedLogitsProcessor(prompt_length, logits_processor_inner, tokenizer)

        print("Generating with HF generate + Delayed Outlines LogitsProcessor (Beam Search)...")

        outputs = hf_model.generate(
            input_ids,
            attention_mask=attention_mask,
            max_new_tokens=200,
            logits_processor=LogitsProcessorList([delayed_processor]),
            num_beams=5,
            early_stopping=True,
            pad_token_id=tokenizer.eos_token_id
        )

        for i, output in enumerate(outputs):
            result = tokenizer.decode(output[prompt_length:], skip_special_tokens=True)
            print(f"\nFinal Result {i+1}:\n{prompt}{result}")

    except Exception as e:
        print(f"Error during generation setup: {e}")
        import traceback
        traceback.print_exc()

@app.local_entrypoint()
def main():
    generate_constrained_text.remote()
