$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonPath = Join-Path $projectRoot 'backend\venv\Scripts\python.exe'
$pgCtl = Join-Path $projectRoot '.local\pgsql\bin\pg_ctl.exe'
$dataDir = Join-Path $projectRoot '.local\pgdata'
$logDir = Join-Path $projectRoot '.local\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (-not (Test-Path $pythonPath)) { throw 'Python environment missing. Complete backend setup first.' }
if (-not (Test-Path (Join-Path $projectRoot '.env'))) { throw 'Local .env configuration is missing.' }
if (-not (Test-Path $pgCtl)) { throw 'Local PostgreSQL binaries are missing.' }
& $pgCtl -D $dataDir status *> $null
if ($LASTEXITCODE -ne 0) {
    & $pgCtl -D $dataDir -l (Join-Path $logDir 'postgres.log') -w start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start. See .local\logs\postgres.log.' }
}
if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $pythonPath -ArgumentList '-m uvicorn main:app --host 127.0.0.1 --port 8000' -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'backend.log') -RedirectStandardError (Join-Path $logDir 'backend-error.log')
}
if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
    $nodePath = (Get-Command node.exe).Source
    Start-Process -FilePath $nodePath -ArgumentList 'node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort' -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'frontend.log') -RedirectStandardError (Join-Path $logDir 'frontend-error.log')
}
Write-Host 'Frontend: http://127.0.0.1:5173'
Write-Host 'API health: http://127.0.0.1:8000/health'
Write-Host 'Startup logs: .local\logs (allow a few seconds for the API to start)'
