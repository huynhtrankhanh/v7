from v7 import Syllable, CompleteSyllableTemplate, PartialSyllableTemplate, predict, load_model, tokenizer
import os

def main():
    # Load model
    # Ensure checkpoints/v7gpt-1.3.pth exists
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

    # Scenario: Predict "hôm nay trời đẹp" (Today the weather is beautiful)
    # Context: "hôm"
    # Templates for: "nay", "trời", "đẹp"

    # 1. Context: "hôm"
    # Tokenizer check: 'hôm' -> c='h', r='ôm', t=0
    context = [Syllable(consonant='h', rhyme='ôm', tone=0)]
    print(f"Context: {[s.to_str() for s in context]}")

    # 2. Define Templates
    templates = []

    # Word 1: "nay" -> target is (n, ay, 0)
    # Use Partial: consonant='n', rhyme starts with 'a', tone=0
    templates.append(PartialSyllableTemplate(
        consonant='n',
        rhyme_first_letter='a',
        tone=0
    ))

    # Word 2: "trời" -> target is (tr, ơi, 2)
    # Use Complete: must be exactly "trời"
    # 'trời' -> c='tr', r='ơi', t=2
    syl_troi = Syllable(consonant='tr', rhyme='ơi', tone=2)
    templates.append(CompleteSyllableTemplate(syllable=syl_troi))

    # Word 3: "đẹp" -> target is (đ, em, 7)
    # Use Partial: c='đ', rhyme_start='e', tone=7
    templates.append(PartialSyllableTemplate(
        consonant='đ',
        rhyme_first_letter='e',
        tone=7
    ))

    print("\nPredicting 'hôm nay trời đẹp' with mixed templates...")
    print("Template 1 (Partial): c='n', r_start='a', t=0")
    print("Template 2 (Complete): 'trời'")
    print("Template 3 (Partial): c='đ', r_start='e', t=7")

    # Predict
    results = predict(context, templates, model, beam_width=50)

    print("\nResults:")
    if not results:
        print("No matching sequence found.")
    else:
        for i, syl in enumerate(results):
            print(f"Word {i+1}: {syl.to_str()} (Internal: {syl})")

    # Construct full sentence
    full_sentence = [s.to_str() for s in context] + [s.to_str() for s in results]
    print(f"\nFull Sentence: {' '.join(full_sentence)}")

if __name__ == "__main__":
    main()
