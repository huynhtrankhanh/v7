from v7 import Syllable, CompleteSyllableTemplate, PartialSyllableTemplate, predict, load_model, tokenizer
import os

def parse_v7_string(s: str) -> list[PartialSyllableTemplate]:
    templates = []
    i = 0
    n = len(s)

    start_idx = 0
    while i < n:
        if s[i].isdigit():
            tone = int(s[i])
            if i - 1 < start_idx:
                raise ValueError(f"Invalid format at index {i}: Missing rhyme char")

            rhyme_start = s[i-1]
            consonant = s[start_idx : i-1]

            if consonant == 'dd':
                consonant = 'đ'

            templates.append(PartialSyllableTemplate(
                consonant=consonant,
                rhyme_first_letter=rhyme_start,
                tone=tone
            ))

            start_idx = i + 1
        i += 1

    return templates

def main():
    # Load model
    model_path = "checkpoints/v7gpt-1.3.pth"
    if not os.path.exists(model_path):
        print(f"Warning: {model_path} not found. Using checkpoints/dummy.pth")
        model_path = "checkpoints/dummy.pth"

    try:
        model = load_model(model_path)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    input_str = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7"
    templates = parse_v7_string(input_str)

    # Target words to guide selection
    target_words = ["nay", "trời", "đẹp", "lắm", "nhưng", "mà", "khi", "trời", "mưa", "thì", "nó", "rất", "mệt"]

    context = []
    current_idx = 0

    output_file = "REFINE_CANDIDATES.md"

    with open(output_file, "w", encoding="utf-8") as f:
        f.write("# Refine Candidates Process\n\n")
        f.write(f"Input String: `{input_str}`\n")
        f.write(f"Target Sentence (Guide): `{' '.join(target_words)}`\n\n")

        while current_idx < len(templates):
            # Process 2 templates at a time
            chunk_size = 2

            # Handle leftover
            remaining = len(templates) - current_idx
            if remaining < chunk_size:
                chunk_size = remaining

            chunk_templates = templates[current_idx : current_idx + chunk_size]

            step_num = (current_idx // 2) + 1
            f.write(f"## Step {step_num}\n\n")

            # Describe input for this step
            chunk_desc = []
            for t in chunk_templates:
                chunk_desc.append(f"{t.consonant}{t.rhyme_first_letter}{t.tone}")
            f.write(f"**Input Templates**: `{' '.join(chunk_desc)}`\n\n")

            if context:
                context_str = ' '.join([s.to_str() for s in context])
                f.write(f"**Current Context**: `{context_str}`\n\n")
            else:
                f.write("**Current Context**: `(Empty)`\n\n")

            print(f"Step {step_num}: Predicting for {chunk_desc}...")

            # Predict
            # Increase beam width to find better candidates
            candidates = predict(context, chunk_templates, model, beam_width=200, num_candidates=7)

            f.write("**Candidates**:\n")

            selected_candidate = None
            selected_idx = -1

            # Logic to pick the best candidate
            target_chunk = target_words[current_idx : current_idx + len(chunk_templates)]
            target_chunk_str = ' '.join(target_chunk)

            print(f"  Target: {target_chunk_str}")

            for idx, cand in enumerate(candidates):
                cand_str = ' '.join([s.to_str() for s in cand])
                f.write(f"{idx+1}. {cand_str}\n")

                # Check if this candidate matches target
                match = True
                if len(cand) != len(target_chunk):
                    match = False
                else:
                    for i, w in enumerate(cand):
                        if w.to_str().lower() != target_chunk[i].lower():
                            match = False
                            break

                if match and selected_candidate is None:
                    selected_candidate = cand
                    selected_idx = idx + 1

            # If no exact match found, pick the first one
            if selected_candidate is None:
                if candidates:
                    selected_candidate = candidates[0]
                    selected_idx = 1
                    print(f"  No exact match found. Defaulting to candidate 1.")
                else:
                    f.write("\nNo candidates found.\n")
                    print("  No candidates found!")
                    break
            else:
                print(f"  Matched candidate {selected_idx}")

            f.write(f"\n**Selected Candidate**: {selected_idx} (`{' '.join([s.to_str() for s in selected_candidate])}`)\n\n")

            # Update context
            context.extend(selected_candidate)
            current_idx += len(chunk_templates)

        # Final result
        full_sentence = ' '.join([s.to_str() for s in context])
        f.write("# Final Result\n\n")
        f.write(f"`{full_sentence}`\n")
        print(f"\nFinal Sentence: {full_sentence}")

if __name__ == "__main__":
    main()
