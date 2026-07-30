# PostgreSQL backup and recovery procedure

The scripts in `scripts/` back up PostgreSQL metadata only. Uploaded legal documents are deliberately excluded: back up `DOCUMENT_STORE_DIR` separately using an access-controlled encrypted backup process, and preserve the document-encryption key through the approved secret-management process.

1. Set `DATABASE_URL` and `JURISGUARD_BACKUP_DIR` in the execution environment.
2. Run `./scripts/backup_postgres.ps1`. It creates a PostgreSQL custom-format dump and a SHA-256 checksum, then removes dumps older than the configured retention period (30 days by default).
3. For a non-production recovery drill, use a separate empty database URL and run `./scripts/restore_postgres.ps1 -BackupPath <dump> -TargetDatabaseUrl <non-production-url>`.
4. Confirm the restore command exit status, validate the checksum, run schema checks, and check a non-sensitive record count. Do not run the restore script against production without an approved change plan.

This repository does not contain evidence of a completed backup or restore drill.
