---
name: add-api-call
description: Add or revise a JurisGuard frontend API request through the existing typed service layer. Use for calls to the local FastAPI backend, including document upload and case workflows.
---

# Add a JurisGuard API call

1. Confirm the backend route and its request and response shape in `backend/main.py` before writing the caller. If a route is required, implement it with validation and appropriate authentication.
2. Add the frontend request to the relevant module in `frontend/src/services/`, using `frontend/src/api/client.ts` so base URL and authentication behavior stay consistent.
3. Type the response, handle failed requests in the UI, and avoid logging legal documents or credentials. Keep offline workflows on the configured local backend; do not introduce a mandatory third-party API.
4. Run relevant backend tests and `npm run typecheck` from `frontend/`. State which checks actually ran.
