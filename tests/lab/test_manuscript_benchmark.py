"""Synthetic protocol checks; these are not estimates of real-world accuracy."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config import LAB_ROOT
from src.manuscript_benchmark import load_manifest, run_nlp, run_ocr
from src.ocr_pipeline import OCRResult


MANIFEST = LAB_ROOT / "data/synthetic/synthetic_benchmark.json"


class _ReferenceEngine:
    def extract(self, _image: Path) -> OCRResult:
        text = (LAB_ROOT / "data/synthetic/synthetic_intake.txt").read_text(encoding="utf-8").strip()
        return OCRResult(text, (), "reference-test-engine")


class _ReferenceNLP:
    def extract(self, _text: str) -> dict:
        return {"Party Represented": "Ana Reyes", "Address": "12 Mabini Street", "Court/Body": None}


class ManuscriptBenchmarkTests(unittest.TestCase):
    def test_synthetic_manifest_is_not_thirty_real_samples(self):
        with self.assertRaisesRegex(ValueError, "30 real samples"):
            load_manifest(MANIFEST, mode="ocr", require_30=True)
        with self.assertRaisesRegex(ValueError, "20 real samples"):
            load_manifest(MANIFEST, mode="ocr", expected_samples=20)

    def test_ocr_reports_metrics_and_saves_private_text_only_when_requested(self):
        with tempfile.TemporaryDirectory() as directory, patch("src.manuscript_benchmark.make_engine", return_value=_ReferenceEngine()):
            text_dir = Path(directory)
            report = run_ocr(MANIFEST, "tesseract", ocr_text_dir=text_dir)
            self.assertEqual(report["dataset_origin"], "synthetic")
            self.assertEqual(report["overall"]["mean_cer_percent"], 0)
            self.assertEqual(report["groups"]["clean"]["samples"], 1)
            self.assertEqual(report["groups"]["mobile"]["samples"], 0)
            self.assertTrue((text_dir / "synthetic-intake-001.txt").is_file())
            self.assertNotIn("Ana Reyes", json.dumps(report))

    def test_nlp_uses_saved_text_and_only_declared_target_fields(self):
        with patch("src.manuscript_benchmark.make_nlp_candidate", return_value=_ReferenceNLP()):
            report = run_nlp(MANIFEST, "spacy_regex")
        self.assertEqual(report["target_fields"], ("Party Represented", "Address", "Court/Body"))
        self.assertEqual(report["overall"]["annotated_target_values"], 2)
        self.assertEqual(report["overall"]["non_null_target_accuracy_percent"], 100)
        self.assertEqual(report["samples"][0]["routed_document_type"], "intake_form")
        self.assertNotIn("09170001234", json.dumps(report))

    def test_duplicate_sample_ids_are_rejected(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        data["samples"][0]["ground_truth"] = str(LAB_ROOT / "data/synthetic/synthetic_intake.json")
        data["samples"][0]["image"] = str(LAB_ROOT / "data/synthetic/synthetic_intake.png")
        data["samples"].append(dict(data["samples"][0]))
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "manifest.json"
            manifest.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate sample_id"):
                load_manifest(manifest, mode="ocr")


if __name__ == "__main__":
    unittest.main()
