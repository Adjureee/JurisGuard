"""Synthetic timing protocol test, without loading OCR models."""

import tempfile
import unittest
from pathlib import Path

from src.ocr_pipeline import OCRResult
from src.ocr_timing import run_timing


class FakeEngine:
    def __init__(self):
        self.calls = []

    def extract(self, image):
        self.calls.append(image.name)
        return OCRResult(f"synthetic {image.stem}", (), "fake")


class OCRTimingTests(unittest.TestCase):
    def test_first_image_warmup_is_separate_and_text_is_not_scored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images, saved = root / "images", root / "saved"
            images.mkdir()
            saved.mkdir()
            for number in (1, 2):
                (images / f"{number}.png").write_bytes(b"synthetic placeholder")
                (saved / f"{number}.txt").write_text(f"synthetic {number}", encoding="utf-8")
            engine = FakeEngine()
            result = run_timing(images, "paddleocr", expected_count=2, saved_text_dir=saved, engine=engine)
            self.assertEqual(engine.calls, ["1.png", "1.png", "2.png"])
            self.assertEqual(result["sample_count"], 2)
            self.assertEqual(result["saved_text_exact_matches"], 2)
            self.assertIsNone(result["ocr_cer"])
            self.assertIsNone(result["ocr_wer"])


if __name__ == "__main__":
    unittest.main()
