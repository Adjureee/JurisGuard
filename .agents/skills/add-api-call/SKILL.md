---
name: add-api-call
description: >-
  Add or revise a JurisGuard frontend API request through the existing typed
  service layer. Use when calling local FastAPI backend routes from the React
  frontend, including document upload, intake, dashboard, messaging, and case
  workflows.
---

# Add a JurisGuard API Call

1. **Locate the Backend Route & Schema**:
   - Check the domain router in `backend/routers/` (`admin.py`, `cases.py`, `dashboard.py`, `imports.py`, `intakes.py`, `messaging.py`, `reminders.py`, `submissions.py`, `transfers.py`) or `backend/main.py` (auth, audit logs, upload).
   - Check the request/response Pydantic models in `backend/schemas.py` before writing the frontend caller.
2. **Use the Typed Service Layer**:
   - Add or update the request in `frontend/src/services/` (e.g., `casesService.ts`, `paoIntakeService.ts`, `messagingService.ts`, `caseTransferService.ts`) using `apiClient` from `frontend/src/api/client.ts` so base URL, HTTPS same-origin proxy behavior, and bearer token headers stay consistent.
3. **Preserve Offline & Privacy Guarantees**:
   - Type the response in `frontend/src/types/` or the service module, handle failed/aborted requests in the UI, and never log legal documents, OCR transcripts, or credentials.
   - Keep workflows on the local FastAPI backend; do not introduce mandatory third-party cloud APIs.
4. **Verify**:
   - Run `npm run lint`, `npm run typecheck`, and `node --test tests/frontend/*.test.cjs` from the repository root, plus relevant backend tests in `tests/backend/`.
