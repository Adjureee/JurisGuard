# Architecture/diagram synchronization checklist

The diagram source format is not established in this repository, so this checklist is the required update scope rather than a regenerated diagram.

- ERD: derive from `backend/models.py` and include `case_client`, `case_submission`, `case_submission_item`, `submission_feedback`, `document`, `extracted_metadata`, and `audit_log`. Document fields now include protected-store path, original filename, and byte count; staged metadata includes verification status, verifier, timestamp, and notes.
- DFD: show authenticated users, manual/local image capture, the authenticated upload API, encrypted protected document store, PostgreSQL metadata, OpenCV/PaddleOCR/spaCy/Regex offline path, conditional authorized Mistral fallback, staging metadata, human verification, canonical client/case entry, cross-cutting audit log, and optional exports. Do not show Excel as an operational database.
- Architecture: show AES-256-GCM document encryption only when `DOCUMENT_ENCRYPTION_KEY` is configured. Do not claim HTTPS termination, pgcrypto use, completed backups, or cloud policy administration tables; those are not implemented here.
- Preprocessing: default production preprocessing is crop plus histogram equalization (`fast_prepare_ocr_image`); enhanced CLAHE/bilateral/morphology preprocessing is opt-in through `PADDLEOCR_ENHANCED_PREPROCESS`; webcam perspective correction is confined to `live_scanner.py`. spaCy production mapping is `spacy.blank("xx")` with EntityRuler/Matcher plus Regex, not a trained statistical PERSON/LOCATION model.
