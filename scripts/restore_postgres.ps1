param(
    [Parameter(Mandatory=$true)][string]$BackupPath,
    [Parameter(Mandatory=$true)][string]$TargetDatabaseUrl
)

if (-not (Test-Path -LiteralPath $BackupPath)) { throw "Backup file not found." }
$expectedHashPath = "$BackupPath.sha256"
if (-not (Test-Path -LiteralPath $expectedHashPath)) { throw "Checksum file not found." }
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupPath).Hash
if ((Get-Content -LiteralPath $expectedHashPath -Raw).Split()[0] -ne $actualHash) { throw "Backup checksum mismatch." }

# Use only a non-production target URL. pg_restore exits non-zero on restore errors.
pg_restore --clean --if-exists --no-owner --dbname=$TargetDatabaseUrl $BackupPath
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed." }
Write-Output "Restore completed. Validate schema and a non-sensitive record count before use."
