"""OCR adapter tests; no NLP rules or model download required."""

import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
