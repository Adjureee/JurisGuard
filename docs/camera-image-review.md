# Camera image review

The Add Client camera flow is Capture → Review crop → Extract information → Review details → Save. There is no separate Prepare for OCR screen. Uploads continue directly to extraction.

After capture, the camera stops. Local preparation applies EXIF orientation, detects a bright document quadrilateral with all edges inside the frame, and rectifies perspective only when those checks pass. Detection expands the boundary slightly to retain edge marks. Uncertain boundaries preserve the complete frame for manual crop review. Lighting normalization is bounded, with mild contrast adjustment; no thresholding, denoising, sharpening or generated content is used. PNG preserves the processed pixels without another lossy encoding.

Crop is the only manual adjustment, with draggable corners, drag-to-move, and keyboard-accessible percentage inputs. The actions are Retake photo (with confirmation), Reset crop (full automatically prepared frame), and Extract information. The selected PNG File is created once and used both by the preview and extraction upload, preventing preview/processing differences. The original remains available in an expandable preview and in the existing OCR review. The upload handler retains `file` as the original and uses `ocr_image` as a temporary extraction copy. Coordinate highlights from the processed image are not applied to the original.

Text orientation without EXIF requires a locally installed Tesseract with OSD data, available on PATH or via `TESSERACT_CMD`. It only rotates at orientation confidence >=12. This machine lacks that optional engine; uncertain orientation gives an upright-retake message instead of guessing. Blur and glare heuristics are advisory and can miss problems or flag a valid image. Content completeness is checked by the attorney against both sections; image heuristics cannot prove every field is present. The editor always asks for a retake if required content is cut off or obscured. Captures above 24 megapixels must be retaken at a lower resolution; manual crops have a 4096-pixel longest-side limit.

## Reproduce focused checks

From the repository root, with the existing backend environment and frontend dependencies installed:

```powershell
.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_upload_extraction tests.backend.test_camera_selected_image -v
node tests/frontend/camera_image_geometry.test.cjs
.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_camera_preparation -v
# Start Vite at http://127.0.0.1:5173, then:
.\backend\venv\Scripts\python.exe tests/frontend/camera_image_review_browser.py
```

The browser check uses Edge, Playwright, a generated fictional sheet and fake camera, real local image cleanup (orientation result stubbed), and mocked extraction/save responses. It checks crop-only controls, move/reset, retake/cancel, narrow-screen overflow, exact preview/upload bytes, original retention, and field correction/save. Screenshots are local under `.local/camera-image-review/crop-review-*.png`. Preparation tests cover faint strokes, punctuation, checkbox borders, uncertain boundaries, skew correction, confidence-gated rotation, and quality warnings. The opt-in database integration uses the real preparation endpoint, verifies selected-image handoff, then saves and reopens reviewed values with OCR stubbed and all test rows rolled back.

## Verification limits

The follow-up intake integration repair restored the missing `/pao-intakes/...` routes, the `paper_intake` upload target, dedicated extraction mapping, reviewed-record models and candidate provenance from commit `4674ae9`. These had been absent from the backend despite remaining frontend callers. A local database backup is retained under `.local/intake-repair/before-repair.dump`. Existing records and accounts are preserved.

The running API advertises the schema route and the paper upload target. Forty-one synthetic backend tests pass. An opt-in database integration check passes schema → synthetic upload → correction/save → reopen with unknown checkbox states and blank representative fields preserved. Its OCR is stubbed and its test rows are rolled back. Run with `$env:JURISGUARD_LOCAL_INTEGRATION='1'` followed by `.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_paper_api_integration -v`. The browser test also verifies recovery from a schema 404 using Retry loading intake fields without losing the selected image.

Physical camera hardware and live OCR accuracy remain unverified. Cloud transcription tests use mocked responses; no documents were sent to a cloud service. The production frontend build passes; the repository-wide typecheck has existing errors in case workflow and analytics files outside this change.

A separate real local PaddleOCR smoke run on the generated synthetic sheet returned `OFFLINE_PAPER_INTAKE`, only the two retained sections, and 141 recognized characters in 40.96 seconds including model initialization. This verifies the installed local OCR path, not handwriting accuracy or an end-to-end real-camera OCR save. No cloud calls were used.
