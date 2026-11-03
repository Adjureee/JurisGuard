# Client and case extraction: bounded processing

## Cause and changes

The upload service had no request deadline. The backend ran OCR in a Python
thread behind a shared engine lock, so a stalled native PaddleOCR call could
hold later uploads indefinitely. Full-page scans also reached the CPU detector
at up to 2500 pixels on the longest side.

The upload API now uses one reusable, spawned extraction worker per API
process. Its cached models are reused across successful requests. A timeout or
disconnect stops the child process; the next request starts a fresh worker.
Concurrent extraction requests receive HTTP 503 with `Retry-After: 5` instead
of waiting in an unlimited OCR queue. Timeout returns HTTP 504. Cancelled or
failed requests mark their document record `FAILED`. Native OCR failures also
discard the cached worker so later uploads get a fresh predictor.

Client and case forms display elapsed time and a Cancel extraction button.
They reject duplicate uploads while a scan is active, abort on close/unmount,
and ignore results from obsolete requests. A browser deadline also covers a
connection that never responds. Empty/failed OCR results show an error instead
of a success toast. JPG, PNG, WEBP, and PDF uploads use the same service.

PaddleOCR detection has a separate maximum dimension of 1280 pixels.
Recognition crops still come from the larger working image (up to 2500).
Timing information is added to diagnostics, outside the unchanged inventory:
`request_processing_seconds` and `ocr_timings` (total, per-page, and detector
limit). Timing is not a confidence score.

## Activate locally

Restart the backend and frontend after updating the files. No new dependency
or model download is required. From the repository root, in one PowerShell:

```powershell
Set-Location backend
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

In a second terminal, from the repository root:

```powershell
Set-Location frontend
npm run dev
```

Optional settings in the root `.env` (or backend `.env`, which overrides it):

```dotenv
LOCAL_OCR_MAX_DIMENSION=2500
LOCAL_OCR_DET_MAX_DIMENSION=1280
DOCUMENT_EXTRACTION_TIMEOUT_SECONDS=180
```

For a nondefault browser deadline, set this in `frontend/.env.local` and restart
Vite (or rebuild for production):

```dotenv
VITE_DOCUMENT_EXTRACTION_TIMEOUT_MS=200000
```

The browser limit should exceed the backend deadline plus upload/response time.
The backend deadline includes model startup and applies to the entire document,
including all PDF pages. Larger documents may need to be split into separate
uploads. Raising the limit extends the wait; it does not make inference faster.
Do not run multiple Uvicorn workers just to accelerate OCR on a small CPU:
each API process loads a separate model worker.

## Verification commands

From the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -t . -p 'test_*.py' -q
node --test tests/frontend/extraction_deadline.test.cjs
Set-Location frontend
npm run typecheck
npm run build
```

The worker tests exercise timeouts, process termination, reuse, crash recovery,
busy rejection, browser disconnects, and ASGI task cancellation. Upload-handler
tests compile the actual handler with an in-memory database stub, verifying
failure status and successful inventory/review mapping without connecting to
PostgreSQL. Three synthetic large intake variations cover formatting, noise,
and missing values in the resize regression; their OCR output is mocked.
Existing real-inference synthetic tests cover English/Tagalog intake and RTC
documents. Experimental OCR candidates remain confined to lab tests.

For the local UI check, log in and upload a synthetic document through Add
Client. Confirm elapsed time appears, cancel it, and upload it again. Close the
modal during extraction and confirm no fields are populated later. Repeat in
the case form. A timeout should clear the loading state and permit a retry.

## Limits

The deadline fixes unbounded waiting; CPU OCR on dense pages can still be slow.
The first request includes process/model startup. Detection downscaling can
miss small text, so validate handwritten-field recall on reviewed samples
before choosing a different cap. No demographic or legal inference rules were
changed, and no model was trained. Synthetic checks do not establish real-world
OCR accuracy. Live browser/PostgreSQL verification must be reported separately
from isolated handler tests.

A diagnostic run of the first page of a dense synthetic interview sheet used
a 960-pixel detector cap and one CPU thread. It reached the 180-second
deadline on this Windows CPU. That scan did not produce an extraction result,
so this change should not be reported as a measured speedup for dense forms.
CPU recognition remained the main cost in that run. A separate oneDNN trial
failed during PaddlePaddle inference, so the existing disabled setting
remains in place.
