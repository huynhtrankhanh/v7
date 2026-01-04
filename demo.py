from v7 import Syllable, SyllableTemplate, predict, load_model, tokenizer

def main():
    # Load model
    # Ensure checkpoints/v7gpt-1.3.pth exists
    try:
        model = load_model("checkpoints/v7gpt-1.3.pth")
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # Define Context: "xin"
    # We need to find the Syllable for "xin".
    # Assuming we know the CRT. xin: c='x', r='in', t=0.
    context_syl = Syllable(consonant='x', rhyme='in', tone=0)
    context = [context_syl]

    print(f"Context: {context}")

    # Define Template: Looking for "chào" -> c='ch', r='ao', t=2
    # But let's make it a bit more flexible to test beam search.
    # Say we want something starting with 'ch', any rhyme, tone 2.
    # Or just exact match for now to verify.
    template1 = SyllableTemplate(consonant='ch', rhyme='ao', tone=2) # chào

    # Let's try to predict "xin chào các bạn"
    # Context: xin
    # Template: [chào, các, bạn]

    templates = [
        SyllableTemplate(consonant='ch', rhyme='ao', tone=2), # chào
        SyllableTemplate(consonant='c', rhyme='ac', tone=6),  # các
        SyllableTemplate(consonant='b', rhyme='an', tone=5)   # bạn
    ]

    print("Predicting...")
    results = predict(context, templates, model, beam_width=5)

    print("Results:")
    for syl in results:
        print(syl)

    # Reconstruct sentence
    # We need to find the words again.
    # predict returns Syllables.
    # To show the actual words, we might want to modify predict to return words or tokens too,
    # but the interface says Syllables[].
    # So we'll just print the Syllables.

    # Let's try another one with wildcards
    print("\nPredicting with wildcards...")
    # Context: "hôm" (h, ôm, 0)
    context2 = [Syllable(consonant='h', rhyme='ôm', tone=0)]

    # Template: "nay" (n, ay, 0), "trời" (tr, ơi, 2), "đẹp" (đ, ep, 7)
    # Let's use wildcard for rhyme of "nay" -> n, None, 0

    templates2 = [
        SyllableTemplate(consonant='n', rhyme=None, tone=0),
        SyllableTemplate(consonant='tr', rhyme='ơi', tone=2),
        SyllableTemplate(consonant='đ', rhyme='ep', tone=7)
    ]

    results2 = predict(context2, templates2, model, beam_width=5)
    for syl in results2:
        print(syl)

if __name__ == "__main__":
    main()
