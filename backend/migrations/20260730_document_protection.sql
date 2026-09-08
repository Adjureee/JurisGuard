-- Apply with psql against the intended JurisGuard PostgreSQL database.
-- The application also has compatibility checks for these additive columns.
BEGIN;

ALTER TABLE document ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255);
ALTER TABLE document ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER;
ALTER TABLE extracted_metadata ADD COLUMN IF NOT EXISTS verification_notes TEXT;

COMMIT;
