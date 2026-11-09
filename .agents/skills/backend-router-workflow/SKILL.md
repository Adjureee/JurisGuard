---
name: backend-router-workflow
description: >-
  Add, modify, or debug FastAPI endpoints, Pydantic schemas, and domain routers
  in the JurisGuard backend. Use when working on backend/main.py,
  backend/schemas.py, backend/bootstrap.py, or backend/routers/*.py.
---

# JurisGuard Backend Router Workflow

## Architecture Overview

- `backend/main.py`: FastAPI app setup, authentication/MFA, audit log helpers, core case/client serialization helpers, and router registration.
- `backend/schemas.py`: Pydantic request/response payload models and `paper_compat_text`.
- `backend/bootstrap.py`: Database schema compatibility (`ensure_schema_compatibility`), holiday seeding (`seed_calendar_holidays`), role seeding (`seed_roles`), and barangay coordinates (`BARANGAY_CENTROIDS`).
- `backend/routers/`: Domain route modules registered via `register_*_routes(app, ...)`:
  - `admin.py` (`/api/admin/*`)
  - `cases.py` (`/api/clients*`, `/api/cases*`, `/api/printable-intake/*`)
  - `dashboard.py` (`/api/dashboard/*`)
  - `imports.py` (`/api/case-imports*`)
  - `intakes.py` (`/api/pao-intakes*`)
  - `messaging.py` (`/api/messages*`)
  - `reminders.py` (`/api/reminders*`, `/api/holidays`)
  - `submissions.py` (`/api/case-submissions*`)
  - `transfers.py` (`/api/case-transfers*`)

## Critical Compatibility Rules

1. **Preserve AST-Inspected Symbols in `backend/main.py`**:
   - Unit tests (`test_authentication.py`, `test_analytics_ranges.py`, `test_classification_evidence.py`, `test_upload_extraction.py`) parse `backend/main.py` using `ast.parse` and extract top-level functions/classes by name.
   - Keep `TokenResponse`, `MfaSetupResponse`, `MfaVerifyPayload`, auth functions (`hash_password`..`admin_user`), analytics date-range helpers (`case_date_column`..`dashboard_case_categories`), `get_client_payload`, `case_participant_payload`, and `upload_document` as top-level definitions in `backend/main.py`.
2. **Preserve Test Dependency Overrides & Mocking**:
   - Domain routers must receive `get_db`, `current_user`, and `admin_user` from `backend/main.py` so `main.app.dependency_overrides[main.current_user]` and `main.app.dependency_overrides[main.get_db]` work in integration tests.
   - `routers/intakes.py` resolves `extract_document` via `get_extract_document=lambda: extract_document` so `unittest.mock.patch.object(main, 'extract_document', ...)` intercepts OCR calls during tests.

## Verification Steps

1. Run the backend unit & integration test suite:
   ```powershell
   .\backend\venv\Scripts\python.exe -m unittest discover -s tests/backend -t . -p 'test_*.py'
   ```
2. Verify all 91 routes register cleanly on `main.app`.
