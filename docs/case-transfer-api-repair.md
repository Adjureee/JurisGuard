# Case Transfer 404 repair

The frontend requests `/api/case-transfers`, `/attorneys`, `/cases` and the report-specific draft/submit/return/confirm routes. The corresponding API handlers were removed by commit `5e2a3fb`, although the frontend and database models remained. This caused HTTP 404 before the page could load reports or attorneys.

The transfer-specific payloads, handlers, permission helpers and local notification writer were restored from the pre-revert version (`773d8b1`). Existing case and export changes were retained. Staff candidate-case queries explicitly restrict the assigned transferring attorney; report lists include case items so their displayed counts are correct. Receipt confirmation rechecks termination and assignment before changing ownership. Drafts and pending reports do not change assignments.

Verification:

```powershell
$env:JURISGUARD_LOCAL_INTEGRATION='1'
.\backend\venv\Scripts\python.exe -B -m unittest tests.backend.test_case_transfer_api tests.backend.test_case_transfer_permissions -v
```

The integration test uses temporary fictional users and a case inside a transaction with savepoints. It covers attorney/case/report loading, administrator-created draft, source-only submission, unauthorized access, pending-transfer collision, correction, resubmission, recipient-only confirmation, assignment eligibility, accurate report item counts and reopening. All test rows are rolled back. No real case is transferred and no external notifications are sent. Authentication dependencies are overridden only within the test; actual unauthenticated API requests still receive 401.

The running backend must be restarted or use Uvicorn `--reload` to register the restored routes. A legitimate report-specific 404 remains appropriate when a report is missing or inaccessible. The attorney selector requires active approved staff accounts, and the source and recipient must differ.
