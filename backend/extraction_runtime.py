"""Bound API extraction with one reusable, killable local worker per API process.

Native OCR cannot be stopped by cancelling a Python thread. A spawned worker
keeps models warm on one thread; timeout/disconnect kills that worker and the
next request starts a fresh one. No database/session/document content is logged.
"""
from __future__ import annotations

import atexit
import asyncio
from functools import partial
import multiprocessing as mp
import os
import threading
import time


class ExtractionBusy(RuntimeError):
    pass


class ExtractionTimeout(RuntimeError):
    pass


class ExtractionCancelled(RuntimeError):
    pass


class ExtractionWorkerError(RuntimeError):
    pass


def _worker_main(connection):
    # Import here: spawning must not import FastAPI, create tables, or open a DB.
    try:
        from ai_service import process_document

        while True:
            command = connection.recv()
            path, mode = command[:2]
            target = command[2] if len(command) > 2 else "full"
            try:
                result = process_document(path, extraction_mode=mode, extraction_target=target)
                connection.send((True, result))
            except Exception:
                # Do not send exception strings which may contain private OCR.
                connection.send((False, None))
    except (EOFError, BrokenPipeError, OSError):
        pass
    finally:
        connection.close()


def _timeout_seconds():
    try:
        return max(1, min(600, int(os.getenv("DOCUMENT_EXTRACTION_TIMEOUT_SECONDS", "180"))))
    except ValueError:
        return 180


class ExtractionWorker:
    def __init__(self, timeout_seconds=None, target=_worker_main):
        self.timeout_seconds = timeout_seconds if timeout_seconds is not None else _timeout_seconds()
        self._target = target
        self._lock = threading.Lock()
        self._process = None
        self._connection = None

    def _stop(self):
        process, connection = self._process, self._connection
        self._process = self._connection = None
        if process is not None:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join(timeout=2)
            process.close()
        if connection is not None:
            connection.close()

    def _start(self):
        if self._process is not None and self._process.is_alive():
            return
        self._stop()
        context = mp.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(target=self._target, args=(child,), daemon=True)
        try:
            process.start()
        except BaseException:
            parent.close()
            process.close()
            raise
        finally:
            child.close()
        self._process, self._connection = process, parent

    def extract(self, path, mode="auto", cancel=None, target="full"):
        # No unbounded queue behind a slow or stuck document.
        if not self._lock.acquire(blocking=False):
            raise ExtractionBusy("Another document is being extracted. Wait for it to finish, then retry.")
        started = time.monotonic()
        try:
            if cancel is not None and cancel.is_set():
                raise ExtractionCancelled("Extraction cancelled.")
            self._start()
            command = (str(path), mode, target) if target != "full" else (str(path), mode)
            self._connection.send(command)
            while True:
                if cancel is not None and cancel.is_set():
                    raise ExtractionCancelled("Extraction cancelled.")
                remaining = self.timeout_seconds - (time.monotonic() - started)
                if remaining <= 0:
                    raise ExtractionTimeout(
                        f"Extraction exceeded {self.timeout_seconds:g} seconds and was stopped. "
                        "Try one clear page at a time, or enter the fields manually."
                    )
                if self._connection.poll(min(.1, remaining)):
                    ok, result = self._connection.recv()
                    if not ok or not isinstance(result, dict):
                        raise ExtractionWorkerError("Extraction failed. Try a clearer document or enter the fields manually.")
                    result.setdefault("diagnostics", {})["request_processing_seconds"] = round(time.monotonic() - started, 3)
                    # The local adapter caches native inference failures. Replace
                    # that worker so a later document gets a fresh predictor.
                    if result.get("extraction_mode") == "OFFLINE_OCR_FAILED":
                        self._stop()
                    return result
                if not self._process.is_alive():
                    raise ExtractionWorkerError("The extraction worker stopped. Retry the document.")
        except (ExtractionTimeout, ExtractionCancelled, ExtractionWorkerError):
            self._stop()
            raise
        except Exception as exc:
            self._stop()
            raise ExtractionWorkerError("The extraction worker could not process this document. Retry or enter fields manually.") from exc
        finally:
            self._lock.release()

    def close(self):
        with self._lock:
            self._stop()


_worker = ExtractionWorker()
atexit.register(_worker.close)


async def extract_document(path, mode="auto", target="full", is_disconnected=None, worker=None):
    """Keep the API event loop responsive and stop work after browser disconnect."""
    worker = worker or _worker
    cancel = threading.Event()
    if target == "full":
        work = partial(worker.extract, path, mode, cancel)
    else:
        work = partial(worker.extract, path, mode, cancel, target)
    pending = asyncio.get_running_loop().run_in_executor(None, work)
    try:
        while not pending.done():
            if is_disconnected is not None and await is_disconnected():
                raise ExtractionCancelled("Extraction cancelled because the upload connection closed.")
            await asyncio.wait({pending}, timeout=.2)
        return await pending
    except BaseException:
        cancel.set()
        # The supervisor will stop the child. Consume its eventual exception if
        # the ASGI request itself was cancelled before the supervisor returned.
        pending.add_done_callback(lambda future: None if future.cancelled() else future.exception())
        raise
