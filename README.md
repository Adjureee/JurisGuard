# JurisGuard

JurisGuard is an open-source case intake and document processing platform with a FastAPI backend and a Vite + React (TypeScript) frontend. It includes OCR/document processing helpers, a PostgreSQL-backed database, and simple user/role management.

## Key Features

- Document upload and extraction (PaddleOCR + custom services)
- Case and client intake workflows
- User authentication and role-based access (FastAPI)
- Frontend dashboard built with React + Vite + TypeScript

## Repository Layout

- `backend/`: FastAPI server, database models and OCR/AI integration
- `frontend/`: Vite + React (TypeScript) SPA
- `uploads/`: runtime storage for uploaded files
- `form.html`, `formex.html`, `live_scanner.py`: auxiliary tools and examples

## Prerequisites

- Python 3.10+ (or compatible)
- Node.js 18+ and npm/yarn for frontend
- PostgreSQL database

## Environment

Create a `.env` file in the project root or the `backend/` folder (the backend uses `python-dotenv`) and set at minimum:

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/jurisguard
FRONTEND_ORIGIN=http://localhost:5173
UPLOAD_DIR=uploads
SECRET_KEY=change-me
VITE_API_BASE_URL=http://localhost:8000
```

There are additional optional settings used by the OCR and services (PaddleOCR, Mistral keys, etc.). Check the existing `.env` in this workspace for full examples.

## Backend — run locally

1. Create and activate a virtual environment:

```bash
python -m venv .venv
source .venv/Scripts/activate   # Windows: .venv\Scripts\activate
```

2. Install dependencies:

```bash
pip install -r backend/requirements.txt
```

3. Ensure `DATABASE_URL` is reachable and `.env` is configured, then run the API:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

The backend mounts an uploads static route at `/uploads` (served from the folder configured by `UPLOAD_DIR`).

## Frontend — run locally

1. From the `frontend/` folder install packages:

```bash
cd frontend
npm install
```

2. Start the dev server:

```bash
npm run dev
```

By default the frontend expects the API at `http://localhost:8000` (controlled by `VITE_API_BASE_URL`).

## Tests

- There is a small test script `backend/test_spacy_extractor.py` used for NLP/OCR extractor experiments. Run it inside the backend virtualenv.

## Contributing

- Open an issue or submit a pull request. Follow repository conventions for branches and PRs.

## Notes and Tips

- Uploaded files are stored in the `uploads/` directory — ensure this folder is writable by the backend service.
- If you plan to enable PaddleOCR GPU or Mistral AI backends, provide relevant API keys and hardware support, and review `backend/ai_service.py` for integration details.

## License

This repository does not include a license file. Add a `LICENSE` if you intend to publish under a specific license.

---

Created by the project maintainers — see the code in `backend/` and `frontend/` for implementation details.
