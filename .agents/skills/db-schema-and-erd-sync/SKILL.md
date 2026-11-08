---
name: db-schema-and-erd-sync
description: >-
  Add or update SQLAlchemy database models, schema migrations, and ERD files in
  JurisGuard. Use whenever modifying backend/models.py, backend/bootstrap.py,
  JurisGuard_ERD_schema.sql, or JurisGuard ERD - updated.json.
---

# Database Schema & ERD Synchronization Workflow

Whenever adding or modifying a table or column in `backend/models.py`:

1. **Update SQLAlchemy Model (`backend/models.py`)**:
   - Define the column, foreign keys, and indexes on the model class in `backend/models.py`.
2. **Add Backward-Compatible DDL (`backend/bootstrap.py`)**:
   - Update `ensure_schema_compatibility()` in `backend/bootstrap.py` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or `CREATE index IF NOT EXISTS` so existing local PostgreSQL databases upgrade automatically on startup.
3. **Synchronize the 3 ERD Artifacts**:
   - `JurisGuard_ERD_schema.sql`: Update the `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` definitions.
   - `JurisGuard ERD - updated.json`: Synchronize the Lucidchart `ERDEntityBlock3` shapes and `lines` from `models.Base.metadata.tables`.
   - `docs/database_erd.md`: Update the Mermaid `erDiagram` block.
4. **Verify 1:1 Table Parity**:
   ```powershell
   $env:PYTHONPATH="backend"; .\backend\venv\Scripts\python.exe -c "
   import json, pathlib, re, models
   q = chr(34)
   sql_text = pathlib.Path('JurisGuard_ERD_schema.sql').read_text(encoding='utf-8')
   sql_tables = [m.strip(q) for m in re.findall(r'CREATE TABLE IF NOT EXISTS\s+([^\s(]+)', sql_text)]
   model_tables = list(models.Base.metadata.tables.keys())
   assert set(sql_tables) == set(model_tables), f'SQL Diff: {set(sql_tables) ^ set(model_tables)}'
   erd_json = json.loads(pathlib.Path('JurisGuard ERD - updated.json').read_text(encoding='utf-8'))
   json_tables = [s['textAreas'][0]['text'] for s in erd_json['pages'][0]['items']['shapes']]
   assert set(json_tables) == set(model_tables), f'JSON Diff: {set(json_tables) ^ set(model_tables)}'
   print('1:1 parity verified across all', len(model_tables), 'tables!')
   "
   ```
