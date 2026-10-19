"""Synthetic-only tests for private OCR annotation preparation and scoring."""

import tempfile
import unittest
import json
from pathlib import Path

from src.decision_ocr_reference import CANDIDATES, draft, evaluate, prepare


class DecisionOcrReferenceTests(unittest.TestCase):
    def test_prepare_preserves_annotations_and_evaluates_only_complete_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images, refs, output = root / "images", root / "refs", root / "ocr"
            images.mkdir()
            (images / "1.png").write_bytes(b"synthetic image placeholder")
            result = prepare(images, refs, expected_count=1)
            self.assertEqual(result["sample_count"], 1)
            with self.assertRaisesRegex(ValueError, "still empty"):
                evaluate(images, refs, output, root / "report.json")
            (refs / "1.txt").write_text("ABC DEF\n", encoding="utf-8")
            prepare(images, refs, expected_count=1)
            self.assertEqual((refs / "1.txt").read_text(encoding="utf-8"), "ABC DEF\n")
            with self.assertRaisesRegex(ValueError, "not been marked reviewed"):
                evaluate(images, refs, output, root / "report.json")
            manifest_path = refs / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["samples"][0]["reviewed_against_image"] = True
            manifest["samples"][0]["transcript_origin"] = "independent_manual"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            prepare(images, refs, expected_count=1)
            for candidate in CANDIDATES:
                (output / candidate).mkdir(parents=True)
                (output / candidate / "1.txt").write_text("ABC DEF\n", encoding="utf-8")
            report = evaluate(images, refs, output, root / "report.json")
            self.assertEqual(report["candidates"]["tesseract"]["micro_cer"], 0)
            self.assertEqual(report["candidates"]["easyocr"]["micro_wer"], 0)

    def test_changed_image_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images, refs, output = root / "images", root / "refs", root / "ocr"
            images.mkdir()
            (images / "1.png").write_bytes(b"synthetic image")
            prepare(images, refs)
            (refs / "1.txt").write_text("ABC", encoding="utf-8")
            (images / "1.png").write_bytes(b"changed synthetic image")
            with self.assertRaisesRegex(ValueError, "changed"):
                evaluate(images, refs, output, root / "report.json")

    def test_ocr_draft_is_preserved_but_cannot_be_scored_as_reviewed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images, refs, output = root / "images", root / "refs", root / "ocr"
            images.mkdir()
            (images / "1.png").write_bytes(b"synthetic image")
            prepare(images, refs)
            (output / "paddleocr").mkdir(parents=True)
            (output / "paddleocr" / "1.txt").write_text("SYNTHETIC OCR DRAFT", encoding="utf-8")
            self.assertEqual(draft(images, refs, output)["drafts_created"], 1)
            (output / "paddleocr" / "1.txt").write_text("CHANGED OCR", encoding="utf-8")
            self.assertEqual(draft(images, refs, output)["existing_preserved"], 1)
            self.assertEqual((refs / "1.txt").read_text(encoding="utf-8"), "SYNTHETIC OCR DRAFT")
            manifest_path = refs / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["samples"][0]["transcript_origin"], "paddleocr_assisted_draft")
            self.assertFalse(manifest["samples"][0]["reviewed_against_image"])
            with self.assertRaisesRegex(ValueError, "not been marked reviewed"):
                evaluate(images, refs, output, root / "report.json")
            manifest["samples"][0]["reviewed_against_image"] = True
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "transcript_origin"):
                evaluate(images, refs, output, root / "report.json")


if __name__ == "__main__":
    unittest.main()
