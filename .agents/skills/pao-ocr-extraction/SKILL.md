---
name: pao-ocr-extraction
description: >-
  Develop, debug, or evaluate JurisGuard's offline-first OCR and PAO document
  extraction pipeline. Use when working on backend/local_ocr.py,
  backend/ai_service.py, backend/pao_paper_intake.py,
  backend/routers/intakes.py, or jurisguard-extraction-lab/.
---

# PAO OCR & Document Extraction Workflow

## Non-Negotiable Domain Rules

1. **Never Invent or Infer Legal Facts**:
   - Keep raw OCR text, bounding-box evidence, and diagnostics strictly separate from the PAO Inventory dictionary.
   - Preserve source text verbatim. Never invent missing values or infer legal status, representation, gender/sex, or checkbox state when evidence is ambiguous or unreadable.
   - Unreviewed or low-confidence fields must remain explicit in `unreadable_fields` / `field_reviews` until confirmed by human staff.
2. **Offline-First Execution**:
   - Local PaddleOCR + optional spaCy pipelines must work without internet access.
   - Any external/cloud OCR fallback (e.g., Mistral/Groq) must remain explicit, configurable via environment variables, and gracefully fall back when offline.
3. **Strict Data Privacy**:
   - Never commit real PAO interview sheets, court decisions, client names, OCR transcripts, or generated outputs.
   - Use only clearly labeled synthetic fixtures in `tests/` and `jurisguard-extraction-lab/data/synthetic/`.

## Key Files

- `backend/local_ocr.py`: Local PaddleOCR engine, image preprocessing, crop/perspective handling, and layout region extraction.
- `backend/pao_paper_intake.py`: Structured PAO interview sheet field/checkbox extraction, evidence mapping, and review validation.
- `backend/ai_service.py`: Extraction runtime coordinator, concurrency guard, timeout handling, and local/cloud pipeline routing.
- `backend/routers/intakes.py`: `/api/pao-intakes/*` endpoints for camera preparation, page rendering, re-extraction, and saving reviewed paper intakes.

## Verification Steps

1. Run the backend OCR and paper intake tests:
   ```powershell
   .\backend\venv\Scripts\python.exe -m unittest discover -s tests/backend -t . -p 'test_*.py'
   ```
2. Run the extraction lab test suite:
   ```powershell
   .\backend\venv\Scripts\python.exe -m unittest discover -s tests/lab -t . -p 'test_*.py'
   ```
