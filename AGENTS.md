# JurisGuard agent context

JurisGuard is an offline-first legal intake and case archiving project for Philippine Public Attorney's Office workflows. It uses local OCR and document-specific extraction to help staff review PAO interview sheets and court decisions. Extracted values require human review before they are treated as case records.

## Tech stack

- `backend/`: Python, FastAPI, SQLAlchemy, PostgreSQL, PaddleOCR, and optional spaCy integration.
- `frontend/`: React, TypeScript, Vite, Axios, and Tailwind CSS.
- `jurisguard-extraction-lab/`: isolated OCR and NLP experiments with synthetic committed fixtures and private real-document annotations.

## Project structure

- `backend/main.py`: API routes; `backend/ai_service.py` and `backend/local_ocr.py`: document processing and local OCR; `backend/inventory_mvp/`: inventory routing and schema.
- `frontend/src/components/` and `frontend/src/features/`: shared and feature UI; `frontend/src/api/client.ts` and `frontend/src/services/`: API client and service functions.
- `tests/` and `jurisguard-extraction-lab/tests/`: backend and extraction tests.
- `docs/`: implementation and testing notes. `uploads/`, `test_images/`, and lab ground truth/output folders contain local or generated material and are excluded from Git.

## Run locally

- Install Python dependencies with `python -m pip install -r backend/requirements.txt`; configure a local PostgreSQL database and the variables described in `README.md` and `.env.example`.
- Start the backend from `backend/` with `uvicorn main:app --reload --host 127.0.0.1 --port 8000`.
- In `frontend/`, run `npm ci`, then `npm run dev`. Run `npm run typecheck` and `npm run build` to validate frontend changes.
- For extraction experiments, follow `jurisguard-extraction-lab/README.md` and run `python -m unittest discover -s tests -v` from that lab directory. Install or pre-cache OCR engines and models before an offline run.

## Coding conventions

- Keep OCR text, evidence, and diagnostics separate from the exact PAO Inventory dictionary. Preserve source text; do not invent missing values or infer legal status, representation, gender, or checkbox state.
- Keep local processing paths usable without cloud calls. Changes to external-service modes must remain explicit and configurable.
- Use existing frontend `apiClient` and service modules for API requests. Keep authentication and error handling consistent with existing code.
- Never commit real legal documents, OCR transcripts, credentials, or generated outputs. Use clearly labeled synthetic fixtures in tests and docs.
- Make focused changes and run the relevant tests. Report what was actually verified and what remains untested.
