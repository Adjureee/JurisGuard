# Private real-document evaluation (not yet run)

**Status: BLOCKED.** No verified, de-identified English/Tagalog PAO Interview Sheets or RTC Decisions with independently reviewed labels were provided. Existing synthetic fixtures establish wiring only, **not** real-document accuracy. Never commit legal images, OCR transcripts, predictions, or ground truth. `jurisguard-extraction-lab/data/real_evaluation/` is ignored by Git. Obtain legal authorization and remove names, identifiers, case numbers and other personal data from both image and transcript *before* testing; preserve a private mapping only under your institution's policy.

Collect at least one sample of each `pao_english`, `pao_tagalog`, and `rtc_decision`, including poor scans, missing fields, ambiguous checkboxes, multiple accused, and readable handwriting (a sample may cover several scenarios). Record sampling method and counts by document type/quality so the report is not mistaken for population accuracy. Independently transcribe the entire readable image (`reference_text`) and review the exact 21-field `inventory` against the image; use null for genuinely absent/indeterminate values. Double-review disputed checkboxes and multiple accused rather than silently choosing one. RTC fields unsupported by the current 21-field PAO schema remain null and require a separate RTC-specific benchmark for comprehensive decision extraction.

Create `data/real_evaluation/manifest.json` (paths relative to that file):

```json
{
  "dataset_origin": "real_deidentified",
  "samples": [{
    "sample_id": "E01", "kind": "pao_english",
    "scenarios": ["poor_scan", "missing_fields"],
    "image": "E01.png", "image_sha256": "64-character SHA-256 of E01.png",
    "reference": "E01.reference.json", "prediction": "E01.prediction.json",
    "reviewed_against_image": true, "deidentified_confirmed": true
  }]
}
```

Reference JSON must contain `reference_text` (independent manual transcript) and `inventory` (all 21 keys; see the **synthetic schema example** in `data/synthetic/synthetic_intake.json`). Prediction JSON must contain `raw_text` (actual saved offline OCR text) and `inventory` (the unedited output of the same offline pipeline), with all 21 keys. Generate predictions with `backend/ai_service.py` in offline mode and map them through `backend/extraction_mapping.py` to obtain `raw_text` and `inventory` from the **same** run. The `backend/extract_one.py` command prints only the inventory (not raw OCR text), so its stdout alone is insufficient for this scorer. For example, from the repository root run `backend/venv/Scripts/python.exe -c "import sys,json; sys.path.insert(0,'backend'); from ai_service import process_document; from extraction_mapping import public_extraction_payload; r=public_extraction_payload(process_document(sys.argv[1],extraction_mode='offline')); print(json.dumps({'raw_text':r['raw_text'],'inventory':r['inventory']},ensure_ascii=False))" jurisguard-extraction-lab/data/real_evaluation/E01.png > jurisguard-extraction-lab/data/real_evaluation/E01.prediction.json` (adjust the image and output paths). Do not paste real OCR output into a terminal, chat, or tracked file. Calculate each image hash with `Get-FileHash -Algorithm SHA256` and record it without storing identifying filenames outside the private directory. Do not mark an OCR draft as independent reference. Keep empty/incorrect predictions: failures count.

From `jurisguard-extraction-lab/` run:

```powershell
..\backend\venv\Scripts\python.exe -m src.real_document_evaluation data\real_evaluation\manifest.json --output data\real_evaluation\report.json
```

The scorer refuses missing/changed images, duplicate IDs, unreviewed or non-deidentified samples, and wrong field sets. It reports per-sample counts, kind/scenario coverage and gaps, micro CER/WER (Levenshtein edits / reference characters or words), per-field and micro precision (`TP/(TP+FP)`), recall (`TP/(TP+FN)`), and exact-match accuracy over all 21 fields including nulls. Wrong non-null values count as **both** FP and FN. Zero denominators are `null`, not invented 100% scores. Reports contain no raw text or field values. Compare by document type/scenario; report sample counts and uncertainty, and do not extrapolate from synthetic tests.
