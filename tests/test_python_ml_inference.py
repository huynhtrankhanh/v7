import tempfile
import unittest
from pathlib import Path

from v7_python_model import TrainedV7Model, encode_word_to_v7, train_model


class DummyReranker:
    def score(self, left_text, candidate, right_text):
        if left_text.endswith(". ") and candidate.strip() == "Nay":
            return 20.0
        if left_text.endswith(", ") and candidate.strip() == "nay":
            return 20.0
        return 0.0


class PythonMlInferenceTests(unittest.TestCase):
    def test_encode_word_to_v7(self):
        self.assertEqual(encode_word_to_v7("trời"), "tr_o_2")
        self.assertEqual(encode_word_to_v7("đẹp"), "dd_e_7")
        self.assertEqual(encode_word_to_v7("Nay"), "n_a_0")

    def test_inference_uses_punctuation_and_capitalization_context(self):
        corpus = [
            "Tôi nói. Nay trời đẹp!",
            "tôi nói, nay trời đẹp.",
            "Tôi nhắc. Nay trời mưa.",
            "tôi nhắc, nay trời mưa.",
        ]
        model = train_model(corpus)
        reranker = DummyReranker()
        candidates = model.infer_islands(["Tôi nói. ", "na0tro2", " đẹp!"], beam_width=5, reranker=reranker)
        self.assertGreater(len(candidates), 0)
        self.assertEqual(candidates[0][1], "Nay trời")

    def test_model_round_trip_json(self):
        corpus = ["Tôi nói. Nay trời đẹp!", "tôi nói, nay trời đẹp."]
        model = train_model(corpus)
        with tempfile.TemporaryDirectory() as tmp:
            model_path = Path(tmp) / "model.json"
            model.to_json(str(model_path))
            loaded = TrainedV7Model.from_json(str(model_path))
            out = loaded.infer_islands(["Tôi nói. ", "na0", " trời đẹp!"], beam_width=3)
            self.assertTrue(out)
            self.assertEqual(len(out[0]), 3)


if __name__ == "__main__":
    unittest.main()
