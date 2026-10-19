"""Synthetic-only report tests; no real legal records are committed."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from src.classification_report import CANDIDATES, build_report, write_report


class ClassificationReportTests(unittest.TestCase):
    def test_report_separates_sandiganbayan_and_rtc_without_field_claims(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images, texts = root / "images", root / "ocr"
            images.mkdir()
            sand = "REPUBLIC OF THE PHILIPPINES\nSandiganbayan\nFOURTH DIVISION\nPEOPLE OF THE PHILIPPINES\nCase No. SB-25-CRM-0042\nDECISION"
            rtc = "REPUBLIC OF THE PHILIPPINES\nREGIONAL TRIAL COURT\nBranch 12\nPEOPLE OF THE PHILIPPINES\n-versus-\nSAMPLE ACCUSED, Accused\nCriminal Case No. 0042\nDECISION"
            samples = []
            for number, label in (("1", "sandiganbayan_document"), ("2", "rtc_decision")):
                image = images / f"{number}.png"
                image.write_bytes(f"synthetic image {number}".encode())
                samples.append({"sample_id": number, "image_filename": image.name,
                                "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                                "visual_document_type": label,
                                "visual_label_source": "agent_visual_inspection_of_image"})
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps({"dataset_origin": "real", "samples": samples}), encoding="utf-8")
            for candidate in CANDIDATES:
                directory = texts / candidate
                directory.mkdir(parents=True)
                (directory / "1.txt").write_text(sand, encoding="utf-8")
                (directory / "2.txt").write_text(rtc, encoding="utf-8")
            report = build_report(images, manifest_path, texts)
            self.assertEqual(report["rtc_real_sample_count"], 1)
            self.assertIsNone(report["ocr_cer"])
            self.assertIsNone(report["field_accuracy"])
            self.assertEqual(report["candidates"]["paddleocr"]["label_match_count"], 2)
            self.assertEqual(report["candidates"]["easyocr"]["wrong_court_count"], 0)
            write_report(report, root / "report.json", root / "report.md")
            self.assertIn("in-sample diagnostic", (root / "report.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
