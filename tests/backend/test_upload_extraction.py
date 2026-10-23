"""Exercise the real upload handler with synthetic files and an in-memory DB stub.

Only the handler is compiled from main.py: importing main would connect to the
configured PostgreSQL database and create tables. No production DB is touched.
"""
import ast
import asyncio
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock
import uuid

from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers

from extraction_mapping import public_extraction_payload, ocr_status_for_result
from extraction_runtime import (
    ExtractionBusy, ExtractionTimeout, ExtractionCancelled, ExtractionWorkerError,
)
from inventory_mvp import empty_inventory
from upload_validation import save_bounded_upload, verify_image


class UploadExtractionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.document = None
        self.added = []

        def document(**kwargs):
            self.document = SimpleNamespace(document_id=1, **kwargs)
            return self.document

        self.db = Mock()
        self.db.add.side_effect = self.added.append
        self.extract = AsyncMock()
        namespace = {
            "asyncio": asyncio, "Path": Path, "uuid": uuid,
            "HTTPException": HTTPException,
            "models": SimpleNamespace(Document=document, ExtractedMetadata=SimpleNamespace),
            "UPLOAD_DIR": Path(directory.name),
            "DOCUMENT_CONTENT_TYPES": {".png": {"image/png"}},
            "MAX_DOCUMENT_BYTES": 25 * 1024 * 1024,
            "save_bounded_upload": save_bounded_upload,
            "verify_image": verify_image,
            "extract_document": self.extract,
            "public_extraction_payload": public_extraction_payload,
            "ocr_status_for_result": ocr_status_for_result,
            "write_audit": Mock(),
            "ExtractionBusy": ExtractionBusy,
            "ExtractionTimeout": ExtractionTimeout,
            "ExtractionCancelled": ExtractionCancelled,
            "ExtractionWorkerError": ExtractionWorkerError,
        }
        tree = ast.parse((Path(__file__).resolve().parents[2] / "backend/main.py").read_text(encoding="utf-8"))
        handler = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "upload_document")
        handler.decorator_list = []
        # Preserve the function body; replace FastAPI's dependency declarations
        # with explicit arguments supplied by this isolated handler test.
        handler.args.defaults = []
        for argument in handler.args.args:
            argument.annotation = None
        exec(compile(ast.Module(body=[handler], type_ignores=[]), "backend/main.py", "exec"), namespace)
        self.handler = namespace["upload_document"]

    async def upload(self):
        image = io.BytesIO()
        Image.new("RGB", (20, 20), "white").save(image, "PNG")
        image.seek(0)
        file = UploadFile(image, filename="synthetic.png", headers=Headers({"content-type": "image/png"}))
        try:
            return await self.handler(
                request=SimpleNamespace(is_disconnected=AsyncMock(return_value=False)),
                user=SimpleNamespace(user_id=1, full_name="Synthetic Tester"),
                user_id=None, file=file, case_id=None, intake_id=None,
                extraction_mode="offline", extraction_target="full", db=self.db,
            )
        finally:
            await file.close()

    async def test_worker_failures_clear_processing_state_and_return_actionable_status(self):
        for error, status in [
            (ExtractionBusy("busy"), 503), (ExtractionTimeout("timeout"), 504),
            (ExtractionCancelled("cancelled"), 499), (ExtractionWorkerError("failed"), 503),
        ]:
            with self.subTest(error=type(error).__name__):
                self.extract.side_effect = error
                with self.assertRaises(HTTPException) as caught:
                    await self.upload()
                self.assertEqual(caught.exception.status_code, status)
                self.assertEqual(self.document.ocr_status, "FAILED")
                if isinstance(error, ExtractionBusy):
                    self.assertEqual(caught.exception.headers["Retry-After"], "5")

    async def test_asgi_task_cancellation_clears_processing_state(self):
        self.extract.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.upload()
        self.assertEqual(self.document.ocr_status, "FAILED")

    async def test_success_keeps_inventory_contract_and_review_workflow(self):
        inventory = empty_inventory()
        inventory["Contact Number"] = "00000000000"
        self.extract.return_value = {
            "extraction_mode": "OFFLINE_SPACY_RULES", "document_type": "intake_form",
            "inventory": inventory, "diagnostics": {"request_processing_seconds": 1.25},
            "needs_review": True, "raw_text": "Synthetic reference",
        }
        result = await self.upload()
        self.assertEqual(self.document.ocr_status, "COMPLETED")
        self.assertEqual(result["extracted_data"]["inventory"], inventory)
        self.assertTrue(result["extracted_data"]["needs_review"])
        self.assertEqual(self.added[-1].verification_status, "PENDING")

    async def test_empty_ocr_result_is_failed_and_reviewable(self):
        self.extract.return_value = {"extraction_mode": "OFFLINE_OCR_EMPTY", "inventory": empty_inventory()}
        result = await self.upload()
        self.assertEqual(self.document.ocr_status, "FAILED")
        self.assertTrue(result["extracted_data"]["needs_review"])
