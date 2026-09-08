param(
    [string]$Destination = $env:JURISGUARD_BACKUP_DIR,
    [int]$RetentionDays = 30
)

if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required." }
if (-not $Destination) { throw "JURISGUARD_BACKUP_DIR is required." }

$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $destinationPath "jurisguard-$timestamp.dump"

# pg_dump uses DATABASE_URL; credentials are not written to this script or command history.
pg_dump --format=custom --file=$backupPath $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash
Set-Content -LiteralPath "$backupPath.sha256" -Value "$hash  $([IO.Path]::GetFileName($backupPath))"
Get-ChildItem -LiteralPath $destinationPath -Filter "jurisguard-*.dump" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force

Write-Output "Database backup created: $backupPath"
Write-Output "Uploaded legal documents are excluded; back up DOCUMENT_STORE_DIR separately with its access controls."
