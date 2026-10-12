"""Synthetic OCR/NLP integration tests; never contact an external network or database."""

import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from ai_service import process_document
from extraction_mapping import public_extraction_payload
from inventory_mvp import DocumentRouter, validate_inventory
from local_ocr import LocalOCR

FIXTURES = {
    "english": ("INTERVIEW SHEET\nControl No.: 0007-24\nName: Maria Santos\nContact No.: 09170001234", "intake_form"),
    "tagalog": ("INTERVIEW SHEET\nPangalan: Ana Reyes\nTirahan: Barangay San Jose\nContact No.: 09980012345", "intake_form"),
    "rtc": ("REPUBLIC OF THE PHILIPPINES\nREGIONAL TRIAL COURT\nBranch 12\nPEOPLE OF THE PHILIPPINES\n-versus-\nJUAN DELA CRUZ, Accused.\nCriminal Case No. 00045-24\nDECISION", "rtc_decision"),
}


class OfflinePipelineTests(unittest.TestCase):
    def test_reference_text_and_independent_ocr_then_pipeline(self):
        original_connect = socket.socket.connect

        def only_loopback(sock, address):
            if isinstance(address, tuple) and address[0] not in ("localhost", "127.0.0.1", "::1"):
                raise AssertionError(f"Unexpected external network request: {address[0]}")
            return original_connect(sock, address)

        font = ImageFont.truetype("arial.ttf", 43)
        with tempfile.TemporaryDirectory() as directory, patch.object(socket.socket, "connect", only_loopback):
            for name, (reference, expected_type) in FIXTURES.items():
                with self.subTest(name=name):
                    # NLP independently consumes reference text, before OCR output.
                    reference_result = DocumentRouter().process(reference)
                    self.assertEqual(reference_result["document_type"], expected_type)
                    validate_inventory(reference_result["inventory"])

                    lines = reference.splitlines()
                    image = Image.new("RGB", (2100, 85 + 95 * len(lines)), "white")
                    draw = ImageDraw.Draw(image)
                    for index, line in enumerate(lines):
                        draw.text((55, 40 + index * 95), line, fill="black", font=font)
                    path = Path(directory) / f"{name}.png"
                    image.save(path)
                    # OCR independently: inspect text before routing it to NLP.
                    ocr = LocalOCR().extract(path)
                    print(name, "OCR", ocr.engine, repr(ocr.raw_text[:220]), flush=True)
                    self.assertTrue(ocr.raw_text.strip())
                    self.assertTrue(ocr.layout)
                    # Full integration: OCR -> router/field mapping -> public payload.
                    result = public_extraction_payload(process_document(str(path), extraction_mode="auto"))
                    print(name, "ROUTED", result["document_type"], "review", result["needs_review"], flush=True)
                    self.assertEqual(result["document_type"], expected_type)
                    validate_inventory(result["inventory"])
                    self.assertEqual(tuple(result["inventory"]), tuple(reference_result["inventory"]))
                    self.assertEqual(result["diagnostics"]["ocr_engine"], ocr.engine)
                    self.assertEqual(result["diagnostics"]["page_count"], 1)


if __name__ == "__main__":
    unittest.main()
