"""Synthetic worker lifecycle tests; no OCR models, network, or database."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
import threading
import time
import unittest

from extraction_runtime import (
    ExtractionWorker, ExtractionBusy, ExtractionTimeout, ExtractionCancelled,
    ExtractionWorkerError, extract_document,
)


def synthetic_worker(connection):
    try:
        while True:
            request = connection.recv()
            command, _mode = request[:2]
            target = request[2] if len(request) > 2 else "full"
            if command == "hang":
                while True:
                    time.sleep(.1)
            if command == "crash":
                os._exit(7)
            if command == "error":
                connection.send((False, None))
            else:
                connection.send((True, {
                    "diagnostics": {}, "worker_pid": os.getpid(),
                    "target": target,
                    "extraction_mode": "OFFLINE_OCR_FAILED" if command == "ocr_error" else "OFFLINE_SPACY_RULES",
                }))
    except (EOFError, BrokenPipeError, OSError):
        pass
    finally:
        connection.close()


class ExtractionRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.worker = ExtractionWorker(timeout_seconds=10, target=synthetic_worker)
        self.addCleanup(self.worker.close)

    def test_worker_reused_between_successful_requests(self):
        first = self.worker.extract("ok")
        second = self.worker.extract("ok")
        self.assertEqual(first["worker_pid"], second["worker_pid"])
        self.assertGreaterEqual(first["diagnostics"]["request_processing_seconds"], 0)

    def test_client_target_is_forwarded_to_worker(self):
        result = self.worker.extract("ok", target="client")
        self.assertEqual(result["target"], "client")

    def test_timeout_kills_native_job_and_next_request_succeeds(self):
        self.worker.extract("ok")
        process = self.worker._process
        self.worker.timeout_seconds = .25
        started = time.monotonic()
        with self.assertRaises(ExtractionTimeout):
            self.worker.extract("hang")
        self.assertLess(time.monotonic() - started, 3)
        self.assertTrue(process._closed)
        self.assertIsNone(self.worker._process)
        self.worker.timeout_seconds = 10
        self.assertIn("worker_pid", self.worker.extract("ok"))

    def test_busy_request_does_not_queue_and_cancel_releases_worker(self):
        self.worker.extract("ok")
        cancel = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(self.worker.extract, "hang", "offline", cancel)
            deadline = time.monotonic() + 2
            while not self.worker._lock.locked() and time.monotonic() < deadline:
                time.sleep(.01)
            try:
                started = time.monotonic()
                with self.assertRaises(ExtractionBusy):
                    self.worker.extract("ok")
                self.assertLess(time.monotonic() - started, .5)
            finally:
                cancel.set()
            with self.assertRaises(ExtractionCancelled):
                pending.result(timeout=3)
        self.assertIn("worker_pid", self.worker.extract("ok"))

    def test_crash_and_worker_error_are_recoverable(self):
        for command in ["crash", "error"]:
            with self.subTest(command=command):
                with self.assertRaises(ExtractionWorkerError):
                    self.worker.extract(command)
                self.assertIn("worker_pid", self.worker.extract("ok"))

    def test_already_cancelled_request_does_not_start_model_worker(self):
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(ExtractionCancelled):
            self.worker.extract("ok", cancel=cancel)
        self.assertIsNone(self.worker._process)

    def test_native_ocr_failure_does_not_poison_the_next_document(self):
        result = self.worker.extract("ocr_error")
        self.assertEqual(result["extraction_mode"], "OFFLINE_OCR_FAILED")
        self.assertIsNone(self.worker._process)
        retry = self.worker.extract("ok")
        self.assertEqual(retry["extraction_mode"], "OFFLINE_SPACY_RULES")
        self.assertNotEqual(retry["worker_pid"], result["worker_pid"])

    def test_browser_disconnect_signals_worker_cancellation(self):
        stopped = threading.Event()
        class WaitingWorker:
            def extract(self, path, mode, cancel):
                if cancel.wait(timeout=2):
                    stopped.set()
                    raise ExtractionCancelled()
                raise AssertionError("Worker was not cancelled")
        async def disconnected():
            return True
        async def run():
            with self.assertRaises(ExtractionCancelled):
                await extract_document("synthetic.png", is_disconnected=disconnected, worker=WaitingWorker())
            await asyncio.sleep(.05)
        asyncio.run(run())
        self.assertTrue(stopped.wait(timeout=1))

    def test_cancelled_asgi_task_stops_worker(self):
        stopped = threading.Event()
        class WaitingWorker:
            def extract(self, path, mode, cancel):
                if cancel.wait(timeout=2): stopped.set()
                return {}
        async def run():
            pending = asyncio.create_task(extract_document("synthetic.png", worker=WaitingWorker()))
            await asyncio.sleep(.05)
            pending.cancel()
            with self.assertRaises(asyncio.CancelledError): await pending
            await asyncio.sleep(.05)
        asyncio.run(run())
        self.assertTrue(stopped.wait(timeout=1))
