"""Unlabeled OCR runs must not invent CER/WER or expose OCR text in summaries."""

import json
import tempfile
import unittest
from pathlib import Path

from src.ocr_pipeline import OCRResult
from src.scan_unlabeled import scan


SYNTHETIC_TEXT = "REPUBLIC OF THE PHILIPPINES\nSandiganbayan\nPEOPLE OF THE PHILIPPINES\n-versus-\nA SAMPLE ACCUSED\nCase No. SB-25-SCA-0007\nDECISION"


class _FakeOCR:
    def extract(self, _path: Path) -> OCRResult:
        return OCRResult(SYNTHETIC_TEXT, (), "fake")


class ScanUnlabeledTests(unittest.TestCase):
    def test_ocr_and_reuse_preserve_review_without_accuracy_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / "input"
            output = root / "output"
            images.mkdir()
            (images / "1.png").write_bytes(b"synthetic-test-placeholder")
            result = scan(images, "tesseract", output, expected_count=1, engine=_FakeOCR())
            self.assertEqual(result["document_type_counts"]["sandiganbayan_document"], 1)
            self.assertIsNone(result["accuracy"])
            self.assertNotIn("A SAMPLE ACCUSED", json.dumps(result))
            self.assertEqual((output / "1.txt").read_text(encoding="utf-8"), SYNTHETIC_TEXT)
            reused = scan(images, "tesseract", output, expected_count=1, reuse_ocr_text=True)
            self.assertEqual(reused["timing_scope"], "routing_only_from_saved_ocr")
            self.assertEqual(reused["document_type_counts"]["sandiganbayan_document"], 1)

    def test_reuse_requires_complete_transcripts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / "input"
            images.mkdir()
            (images / "1.png").write_bytes(b"synthetic-test-placeholder")
            with self.assertRaisesRegex(FileNotFoundError, "saved OCR text"):
                scan(images, "paddleocr", root / "output", reuse_ocr_text=True)


if __name__ == "__main__":
    unittest.main()
