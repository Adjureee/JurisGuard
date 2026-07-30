# Architecture Synchronization — Documentation Change Checklist

Generated from repository inspection on 2026-07-30. Each item lists the documentation
claim that must be updated, the inspected reality, and the required correction.

---

## ERD (Entity Relationship Diagram)

- [ ] Regenerate from the actual SQLAlchemy models in `backend/models.py`
- [ ] Include all 17 tables: `role`, `user`, `client`, `client_classification`, `client_details`, `intake_record`, `case_nature`, `court_branch`, `case`, `case_client`, `case_history`, `representative`, `adverse_party`, `document`, `extracted_metadata`, `audit_log`, `case_submission`, `case_submission_item`, `submission_feedback`
- [ ] `document` table: includes `encrypted_file_path`, `original_filename`, `file_size_bytes`, `uploaded_by`, `ocr_status`
- [ ] `extracted_metadata` table: includes `verification_status`, `verified_by`, `verified_at`, `verification_notes`, `extracted_json` (JSONB)
- [ ] `audit_log` table: includes `extraction_mode`, `fallback_reason`, `previous_hash`, `current_hash` (SHA-256 hash chain)

## DFD (Data Flow Diagram)

- [ ] Show authenticated users (JWT bearer token via `current_user` dependency)
- [ ] Show local image upload flow: Frontend → `POST /api/upload-document/` → `store_encrypted_upload()` → `DOCUMENT_STORE_DIR`
- [ ] Show PostgreSQL metadata storage: `document` + `extracted_metadata` tables
- [ ] Show offline OCR/NLP as the primary path: OpenCV preprocessing → PaddleOCR → spaCy/Regex
- [ ] Show conditional authorized cloud fallback: requires `fallback_eligible AND cloud_policy_enabled AND cloud_authorized AND cloud_approved`
- [ ] Show staging extraction: raw results stored as `extracted_json` with `verification_status = PENDING`
- [ ] Show human verification: `PENDING → VERIFIED/REJECTED` via `/api/documents/{id}/verification`
- [ ] Show audit logging as a cross-cutting concern: `write_audit()` with SHA-256 hash chain
- [ ] Show optional exports (live_scanner Excel) as a separate, non-operational path

## System Architecture Diagram

- [ ] **Remove pgcrypto claim**: The system uses application-level AES-256-GCM encryption via Python `cryptography` library, not PostgreSQL pgcrypto
- [ ] **Remove HTTPS termination claim**: HTTPS is not implemented at the application level (would require a reverse proxy like nginx)
- [ ] **Password hashing**: Document as bcrypt (12 rounds) with legacy PBKDF2-SHA256 backward compatibility
- [ ] **Static file mount**: Only `/uploads/profiles` is publicly served; legal documents are in a separate `DOCUMENT_STORE_DIR` served only through the authenticated download endpoint
- [ ] **Cloud extraction**: Label as "conditional authorized fallback," not "Mistral Primary Mode"

## spaCy / NLP Documentation

- [ ] Document that production extraction uses `spacy.blank("en")` with deterministic Matcher patterns and Regex rules
- [ ] Do NOT describe it as a trained statistical NER model (it is not)
- [ ] If a trained model is introduced in the future, add dependency setup instructions and evaluation tests

## Backup / Recovery

- [ ] Document that `scripts/backup_postgres.ps1` uses `pg_dump --format=custom` with SHA-256 checksums
- [ ] Document that `scripts/restore_postgres.ps1` verifies checksum before `pg_restore`
- [ ] Note that legal documents in `DOCUMENT_STORE_DIR` must be backed up separately
- [ ] Note: runtime verification of backup/restore is BLOCKED until pg_dump/pg_restore are available in the deployment environment

## Benchmark Results

- [ ] Do NOT present existing benchmark results as valid unless regenerated from a clean run with the real 30-document dataset
- [ ] Note that `benchmark_evaluator.py` correctly compares `truth_text` vs `raw_text` (not `str(extracted_data)`)
- [ ] Note that benchmark regeneration is BLOCKED without `benchmark_data/manifest.json`
