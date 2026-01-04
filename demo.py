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
    # Tokenizer: xin: ['x', 'in', 0]
    context_syl = Syllable(consonant='x', rhyme='in', tone=0)
    context = [context_syl]

    print(f"Context: {context}")

    # Let's try to predict "xin chào các bạn"
    # Tokenizer values:
    # chào: ['ch', 'ao', 2]
    # các: ['k', 'ang', 6]
    # bạn: ['b', 'an', 5]

    templates = [
        SyllableTemplate(consonant='ch', rhyme='ao', tone=2), # chào
        SyllableTemplate(consonant='k', rhyme='ang', tone=6), # các (internal: k, ang, 6)
        SyllableTemplate(consonant='b', rhyme='an', tone=5)   # bạn
    ]

    print("Predicting 'xin chào các bạn'...")
    results = predict(context, templates, model, beam_width=5)

    print("Results:")
    for syl in results:
        print(syl)


    # Let's try another one with wildcards
    print("\nPredicting 'hôm nay trời đẹp' with wildcards...")
    # Context: "hôm"
    # Tokenizer: hôm: ['h', 'ôm', 0]
    context2 = [Syllable(consonant='h', rhyme='ôm', tone=0)]

    # Template: "nay" (n, ay, 0), "trời" (tr, ơi, 2), "đẹp" (đ, em, 7)
    # Tokenizer values:
    # nay: ['n', 'ay', 0]
    # trời: ['tr', 'ơi', 2]
    # đẹp: ['đ', 'em', 7]

    # Use wildcard for rhyme of "nay" -> n, None, 0

    templates2 = [
        SyllableTemplate(consonant='n', rhyme=None, tone=0),   # nay
        SyllableTemplate(consonant='tr', rhyme='ơi', tone=2), # trời
        SyllableTemplate(consonant='đ', rhyme='em', tone=7)    # đẹp (internal: đ, em, 7)
    ]

    results2 = predict(context2, templates2, model, beam_width=5)
    for syl in results2:
        print(syl)

if __name__ == "__main__":
    main()
