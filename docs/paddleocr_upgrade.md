# PaddleOCR 3.7 upgrade check

**Date:** 19 October 2026 (Asia/Singapore)

## Change

JurisGuard's application and extraction lab now target PaddleOCR 3.7.0 with PaddlePaddle 3.3.1 and local PP-OCRv6 medium detection and recognition models. The application adapter uses PaddleOCR 3.x `predict()` output and preserves separate text lines, rectangular boxes, and engine scores for the router. It checks both model directories before initialization and disables optional orientation and rectification models. CPU oneDNN is disabled because inference with oneDNN failed on this Windows machine. No real document or annotation was added to Git.

The manuscript's earlier PaddleOCR 2.8.1 / PP-OCRv4 observations remain historical; this upgrade does not recalculate them.

## Checks actually run

| Check | Observed result |
| --- | --- |
| Isolated install and import | PaddleOCR 3.7.0 and PaddlePaddle 3.3.1 imported successfully |
| Real local PP-OCRv6 inference on committed synthetic intake image | Four OCR lines; router classified `intake_form` and extracted `Ana Reyes`, `09170001234`, and `12 Mabini Street` |
| Lab end-to-end synthetic image and reviewed synthetic fixture | Classification matched; 21 inventory fields matched; synthetic CER 0 and WER 0 |
| Consolidated Python suite in upgraded backend environment | 70 tests passed; included synthetic English intake, Tagalog intake, and RTC image OCR |
| New lab adapter regression, run after full-suite discovery | 4 `tests.lab.test_ocr` tests passed |
| `pip check` in backend environment | No broken requirements after aligning the optional OpenCV headless package with NumPy 1.26 |
| Socket-blocked real synthetic image OCR | Four lines produced with `socket.socket.connect` and `socket.create_connection` blocked |

The first PP-OCRv6 Windows inference attempt failed in PaddlePaddle's oneDNN code. Repeating with `enable_mkldnn=False` succeeded. This setting may increase CPU inference time. The full suite took about 350 seconds because it initialized the medium models for several image tests.

## Limits and next check

These are synthetic tests. They do not establish handwritten-field accuracy, legal-document accuracy, or a new CER/WER for the 20 private court images. Re-run the three OCR candidates on the same human-transcribed real images before updating capstone comparison tables. A live FastAPI/PostgreSQL upload was not exercised in this upgrade check.

Run the local suite from the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m pip check
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -t . -p 'test_*.py' -q
```

Model file checks and single-image commands are in [offline_extraction_testing.md](offline_extraction_testing.md).
