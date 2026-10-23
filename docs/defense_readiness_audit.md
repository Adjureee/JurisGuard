# JurisGuard defense readiness audit

**Date:** 21 October 2026 (Asia/Singapore)
**Scope:** repository review, synthetic automated checks, and setup instructions. This is not a certification that every workflow works with the defense machine, PostgreSQL instance, camera, or real legal documents.

## Alignment with the stated capstone scope

| Requirement | Evidence in repository | Status |
| --- | --- | --- |
| Offline production OCR | Local PaddleOCR 3.7.0 / PP-OCRv6 code and pinned backend dependencies; OCR candidates stay in the isolated lab | Implemented; synthetic checks passed |
| Three OCR and three NLP comparisons | `jurisguard-extraction-lab/MANUSCRIPT_TESTING.md` defines PyTesseract, EasyOCR, PaddleOCR and NLTK rules, BERT NER, spaCy/Regex | Separate lab; no new real-world comparison run in this audit |
| PAO English/Tagalog and RTC routing | `backend/inventory_mvp/router.py` and production OCR handoff tests | Synthetic tests passed |
| Sandiganbayan | Distinct route with empty inventory and review | Routing implemented; field mapping unapproved |
| Exact PAO 21-field inventory | `backend/inventory_mvp/schema.py`, `backend/extraction_mapping.py`, synthetic tests | Contract tested; real field accuracy not measured |
| Human review | API returns `needs_review`; forms show review notice | Partial: no dedicated document-type correction control for unknown/ambiguous OCR |
| Overhead document camera | Browser camera selection, still capture, frozen review, retake, then OCR | Built; specific USB device not tested |

The existing 20-image court set is visually labeled Sandiganbayan and was used while tuning routing. Its reported label agreement is in-sample, not held-out RTC performance. The available transcripts are OCR-assisted drafts; no reviewed reference transcripts are available for CER/WER. See `jurisguard-extraction-lab/reports/decision_20_test_run.md` and `docs/real_document_evaluation.md` before presenting accuracy claims.

## Fixes made in this review

- Removed the frontend's fallback upload `user_id=1`. Upload attribution comes from the authenticated server token, not a browser query value.
- Stopped blank district office and incident city fields from becoming Panabo text in new or edited records. The `Case.incident_city` ORM default was removed, and the compatibility migration drops the existing database column default without rewriting existing rows. The migration has not been run against a live database in this review.
- Stopped unknown barangays from being plotted at Panabo City Hall. Known local barangays and explicit case coordinates remain eligible for map markers.
- Removed unreferenced mock OCR/client files, fake `CL-2026` and `CASE-2026` store creation methods, the obsolete standalone live scanner, and unreferenced database seed scripts with fixed demo account passwords. Synthetic OCR fixtures remain in the isolated lab.
- Removed fallback PostgreSQL credentials and the shared development token-signing secret. A private `SECRET_KEY` of at least 32 characters is now required. A random local value was added to the ignored root `.env`; it is not in Git.
- Corrected `setup.md` to describe the current PaddleOCR model path, `/api` frontend base URL, secure first-admin registration, and the overhead document camera flow. The old plaintext SQL password example was removed.
- Changed `Female`, `SENIOR`, and `CICL` to source-reviewed tri-state client classifications. New rows no longer default these columns to `False`; API responses mask older values without review provenance. Create/edit screens expose Yes, No, and Unresolved, and exports leave unresolved cells blank. Age and sex no longer set these classifications, and the printable `Woman` checkbox is no longer set from `Female`. Existing stored booleans are retained for audit/re-review; this review did not rewrite them.
- Removed the fixed regional and district office headings from case exports. A heading now comes from the selected records only when they agree; otherwise it is blank for staff review.

## Checks actually run

- Before the focused changes: repository backend/lab test discovery under `backend/venv` completed **84 tests, all passing**, including a synthetic image-to-PaddleOCR-to-router path. This does not measure real-document accuracy.
- After the location/configuration edits: **10 targeted backend tests passed**, including the no-default case-city regression and upload validation/extraction tests.
- After the map edit: **6 frontend Node tests passed**, including unknown-location and explicit-coordinate cases.
- Frontend `npm run typecheck`, scoped ESLint, and `npm run build` passed after the edits. Vite reported a large JavaScript chunk warning; the build still completed.
- Python `py_compile` passed for `backend/main.py`, `backend/models.py`, and `backend/database.py`.
- The direct synthetic intake image smoke command ran after the edits: PaddleOCR routed it as `intake_form`, returned the exact inventory dictionary, and left unsupported fields null. This is a synthetic wiring check.
- After the source-evidence classification change, the complete Python test discovery passed **91 tests**, including tri-state persistence/response regressions and synthetic OCR routing. The frontend Node suite passed **9 tests**, including unknown/explicit classification export cells and recorded office headings. Frontend typecheck and scoped ESLint passed; the build completed after the classification edit and was repeated after the heading change. These tests do not substitute for a live database or real-document evaluation.

The first attempt to run Python test discovery with the system `python` failed to import installed dependencies. The repository virtual environment run passed. No production database was modified for this audit.

## Separate synthetic demo account setup

On the same loopback PostgreSQL server, `backend/seed_demo_users.py --apply` created a new `jurisguard_demo` database with one approved synthetic administrator and two approved synthetic staff accounts. The configured `jurisguard` database had two users before and after seeding. A repeat `--apply --reuse-demo` run created zero accounts, confirming the seed is idempotent. All three demo accounts returned HTTP 200 from `/api/auth/token`, and `/api/auth/me` reported their expected roles through the local FastAPI test client. The seeder's three unit tests passed. Generated passwords were printed once in the local command output and are intentionally absent from this report and Git. The database includes only account fixtures, not synthetic case records or real legal documents.

## Local development database reset

At the user's direction, the existing local `jurisguard` database was treated as disposable development data. Before the reset it contained two accounts, 20 clients, 30 cases, 32 documents, and 108 audit rows. It was renamed to `jurisguard_dev_archive_20261021` for recovery. A freshly created `jurisguard_fresh` database with new approved `admin@local.test` and `staff@local.test` accounts was renamed to `jurisguard`, so the existing `.env` now points to the clean database without a URL edit. Read-only verification found two users and zero rows in every non-account application table, including clients, cases, documents, and audit logs. Both generated passwords matched the stored hashes. The API started from the repository root with `python -m uvicorn main:app --app-dir backend` and `/openapi.json` returned HTTP 200. The ignored local `.env` token-signing secret was rotated after the swap to invalidate old browser sessions that could reuse numeric user IDs. No authenticated login was performed after the swap, so the clean audit log remains empty. The one-time passwords and signing secret are not stored in this report or Git.

## Remaining blockers before claiming full defense readiness

1. **Business mappings and legacy review:** The three demographic inventory flags now require explicit staff review and preserve unresolved values. Existing client rows have no evidence provenance; their old values are hidden until reviewed in the edit screen. The PostgreSQL compatibility migration for the new review marker and dropped defaults has not run against a live database. Urban/Rural are still mapped from case location in some case/export paths; PAO reviewers should approve that mapping before treating those values as final. Other classification columns still use boolean defaults and need a separate schema decision if tri-state reporting is required for them.
2. **Case categories:** The case UI/API currently accepts Civil and Criminal; unknown backend case types normalize to Criminal. Labor, Administrative, and legal-document-only intake scenarios in the sample form need an approved workflow and schema decision.
3. **Human routing correction:** Unknown/ambiguous documents request review but the forms do not expose a dedicated document-type correction control.
4. **Real evaluation:** Obtain reviewed OCR transcripts and 21-field annotations. Run the three OCR and three NLP candidates on the same defined sample set. Do not quote synthetic tests or the 20-image in-sample court routing check as real accuracy.
5. **Device and database demonstration:** Test the actual overhead camera in the defense browser; start a disposable or approved local PostgreSQL database, register an admin, and run authenticated upload, review, save, export, and logout flows. This review did not start the API because importing it creates/updates tables in the configured database.
6. **Whole-device offline operation:** Precache models and dependencies, isolate external network egress, and repeat the workflow. Process-level tests are not an OS-level offline test.

## Local verification sequence for the defense machine

From the repository root in PowerShell:

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -t . -p 'test_*.py' -v
node --test tests/frontend/*.test.cjs
Push-Location frontend
npm run typecheck
npm run build
Pop-Location
.\backend\venv\Scripts\python.exe backend\extract_one.py jurisguard-extraction-lab\data\synthetic\synthetic_intake.png
```

Then follow `setup.md` with a private `SECRET_KEY`, an isolated local PostgreSQL database, and the actual document camera. Use clearly labeled synthetic documents for the demonstration. Record any observed API, hardware, or OCR failure instead of claiming every feature is functional from automated checks alone.
