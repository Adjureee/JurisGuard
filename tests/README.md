# JurisGuard tests

Run from the repository root with the backend environment:

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -t . -p 'test_*.py' -v
```

`tests/backend/` covers application OCR and extraction. `tests/lab/` covers the isolated OCR and NLP comparison candidates. Root-level `test_*.py` files cover routing and offline integration. All committed fixtures are synthetic.

The other root-level Python files are manual smoke checks. In particular, `legacy_ownership_smoke.py` requires an isolated disposable database and is intentionally outside default test discovery.
