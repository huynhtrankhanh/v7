import json
import os

# Consonants (24)
CONSONANT_MAP = {
    '0': '0', 'b': 'B', 'ch': 'C', 'd': 'D', 'đ': 'E',
    'g': 'G', 'h': 'H', 'k': 'K', 'kh': 'Q', 'l': 'L',
    'm': 'M', 'n': 'N', 'ng': 'W', 'nh': 'J', 'p': 'P',
    'ph': 'F', 'r': 'R', 's': 'S', 't': 'T', 'th': 'A',
    'tr': 'Y', 'v': 'V', 'x': 'X', 'z': 'Z'
}
REVERSE_CONSONANT_MAP = {v: k for k, v in CONSONANT_MAP.items()}

# Rhymes (106) - 'y' added for disambiguation
# Sorted Alphabetically (Unicode)
RHYMES = [
    'a', 'ai', 'am', 'an', 'ang', 'anh', 'ao', 'au', 'ay',
    'e', 'em', 'en', 'eng', 'eo',
    'i', 'ia', 'im', 'in', 'inh', 'iu', 'iêm', 'iên', 'iêng', 'iêu',
    'o', 'oa', 'oai', 'oam', 'oan', 'oang', 'oanh', 'oao', 'oau', 'oay',
    'oe', 'oen', 'oeo', 'oi', 'om', 'on', 'ong', 'oong', 'oăm', 'oăn', 'oăng',
    'u', 'ua', 'ui', 'um', 'un', 'ung', 'uy', 'uya', 'uym', 'uyn', 'uynh', 'uyu',
    'uyên', 'uân', 'uâng', 'uây', 'uê', 'uên', 'uênh', 'uôi', 'uôm', 'uôn', 'uông', 'uơ', 'uơi', 'uơn',
    'y',
    'âm', 'ân', 'âng', 'âu', 'ây',
    'ê', 'êm', 'ên', 'ênh', 'êu',
    'ô', 'ôi', 'ôm', 'ôn', 'ông',
    'ăm', 'ăn', 'ăng',
    'ơ', 'ơi', 'ơm', 'ơn',
    'ư', 'ưa', 'ưi', 'ưm', 'ưn', 'ưng', 'ưu', 'ươi', 'ươm', 'ươn', 'ương', 'ươu'
]
RHYMES.sort() # Ensure sorted
RHYME_TO_INDEX = {r: i for i, r in enumerate(RHYMES)}

# Keys for indexing (0-9, A-Z)
KEYS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
KEY_TO_INT = {k: i for i, k in enumerate(KEYS)}

# Tone Keys Mapping (No math)
# Rhyme Pos 0: 0-7
RANGE_0 = "01234567"
# Rhyme Pos 1: A-H
RANGE_1 = "ABCDEFGH"
# Rhyme Pos 2: I-P
RANGE_2 = "IJKLMNOP"
# Rhyme Pos 3: Q-X
RANGE_3 = "QRSTUVWX"

RANGE_MAPS = [RANGE_0, RANGE_1, RANGE_2, RANGE_3]

# Data cache
_SYLLABLE_TO_CRT = None
_CRT_TO_SYLLABLE = None

def load_data():
    global _SYLLABLE_TO_CRT, _CRT_TO_SYLLABLE
    if _SYLLABLE_TO_CRT is not None:
        return

    base_dir = os.path.dirname(os.path.abspath(__file__))
    renum_path = os.path.join(base_dir, 'checkpoints', 'renum.json')
    crt_path = os.path.join(base_dir, 'checkpoints', 'renum_crt.json')

    if not os.path.exists(renum_path):
        renum_path = 'checkpoints/renum.json'
        crt_path = 'checkpoints/renum_crt.json'

    if not os.path.exists(renum_path):
        raise FileNotFoundError("Could not find checkpoints/renum.json. Please ensure data files are present.")

    with open(renum_path, 'r', encoding='utf-8') as f:
        renum = json.load(f)

    with open(crt_path, 'r', encoding='utf-8') as f:
        crt = json.load(f)

    _SYLLABLE_TO_CRT = {}
    _CRT_TO_SYLLABLE = {}

    for i in range(1, len(renum)):
        syllable = renum[i]
        c, r, t = crt[i]

        # Patch for 'y' rhyme
        # Use simple suffix check for 'y', 'ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ'
        # And ensure it's not preceded by vowels (making it part of a diphthong like 'ay', 'uy', 'ây')
        # Vowels to exclude before y: a, u, â
        # Note: 'uy' is a rhyme. 'ay' is a rhyme. 'ây' is a rhyme.
        # 'oy'? Not a standard rhyme?
        # 'ey'? No.
        # 'iy'? No.

        # Check if last char is a 'y' variant
        last_char = syllable[-1]
        y_variants = "yýỳỷỹỵ"
        if last_char in y_variants:
            # Check preceding char if length > 1
            if len(syllable) > 1:
                pre = syllable[-2]
                # Exclude if preceding char is part of 'ay', 'uy', 'ây'
                # 'a', 'u', 'â' are the main ones.
                # Actually, check known rhyme endings from the full list?
                # Faster: just check standard diphthong starters.
                if pre not in ['a', 'u', 'â']:
                    # Likely pure 'y' rhyme (e.g. 'thy', 'ty', 'my')
                    if r == 'i':
                         r = 'y'
            else:
                # Syllable is just "y" or "ý"...
                if r == 'i':
                    r = 'y'

        # Store with potentially patched rhyme
        _SYLLABLE_TO_CRT[syllable] = (c, r, t)

        key = (c, r, t)

        # If collision exists (e.g. multiple syllables map to same CRT),
        # we generally keep the first one.
        # However, if we just patched 'ký' to rhyme 'y', it will be (k, y, 1).
        # 'kí' stays (k, i, 1).
        # So they are distinct now.

        if key not in _CRT_TO_SYLLABLE:
             _CRT_TO_SYLLABLE[key] = syllable
        # else: collision handling if any.

def encode(syllable: str) -> str:
    load_data()
    if syllable not in _SYLLABLE_TO_CRT:
        raise ValueError(f"Invalid syllable: {syllable}")

    c, r, t = _SYLLABLE_TO_CRT[syllable]

    if c not in CONSONANT_MAP:
        raise ValueError(f"Unknown consonant: {c}")
    char1 = CONSONANT_MAP[c]

    if r not in RHYME_TO_INDEX:
        raise ValueError(f"Unknown rhyme: {r}")

    r_idx = RHYME_TO_INDEX[r]

    group_idx = r_idx // 4
    sub_r = r_idx % 4

    if group_idx >= len(KEYS):
         raise ValueError("Rhyme group index out of bounds")
    char2 = KEYS[group_idx]

    if not (0 <= t <= 7):
        raise ValueError(f"Tone out of bounds: {t}")

    char3 = RANGE_MAPS[sub_r][t]

    return char1 + char2 + char3

def decode(code: str) -> str:
    load_data()
    if len(code) != 3:
        raise ValueError("Code must be 3 characters long")

    c_char, group_char, tone_char = code[0], code[1], code[2]

    if c_char not in REVERSE_CONSONANT_MAP:
        raise ValueError(f"Invalid consonant: {c_char}")
    c = REVERSE_CONSONANT_MAP[c_char]

    if group_char not in KEY_TO_INT:
        raise ValueError(f"Invalid group char: {group_char}")
    group_idx = KEY_TO_INT[group_char]

    # Find sub_r and tone from tone_char
    sub_r = -1
    tone = -1

    for i, rng in enumerate(RANGE_MAPS):
        if tone_char in rng:
            sub_r = i
            tone = rng.index(tone_char)
            break

    if sub_r == -1:
        raise ValueError(f"Invalid tone char: {tone_char}")

    r_idx = group_idx * 4 + sub_r
    if r_idx >= len(RHYMES):
         raise ValueError(f"Decoded rhyme index out of bounds: {r_idx}")

    r = RHYMES[r_idx]

    key = (c, r, tone)

    if key not in _CRT_TO_SYLLABLE:
        raise ValueError(f"Decoded combination {key} not found")

    return _CRT_TO_SYLLABLE[key]

if __name__ == "__main__":
    try:
        load_data()
        test_syl = "nghiêng"
        encoded = encode(test_syl)
        decoded = decode(encoded)
        print(f"Original: {test_syl}")
        print(f"Encoded: {encoded}")
        print(f"Decoded: {decoded}")

        # Test collision fix
        s2 = "thy"
        e2 = encode(s2)
        d2 = decode(e2)
        print(f"Original: {s2}")
        print(f"Encoded: {e2}")
        print(f"Decoded: {d2}")

    except Exception as e:
        print(f"Error: {e}")
