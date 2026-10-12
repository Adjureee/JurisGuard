# Local OCR → inventory testing

Run these commands in **PowerShell** from the JurisGuard repository root. Direct extraction does not start FastAPI or connect to the production database.

## 1. Check the local runtime

```powershell
cd C:\Users\Adjureee\Documents\GitHub\JurisGuard
.\backend\venv\Scripts\python.exe -c "import paddle, paddleocr; print('PaddlePaddle', paddle.__version__, 'PaddleOCR', paddleocr.__version__)"
```

This implementation uses the installed PaddleOCR **2.8.1** API and was verified with PaddlePaddle **2.6.2**. `backend/requirements.txt` constrains PaddlePaddle to version 2.x. To create a fresh environment, run `python -m venv backend\venv` followed by `.\backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt`. Installation may use the network; extraction does not.

PaddleOCR needs complete, already installed local detection, recognition, and classifier model directories. Defaults are under `%USERPROFILE%\.paddleocr\whl\`. Check them:

```powershell
Test-Path "$env:USERPROFILE\.paddleocr\whl\det\en\en_PP-OCRv3_det_infer\inference.pdmodel"
Test-Path "$env:USERPROFILE\.paddleocr\whl\rec\en\en_PP-OCRv4_rec_infer\inference.pdmodel"
Test-Path "$env:USERPROFILE\.paddleocr\whl\cls\ch_ppocr_mobile_v2.0_cls_infer\inference.pdmodel"
```

Each should print `True`. To use other already installed models, set `PADDLEOCR_DET_MODEL_DIR`, `PADDLEOCR_REC_MODEL_DIR`, and `PADDLEOCR_CLS_MODEL_DIR` to their absolute directory paths. The adapter checks model files before construction to prevent implicit downloads. If PaddleOCR fails and Tesseract is installed locally, OCR uses Tesseract and records the fallback in diagnostics. Set `TESSERACT_CMD` to the executable path if it is not on `PATH` or at the standard Windows location.

## 2. Run tests in order

```powershell
Push-Location backend
.\venv\Scripts\python.exe -m unittest test_local_ocr -v
.\venv\Scripts\python.exe test_spacy_extractor.py
Pop-Location
python -m unittest discover -s tests -p test_document_router.py -v
Push-Location jurisguard-extraction-lab
python -m unittest discover -s tests -v
Pop-Location
cd frontend
npm run typecheck
cd ..
```

The backend tests cover PaddleOCR's local constructor, line/box formatting, blank and corrupt images, PDF rendering, offline routing, and JSON payload mapping. The legacy spaCy test uses a synthetic form with explicit checkbox marks. The router and lab suites cover both intake forms and RTC decisions. The frontend type check requires `npm install` once if dependencies are missing.

## 3. Process one image or PDF

This synthetic fixture is invented for testing:

```powershell
.\backend\venv\Scripts\python.exe backend\extract_one.py jurisguard-extraction-lab\data\synthetic\synthetic_intake.png
```

The command prints exactly the 21-field inventory dictionary to standard output. It prints the routed document type, OCR engine, and review flag to standard error. Replace the final path with your own `.jpg`, `.jpeg`, `.png`, `.webp`, or `.pdf` path. Keep real legal documents out of `data/synthetic/` and Git.

The script is equivalent to this minimal Python example:

```python
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path("backend").resolve()))
from ai_service import process_document
from extraction_mapping import public_extraction_payload

image = Path("jurisguard-extraction-lab/data/synthetic/synthetic_intake.png")
result = public_extraction_payload(process_document(str(image), extraction_mode="offline"))
print(json.dumps(result["inventory"], indent=2, ensure_ascii=False))
print(result["document_type"], result["needs_review"])
```

For a PDF smoke test, create a **synthetic** one-page PDF locally and process it:

```powershell
.\backend\venv\Scripts\python.exe -c "from PIL import Image; Image.open('jurisguard-extraction-lab/data/synthetic/synthetic_intake.png').convert('RGB').save('jurisguard-extraction-lab/data/outputs/synthetic_intake.pdf', 'PDF')"
.\backend\venv\Scripts\python.exe backend\extract_one.py jurisguard-extraction-lab\data\outputs\synthetic_intake.pdf
```

PDFs are rendered locally, up to `LOCAL_OCR_MAX_PAGES` (default 8). Each detected OCR line retains a page number, bounding box, and engine score in `diagnostics.ocr_layout`; the original newline-separated OCR appears in `raw_text`. Engine scores are not calibrated field confidence. Blank, corrupt, oversized, unknown, ambiguous, Sandiganbayan, or likely concatenated documents require review and do not receive invented inventory values. Sandiganbayan is a distinct routing type; its inventory mappings are still pending.

## 4. Optional API check

With a configured **test PostgreSQL database**, start the backend from `backend/` with `.\venv\Scripts\python.exe -m uvicorn main:app --reload`. Submit a document to `POST /api/upload-document/?extraction_mode=offline` using an authenticated session. The response and `ExtractedMetadata.extracted_json` include `document_type`, the exact `inventory`, `diagnostics`, `needs_review`, and legacy intake `sections`. The API does not automatically write extracted values to `Case` or `Client`; those forms require human review. Uploaded legal documents are not publicly served by the static `/uploads` route.

The direct script, OCR engines, router, and pure JSON mapping have been exercised locally. A live FastAPI/PostgreSQL upload was not run against the production database.

In the active client and case forms, a `needs_review` result displays a review notice. Unknown or ambiguous routing asks the operator to identify the document type before saving. The current forms do not yet offer a dedicated document-type correction control; resolve that workflow before treating human review as complete.
