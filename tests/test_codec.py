import sys
import os
import json
import pytest
from hypothesis import given, strategies as st, settings, Verbosity

sys.path.append(os.getcwd())
try:
    codec = __import__("3letter_codec")
    encode = codec.encode
    decode = codec.decode
    load_data = codec.load_data
    load_data()
    SYLLABLE_TO_CRT = codec._SYLLABLE_TO_CRT
    VALID_SYLLABLES = list(SYLLABLE_TO_CRT.keys())
except ImportError:
    pass

@pytest.fixture(scope="module", autouse=True)
def setup_codec():
    load_data()

@st.composite
def valid_syllables_strategy(draw):
    return draw(st.sampled_from(VALID_SYLLABLES))

@st.composite
def valid_codes_strategy(draw):
    syllable = draw(st.sampled_from(VALID_SYLLABLES))
    return encode(syllable)

class TestCodec:

    @given(valid_syllables_strategy())
    @settings(max_examples=1000, deadline=None)
    def test_encode_decode_roundtrip(self, syllable):
        """
        Test that decode(encode(x)) == x for all valid syllables.
        """
        encoded = encode(syllable)
        assert len(encoded) == 3
        decoded = decode(encoded)
        assert decoded == syllable

    @given(valid_codes_strategy())
    @settings(max_examples=1000, deadline=None)
    def test_decode_encode_roundtrip(self, code):
        """
        Test that encode(decode(c)) == c for all valid codes.
        """
        decoded = decode(code)
        re_encoded = encode(decoded)
        assert re_encoded == code

    def test_specific_examples(self):
        syl = "nghiêng"
        encoded = encode(syl)
        # Check against scheme: W (ng) + 5 (Group) + I (3rd rhyme, tone 0)
        # Note: Previous run said W5I.
        assert encoded == "W5I"
        assert decode(encoded) == syl

        syl2 = "thy"
        encoded2 = encode(syl2)
        # thy -> th(A) + y(Group?) + Tone 0
        # y is the LAST rhyme. Group 26? (Key Q)
        # In Group 26: 'y' is 1st rhyme? Group 26: ['y'] + others?
        # Let's check grouping logic in hypothesis or run.
        assert decode(encoded2) == syl2

    def test_invalid_input(self):
        with pytest.raises(ValueError):
            encode("invalid_syllable_xyz")

        with pytest.raises(ValueError):
            decode("INVALID")

        with pytest.raises(ValueError):
            decode("$$$")

if __name__ == "__main__":
    sys.exit(pytest.main(["-v", __file__]))
