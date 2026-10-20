"""OCR adapter tests; no NLP rules or model download required."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from config import LabConfig
from src.ocr_pipeline import PaddleOCREngine, parse_tesseract_tsv


class OCRTests(unittest.TestCase):
    def test_tesseract_tsv_preserves_lines_and_boxes(self):
        tsv = (
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
            "5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t90\tINTERVIEW\n"
            "5\t1\t1\t1\t1\t2\t55\t20\t30\t12\t80\tSHEET\n"
            "5\t1\t1\t1\t2\t1\t10\t50\t70\t12\t91\tName:\n"
        )
        result = parse_tesseract_tsv(tsv)
        self.assertEqual(result.raw_text, "INTERVIEW SHEET\nName:")
        self.assertEqual(result.lines[0].bbox, (10, 20, 85, 32))
        self.assertEqual(result.lines[1].number, 2)
        self.assertEqual(result.engine, "tesseract")

    def test_three_synthetic_quote_variations_do_not_merge_tsv_rows(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        for first_word in ('"', '"CASE', '"A""B"'):
            with self.subTest(synthetic_word=first_word):
                tsv = (
                    header
                    + f"5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t90\t{first_word}\n"
                    + "5\t1\t1\t1\t2\t1\t10\t50\t70\t12\t91\tNEXT\n"
                )
                result = parse_tesseract_tsv(tsv)
                self.assertEqual(result.raw_text, first_word + "\nNEXT")
                self.assertEqual(len(result.lines), 2)

    def test_missing_paddle_models_fail_without_download(self):
        with tempfile.TemporaryDirectory() as directory:
            config = LabConfig(paddle_det_model_dir=Path(directory) / "det", paddle_rec_model_dir=Path(directory) / "rec")
            with self.assertRaisesRegex(RuntimeError, "does not download models"):
                PaddleOCREngine(config).extract(Path(directory) / "unused.png")

    def test_paddle_v3_result_preserves_lines_and_uses_local_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder in (root / "det", root / "rec"):
                folder.mkdir()
                for name in ("inference.json", "inference.pdiparams", "inference.yml"):
                    (folder / name).touch()
            calls = {}

            class FakePaddle:
                def __init__(self, **kwargs):
                    calls.update(kwargs)

                def predict(self, *, input):
                    return [SimpleNamespace(json={"res": {
                        "rec_texts": ["Ana", "Name:"],
                        "rec_scores": [0.2, 0.9],
                        "rec_boxes": [[90, 10, 130, 30], [10, 10, 80, 30]],
                    }})]

            config = LabConfig(paddle_det_model_dir=root / "det", paddle_rec_model_dir=root / "rec")
            with patch("src.ocr_pipeline.version", side_effect=["3.7.0", "3.3.1"]), patch.dict("sys.modules", {"paddleocr": SimpleNamespace(PaddleOCR=FakePaddle)}):
                result = PaddleOCREngine(config).extract(root / "source.png")
            self.assertEqual(result.raw_text, "Name:\nAna")
            self.assertEqual(result.lines[1].bbox, (90, 10, 130, 30))
            self.assertEqual(calls["text_detection_model_dir"], str(root / "det"))
            self.assertEqual(calls["text_recognition_model_dir"], str(root / "rec"))
            self.assertFalse(calls["enable_mkldnn"])


if __name__ == "__main__":
    unittest.main()
