import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from src.real_document_evaluation import score
from src.schema import empty_inventory


class RealDocumentEvaluationTests(unittest.TestCase):
    def test_scores_fields_and_ocr_without_source_text_in_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "E01.png").write_bytes(b"placeholder")
            truth = empty_inventory()
            truth["Party Represented"] = "Person One"
            truth["Gender/Sex"] = "Female"
            actual = empty_inventory()
            actual["Party Represented"] = "Person One"
            actual["Gender/Sex"] = "Male"
            actual["Address"] = "Extra"
            (root / "ref.json").write_text(json.dumps({"reference_text": "hello world", "inventory": truth}))
            (root / "pred.json").write_text(json.dumps({"raw_text": "hello word", "inventory": actual}))
            manifest = {"dataset_origin": "real_deidentified", "samples": [{"sample_id": "E01", "kind": "pao_english", "scenarios": ["poor_scan"], "image": "E01.png", "image_sha256": hashlib.sha256(b"placeholder").hexdigest(), "reference": "ref.json", "prediction": "pred.json", "reviewed_against_image": True, "deidentified_confirmed": True}]}
            path = root / "manifest.json"
            path.write_text(json.dumps(manifest))
            result = score(path)
            self.assertEqual(result["sample_count"], 1)
            self.assertEqual(result["field_precision"], 1 / 3)
            self.assertEqual(result["field_recall"], 1 / 2)
            self.assertEqual(result["by_field"]["Party Represented"]["precision"], 1)
            self.assertEqual(result["by_field"]["Gender/Sex"]["recall"], 0)
            self.assertEqual(result["by_field"]["Address"]["precision"], 0)
            self.assertEqual(result["by_field"]["Contact Number"]["precision"], None)
            self.assertEqual(result["field_exact_match_accuracy"], 19 / 21)
            self.assertIn("rtc_decision", result["missing_kinds"])
            self.assertIn("readable_handwriting", result["missing_scenarios"])
            self.assertGreater(result["micro_cer"], 0)
            self.assertNotIn("Person One", json.dumps(result))
            manifest["samples"][0]["reviewed_against_image"] = False
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "Independent annotation"):
                score(path)
