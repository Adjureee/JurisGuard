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
VITE_API_BASE_URL=http://localhost:8000/api
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

Profile images at `/uploads/profiles/{filename}` require an approved bearer token and are available only to their owner or an administrator. Uploaded legal documents in `UPLOAD_DIR` are not served publicly. Ensure reverse proxies/CDNs never serve `UPLOAD_DIR` directly; old publicly cached copies should be purged by the operator. Sign out using `POST /api/auth/logout` before deleting the browser token; the digest of that token is persisted in PostgreSQL until the token expires. A disconnected browser cannot revoke its token until the API is reachable.

On deployment, back up PostgreSQL and run the backend once with a migration-capable DB user. `ensure_schema_compatibility()` adds nullable `client.created_by_user_id` and the revocation table without deriving ownership from audit records or interviewers. Newly created clients get a server-recorded creator. Existing interviewer links continue to grant access to their client/case records, but **do not establish creation ownership**. An active, approved administrator can open `/admin/ownership` or inspect `GET /api/admin/clients/unresolved-owners` with an admin bearer token; the list contains client identifiers/names, creation dates, interviewer context, and linked case IDs. Investigate independent, trusted records before choosing an active, approved staff owner and supplying a reason and an internal evidence reference (not document contents). `POST /api/admin/clients/{client_id}/resolve-owner` makes a one-time row-locked ownership change and server-generated audit entry in the same transaction; a competing or repeated resolution returns 409. Never infer ownership solely from an audit entry. After rollout, review unresolved records and confirm staff access for each decision. For rollback, back up the database first; stop the app, restore the backup or use a reviewed transactional correction that records the original and corrected values in an external incident record—do not delete or rewrite the server audit trail. Reverting application code alone does not undo recorded ownership. Verify with the disposable `tests/test_legacy_ownership.py` and `tests/ownership_resolution_api.py` fixtures before deploying. See [real-document evaluation instructions](docs/real_document_evaluation.md) for accuracy measurement; no real-document score is available yet.

For local offline operation, preinstall the Python/Node dependencies and OCR models while connected, set `DATABASE_URL` to a running local PostgreSQL database, set `FRONTEND_ORIGIN` and `VITE_API_BASE_URL` to loopback origins, and leave `VITE_LEAFLET_TILE_URL` unset unless pointing to a local tile server. Start the API from `backend/` and the Vite frontend from `frontend/`; sign in and check clients, cases, intake uploads, submissions, review, and analytics. Then physically disconnect or firewall-block **all external** interfaces/egress for both browser and backend while allowing loopback, reload each workflow, and inspect DevTools Network (including image, font, and tile requests) and the API logs. Verify the analytics warning, markers, and a heat layer using cases with valid coordinates; repeat uploads with cached OCR models. Record every blocked request and failing workflow. **Whole-device offline validation remains BLOCKED** until this OS/network isolation procedure is performed. The process-level API socket guard and browser XHR/fetch interception used in synthetic tests are not equivalent to an OS firewall; unknown browser subresource requests and third-party integrations may behave differently.

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

By default the frontend expects the API at `http://127.0.0.1:8000/api` (controlled by `VITE_API_BASE_URL`).

## Tests

- There is a small test script `backend/test_spacy_extractor.py` used for NLP/OCR extractor experiments. Run it inside the backend virtualenv.
- The standard-library inventory routing MVP and its test command are documented in [docs/inventory_mvp.md](docs/inventory_mvp.md).
- The local PaddleOCR-to-inventory pipeline, PDF support, and single-file test commands are documented in [docs/offline_extraction_testing.md](docs/offline_extraction_testing.md).

## Contributing

- Open an issue or submit a pull request. Follow repository conventions for branches and PRs.

## Notes and Tips

- Uploaded files are stored in the `uploads/` directory — ensure this folder is writable by the backend service.
- If you plan to enable PaddleOCR GPU or Mistral AI backends, provide relevant API keys and hardware support, and review `backend/ai_service.py` for integration details.

## License

This repository does not include a license file. Add a `LICENSE` if you intend to publish under a specific license.

---

Created by the project maintainers — see the code in `backend/` and `frontend/` for implementation details.
