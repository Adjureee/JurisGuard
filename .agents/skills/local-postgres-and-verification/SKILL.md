---
name: local-postgres-and-verification
description: >-
  Start the portable local PostgreSQL server (.local/pgsql) and run full-stack
  verification across backend, extraction lab, live database endpoints, and
  frontend checks. Use whenever verifying changes end-to-end or testing against
  PostgreSQL.
---

# Local PostgreSQL & Full-Stack Verification Runbook

## Portable PostgreSQL Server (`127.0.0.1:5432/jurisguard`)

JurisGuard includes a local portable PostgreSQL binary in `.local/pgsql/bin/pg_ctl.exe` with data directory `.local/pgdata`.

Because each PowerShell tool call runs in an isolated process session, start PostgreSQL, run your database verification, and stop PostgreSQL cleanly **within the same command block**:

```powershell
.\.local\pgsql\bin\pg_ctl.exe start -D .\.local\pgdata -l .\.local\logs\postgres.log -w; try {
    $env:PYTHONPATH="backend"
    .\backend\venv\Scripts\python.exe -c "import main; from fastapi.testclient import TestClient; client = TestClient(main.app); r = client.get('/health'); print(r.status_code, r.json()); assert r.status_code == 200"
    .\backend\venv\Scripts\python.exe -m unittest discover -s tests/backend -t . -p 'test_*.py'
} finally {
    .\.local\pgsql\bin\pg_ctl.exe stop -D .\.local\pgdata -m fast
}
```

## Full Verification Matrix

1. **Backend Unit & API Integration Tests (`174` tests)**:
   ```powershell
   .\backend\venv\Scripts\python.exe -m unittest discover -s tests/backend -t . -p 'test_*.py'
   ```
2. **Extraction Lab Tests (`33` tests)**:
   ```powershell
   .\backend\venv\Scripts\python.exe -m unittest discover -s tests/lab -t . -p 'test_*.py'
   ```
3. **Frontend Contract Tests (`43` tests)**:
   ```powershell
   node --test tests/frontend/*.test.cjs
   ```
4. **Frontend Lint, Typecheck & Production Build**:
   ```powershell
   cd frontend; npm run lint; npm run typecheck; npm run build
   ```
