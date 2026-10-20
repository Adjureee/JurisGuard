"""Local OCR, router handoff, and JSONB payload regressions; synthetic data only."""

import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_service import JurisGuardExtractionEngine
from extraction_mapping import ocr_status_for_result, public_extraction_payload
from inventory_mvp import INVENTORY_FIELDS, empty_inventory
from local_ocr import LocalOCR, OCRDocument, OfflineOCRError


RTC_TEXT = """REPUBLIC OF THE PHILIPPINES
REGIONAL TRIAL COURT
Branch 12
PEOPLE OF THE PHILIPPINES
-versus-
JUAN DELA CRUZ, Accused.
Criminal Case No. 00045-24
DECISION"""
SANDIGANBAYAN_TEXT = """REPUBLIC OF THE PHILIPPINES
Sandiganbayan
FOURTH DIVISION
PEOPLE OF THE PHILIPPINES
Case No. SB-25-CRM-0042
DECISION
The Regional Trial Court was discussed in the case history."""


class LocalOCRTests(unittest.TestCase):
    def test_missing_models_never_reach_paddle_constructor(self):
        ocr = LocalOCR()
        ocr.det_model = Path("missing-det-model")
        with self.assertRaisesRegex(OfflineOCRError, "download is disabled"):
            ocr._paddle_engine()

    def test_incompatible_paddle_runtime_fails_before_inference(self):
        ocr = LocalOCR()
        with patch.object(ocr, "_model_complete", return_value=True), patch("local_ocr.version", side_effect=["2.8.1", "2.6.2"]):
            with self.assertRaisesRegex(OfflineOCRError, "PaddleOCR 3.x"):
                ocr._paddle_engine()

    def test_paddle_constructor_uses_only_checked_local_model_paths(self):
        ocr = LocalOCR()
        called = {}
        fake_module = SimpleNamespace(__version__="3.7.0", PaddleOCR=lambda **kwargs: called.update(kwargs) or object())
        with patch.object(ocr, "_model_complete", return_value=True), patch("local_ocr.version", side_effect=["3.7.0", "3.3.1"]), patch.dict("sys.modules", {"paddleocr": fake_module}):
            ocr._paddle_engine()
        self.assertEqual(called["text_detection_model_dir"], str(ocr.det_model))
        self.assertEqual(called["text_recognition_model_dir"], str(ocr.rec_model))
        self.assertEqual(called["text_detection_model_name"], "PP-OCRv6_medium_det")
        self.assertEqual(called["text_recognition_model_name"], "PP-OCRv6_medium_rec")
        self.assertFalse(called["enable_mkldnn"])
        self.assertFalse(called["use_doc_orientation_classify"])
        self.assertFalse(called["use_doc_unwarping"])
        self.assertFalse(called["use_textline_orientation"])

    def test_paddle_boxes_remain_separate_lines_even_at_same_height(self):
        page = SimpleNamespace(json={"res": {
            "rec_texts": ["Ana", "Name:"],
            "rec_scores": [0.2, 0.9],
            "rec_boxes": [[90, 10, 130, 30], [10, 10, 80, 30]],
        }})
        lines = LocalOCR._paddle_lines([page], 1)
        self.assertEqual([item["text"] for item in lines], ["Name:", "Ana"])
        self.assertEqual(lines[1]["engine_score"], 0.2)

    def test_mismatched_paddle_output_requires_review(self):
        page = SimpleNamespace(json={"res": {"rec_texts": ["Name"], "rec_scores": [], "rec_boxes": [[0, 0, 1, 1]]}})
        with self.assertRaisesRegex(OfflineOCRError, "mismatched"):
            LocalOCR._paddle_lines([page], 1)

    def test_blank_and_corrupt_images_are_handled(self):
        with tempfile.TemporaryDirectory() as directory:
            blank = Path(directory) / "blank.png"
            Image.new("RGB", (300, 200), "white").save(blank)
            result = LocalOCR().extract(blank)
            self.assertEqual(result.raw_text, "")
            self.assertTrue(any("blank" in warning for warning in result.warnings))
            corrupt = Path(directory) / "corrupt.png"
            corrupt.write_bytes(b"not an image")
            with self.assertRaisesRegex(OfflineOCRError, "corrupt"):
                LocalOCR().extract(corrupt)

    def test_low_contrast_image_is_flagged_for_review(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "faint.png"
            image = Image.new("RGB", (300, 100), (230, 230, 230))
            ImageDraw.Draw(image).rectangle((20, 20, 280, 70), fill=(220, 220, 220))
            image.save(path)
            ocr = LocalOCR()
            with patch.object(ocr, "_paddle_page", return_value=[{"page": 1, "text": "Name: Ana", "bbox": [0, 0, 10, 10], "engine_score": 0.9}]):
                result = ocr.extract(path)
            self.assertEqual(result.raw_text, "Name: Ana")
            self.assertTrue(any("low contrast" in warning for warning in result.warnings))

    def test_paddle_failure_stops_ocr_without_switching_engines(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.png"
            image = Image.new("RGB", (300, 100), "white")
            ImageDraw.Draw(image).rectangle((20, 20, 280, 70), fill="black")
            image.save(path)
            ocr = LocalOCR()
            with patch.object(ocr, "_paddle_page", side_effect=OfflineOCRError("PaddleOCR unavailable")) as paddle:
                with self.assertRaisesRegex(OfflineOCRError, "PaddleOCR unavailable"):
                    ocr.extract(path)
            paddle.assert_called_once()

    def test_local_pdf_page_renders_without_database_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "synthetic.pdf"
            Image.new("RGB", (200, 100), "white").save(pdf, "PDF")
            pages = list(LocalOCR()._pages(pdf))
            self.assertEqual(len(pages), 1)
            self.assertEqual(pages[0][0], 1)


class IntegrationTests(unittest.TestCase):
    def test_paddle_failure_returns_reviewable_empty_inventory(self):
        engine = object.__new__(JurisGuardExtractionEngine)
        engine.local_ocr = LocalOCR()
        with patch.object(engine.local_ocr, "extract", side_effect=OfflineOCRError("PaddleOCR unavailable")):
            result = engine._run_offline_pipeline("synthetic.png")
        self.assertEqual(result["extraction_mode"], "OFFLINE_OCR_FAILED")
        self.assertEqual(result["document_type"], "unknown")
        self.assertEqual(result["inventory"], empty_inventory())
        self.assertIsNone(result["diagnostics"]["ocr_engine"])
        self.assertTrue(result["needs_review"])
        self.assertEqual(ocr_status_for_result(result), "FAILED")

    def test_sandiganbayan_routes_with_empty_inventory_and_review(self):
        engine = object.__new__(JurisGuardExtractionEngine)
        engine.local_ocr = type("FakeOCR", (), {"extract": lambda self, _: OCRDocument(SANDIGANBAYAN_TEXT, [], "fake", 1, [])})()
        with patch("ai_service.spacy_extract_pao_fields", side_effect=AssertionError("intake parser called")):
            result = engine._run_offline_pipeline("unused.png")
        self.assertEqual(result["document_type"], "sandiganbayan_document")
        self.assertEqual(result["inventory"], empty_inventory())
        self.assertTrue(result["needs_review"])
        self.assertEqual(public_extraction_payload(result)["document_type"], "sandiganbayan_document")

    def test_rtc_routes_without_running_intake_spacy(self):
        engine = object.__new__(JurisGuardExtractionEngine)
        engine.local_ocr = type("FakeOCR", (), {"extract": lambda self, _: OCRDocument(RTC_TEXT, [], "fake", 1, [])})()
        with patch("ai_service.spacy_extract_pao_fields", side_effect=AssertionError("intake parser called")):
            result = engine._run_offline_pipeline("unused.png")
        self.assertEqual(result["document_type"], "rtc_decision")
        self.assertEqual(result["inventory"]["Case No."], "00045-24")
        self.assertIsNone(result["inventory"]["Status of the Case"])
        self.assertEqual(result["raw_text"], RTC_TEXT)

    def test_structured_pao_form_routes_to_legacy_intake_parser(self):
        text = "Rehiyon XI District Office PAO Panabo\nControl No.: XI-001\nI. URI NG INIHIHINGI NG TULONG\nII. IMPORMASYON UKOL SA APLIKANTE\nPangalan: Ana Reyes Edad: 24"
        engine = object.__new__(JurisGuardExtractionEngine)
        engine.local_ocr = type("FakeOCR", (), {"extract": lambda self, _: OCRDocument(text, [], "fake", 1, [])})()
        result = engine._run_offline_pipeline("unused.png")
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["extraction_mode"], "OFFLINE_SPACY_RULES")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")

    def test_auto_mode_uses_only_offline_path(self):
        engine = object.__new__(JurisGuardExtractionEngine)
        engine._run_offline_pipeline = lambda _: {"document_type": "unknown", "inventory": empty_inventory(), "diagnostics": {}, "needs_review": True}
        engine._sectioned_from_flat = lambda _: {}
        with patch("ai_service.requests.post", side_effect=AssertionError("network request")):
            result = engine.execute_extraction("unused.png", extraction_mode="auto")
        self.assertEqual(result["inventory"], empty_inventory())

    def test_public_jsonb_mapping_preserves_exact_inventory_and_review(self):
        inventory = empty_inventory()
        inventory["Contact Number"] = "00123"
        payload = public_extraction_payload({"inventory": inventory, "document_type": "intake_form", "raw_text": "Name: Ana", "needs_review": False, "diagnostics": {"warnings": []}})
        self.assertEqual(tuple(payload["inventory"]), INVENTORY_FIELDS)
        self.assertEqual(payload["inventory"]["Contact Number"], "00123")
        self.assertFalse(payload["needs_review"])
        invalid = public_extraction_payload({"inventory": {"Extra": 1}, "needs_review": False})
        self.assertEqual(invalid["inventory"], empty_inventory())
        self.assertTrue(invalid["needs_review"])
        self.assertEqual(ocr_status_for_result({"extraction_mode": "OFFLINE_OCR_FAILED"}), "FAILED")


if __name__ == "__main__":
    unittest.main()
