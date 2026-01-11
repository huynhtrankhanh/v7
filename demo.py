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
            # The character before the tone is the rhyme start
            if i - 1 < start_idx:
                raise ValueError(f"Invalid format at index {i}: Missing rhyme char")

            rhyme_start = s[i-1]

            # Consonant is everything from start_idx to i-1
            consonant = s[start_idx : i-1]

            # Special handling
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
        print("Please ensure 'checkpoints/v7gpt-1.3.pth' exists.")
        return

    input_str = "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7"
    print(f"Parsing input string: {input_str}")

    templates = parse_v7_string(input_str)

    print(f"Parsed {len(templates)} templates:")
    for idx, t in enumerate(templates):
        print(f"  {idx+1}: C='{t.consonant}', R_start='{t.rhyme_first_letter}', T={t.tone}")

    # No initial context provided, assuming start of sentence
    context = []

    print(f"\nGenerating 7 candidates...")
    candidates = predict(context, templates, model, beam_width=50, num_candidates=7)

    output_file = "CANDIDATES.md"
    print(f"\nWriting results to {output_file}")

    with open(output_file, "w", encoding="utf-8") as f:
        f.write("# Generated Candidates\n\n")
        f.write(f"Input: `{input_str}`\n\n")

        if not candidates:
            f.write("No matching sequence found.\n")
            print("No matching sequence found.")
        else:
            for idx, results in enumerate(candidates):
                sentence_str = ' '.join([s.to_str() for s in results])
                f.write(f"{idx+1}. {sentence_str}\n")
                print(f"Candidate {idx+1}: {sentence_str}")

if __name__ == "__main__":
    main()
