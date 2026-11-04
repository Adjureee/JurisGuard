# JurisGuard tests

Run from the repository root with the backend environment:

```powershell
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -t . -p 'test_*.py' -v
```

`tests/backend/` covers application OCR and extraction. `tests/lab/` covers the isolated OCR and NLP comparison candidates. Root-level `test_*.py` files cover routing and offline integration. All committed fixtures are synthetic.

The other root-level Python files are manual smoke checks. In particular, `legacy_ownership_smoke.py` requires an isolated disposable database and is intentionally outside default test discovery.

`paper_repeatability.py --synthetic --runs 3` runs real local OCR repeatedly and writes private results under `.local/`. `--scan <path>` tests an unchanged local scan. Cloud testing requires explicit `--mode cloud --synthetic --allow-cloud`; it never uploads private `--scan` files or counts a local fallback as a cloud prediction. See `docs/pao_ocr_pipeline_audit.md` for the measured results and limits.

# Camera scanner browser smoke test

With Vite running on port 5173 and Playwright installed in the backend virtual environment, run `backend/venv/Scripts/python.exe tests/frontend/camera_browser_smoke.py`. It mounts the actual scanner with two synthetic camera streams, verifies preview, switching, capture, retake, cleanup, and error states, and writes only synthetic artifacts to ignored `.local/camera-audit/`.
