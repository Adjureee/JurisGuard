"""Synthetic end-to-end orchestration and evaluation tests."""

import shutil
import unittest
from pathlib import Path

from config import DEFAULT_TESSERACT, LAB_ROOT
from src.document_router import DocumentRouter
from src.evaluate import compare, load_ground_truth, ocr_metrics
from src.ocr_pipeline import OCRLine, OCRResult, run_image


SYNTHETIC = LAB_ROOT / "data/synthetic"


class _FakeEngine:
    def extract(self, image_path):
        raw = (SYNTHETIC / "synthetic_intake.txt").read_text(encoding="utf-8").strip()
        lines = tuple(OCRLine(i, text, (0, i * 20, 100, i * 20 + 10)) for i, text in enumerate(raw.splitlines(), 1))
        return OCRResult(raw, lines, "fake-test-engine")


class PipelineTests(unittest.TestCase):
    def test_image_to_inventory_and_ground_truth_with_fake_ocr(self):
        ocr, result = run_image(SYNTHETIC / "synthetic_intake.png", engine=_FakeEngine())
        report = compare(result, load_ground_truth(SYNTHETIC / "synthetic_intake.json"), ocr.raw_text)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")
        self.assertTrue(report["classification"]["match"])
        self.assertEqual(report["field_exact_match_rate"], 1.0)
        self.assertEqual(report["ocr"]["cer"], 0.0)
        self.assertEqual(report["sample_origin"], "synthetic")

    @unittest.skipUnless(Path(DEFAULT_TESSERACT).is_file() or shutil.which(DEFAULT_TESSERACT), "local Tesseract unavailable")
    def test_installed_tesseract_synthetic_image(self):
        ocr, result = run_image(SYNTHETIC / "synthetic_intake.png")
        self.assertEqual(ocr.engine, "tesseract")
        self.assertTrue(ocr.lines)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")

    def test_evaluation_distinguishes_error_categories(self):
        truth = load_ground_truth(SYNTHETIC / "synthetic_intake.json")
        result = DocumentRouter().process((SYNTHETIC / "synthetic_intake.txt").read_text(encoding="utf-8"))
        result["inventory"]["Contact Number"] = None
        result["inventory"]["Urban"] = True
        report = compare(result, truth)
        self.assertEqual(report["fields"]["Contact Number"]["status"], "missing_extraction")
        self.assertEqual(report["fields"]["Urban"]["status"], "unsupported_extraction")
        self.assertIsNone(report["ocr"])
        self.assertGreater(ocr_metrics("abc", "axc")["cer"], 0)

    def test_invalid_ground_truth_is_rejected(self):
        truth = load_ground_truth(SYNTHETIC / "synthetic_intake.json")
        truth["inventory"]["Extra"] = "no"
        with self.assertRaises(ValueError):
            compare(DocumentRouter().process(""), truth)


if __name__ == "__main__":
    unittest.main()
