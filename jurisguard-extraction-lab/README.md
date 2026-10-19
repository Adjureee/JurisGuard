# JurisGuard extraction lab

An isolated, offline-first experiment for image OCR, deterministic document routing, conservative PAO Inventory extraction, and ground-truth comparison. It has no production application or database imports. Synthetic fixtures are the only committed documents.

For the manuscript's **three OCR engines and three NLP pipelines**, use [MANUSCRIPT_TESTING.md](MANUSCRIPT_TESTING.md). The separate comparison runner uses one annotated manifest and does not connect to the production database.

## Layout

```text
jurisguard-extraction-lab/
  README.md  requirements.txt  config.py  .gitignore
  data/
    input/          private source images (ignored)
    ground_truth/   private annotations (ignored)
    synthetic/      committed, clearly synthetic image/text/labels
    outputs/        generated OCR, layout, results, reports (ignored)
  ocr/              private OCR experiments (ignored)
  extraction/       private extraction experiments (ignored)
  reports/          private reports (ignored)
  src/
    ocr_pipeline.py document_router.py extractors.py schema.py evaluate.py
../tests/lab/
  test_ocr.py test_nlp.py test_pipeline.py and other lab tests
```

## Setup

Use Python 3.10 or later. The default one-image lab pipeline uses **local PaddleOCR 3.7.0 / PaddlePaddle 3.3.1 with PP-OCRv6 medium models**, matching the application engine. Supply complete local detection and recognition model directories under `~/.paddlex/official_models/` or set `JURISGUARD_LAB_PADDLE_DET_MODEL` and `JURISGUARD_LAB_PADDLE_REC_MODEL`. The router and evaluation code can still run on saved OCR text without loading an OCR engine.

Tesseract and EasyOCR are **comparison candidates**, not application fallback engines. To compare Tesseract, install its local executable and `eng` data, then set `JURISGUARD_LAB_OCR_ENGINE=tesseract` and, if needed, `JURISGUARD_LAB_TESSERACT` to its executable path. Set `JURISGUARD_LAB_OCR_ENGINE=easyocr` for the EasyOCR candidate. Each comparison command in [MANUSCRIPT_TESTING.md](MANUSCRIPT_TESTING.md) selects its candidate explicitly. Tagalog and handwriting accuracy need separate evaluation. Historical 2.8.1/PP-OCRv4 figures remain historical; new PP-OCRv6 results are a separate benchmark.

From the **repository root**, run the separate suites and the complete suite:

```powershell
.\backend\venv\Scripts\python.exe -m unittest tests.lab.test_ocr -v
.\backend\venv\Scripts\python.exe -m unittest tests.lab.test_nlp -v
.\backend\venv\Scripts\python.exe -m unittest tests.lab.test_pipeline -v
.\backend\venv\Scripts\python.exe -m unittest discover -s tests -t . -p 'test_*.py' -v
```

## End-to-end synthetic example

The image, reference transcript, and full ground-truth inventory in `data/synthetic/` are invented for testing. From this folder:

```powershell
..\backend\venv\Scripts\python.exe -m src.ocr_pipeline --image data/synthetic/synthetic_intake.png --ground-truth data/synthetic/synthetic_intake.json --output-dir data/outputs/synthetic_demo
```

The command uses PaddleOCR by default and writes `ocr.txt` (the original engine text, with line boundaries), `layout.json` (line boxes and engine scores), `result.json` (`document_type`, exact `inventory`, separate `diagnostics`, `needs_review`), and `report.json` (classification and field comparison, plus CER/WER when a reference transcript exists). The default output directory is ignored by Git. The synthetic image can be regenerated with `python data/synthetic/generate_example.py` after installing Pillow; the checked-in PNG requires no image-generation dependency.

To test NLP rules directly on saved OCR text, without loading an OCR engine:

```powershell
..\backend\venv\Scripts\python.exe -m src.ocr_pipeline --ocr-text data/synthetic/synthetic_intake.txt --ground-truth data/synthetic/synthetic_intake.json --output-dir data/outputs/synthetic_text_demo
```

For private documents, place images in `data/input/` and reviewed JSON annotations in `data/ground_truth/`. Never place real documents or generated output in `data/synthetic/`. The `.gitignore` excludes the private and generated folders. Avoid copying sensitive OCR into bug reports or logs.

## Rules and review

`DocumentRouter` supports `intake_form`, `rtc_decision`, `sandiganbayan_document`, `unknown`, and `ambiguous`. Weighted, independent signal groups and configurable thresholds drive routing. Scores are raw heuristic points, not probabilities. Sandiganbayan routing returns a null-filled inventory with review required until inventory field mappings are approved. `unknown`, `ambiguous`, and likely concatenated documents also require review.

On intake forms, direct `Name`/`Pangalan` labels map to `Party Represented`; explicit contact, address, control, detention, date, and case labels can populate their corresponding fields. Only direct inventory checkbox labels (`Urban`, `Rural`, `Drugs`, `Female`, `SENIOR`, `CICL`) with readable marks become booleans. Missing or ambiguous marks remain `None`. Demographic aliases such as `Senior Citizen` are flagged because their inventory mapping is not approved. A `Gender/Sex` value never automatically sets the separate `Female` flag.

On RTC decisions, only explicit court, case number, and complete caption patterns populate fields. The accused is not assumed to be PAO's represented party. A decision or promulgation date does not establish termination. Field evidence, warnings, and review questions stay outside the 21-field inventory. Normalization uses a separate working copy; the original OCR string remains available to the caller and in `ocr.txt` when using the CLI.

`evaluate.py` validates the exact schema and reports each field as `match`, `missing_extraction`, `incorrect_extraction`, or `unsupported_extraction` relative to annotations. It reports raw-text CER and WER only with a reference transcript. These labels describe differences; a reviewer must inspect the source to distinguish OCR corruption, extraction logic, unclear mappings, and annotation errors. The example's results are **synthetic-only**, not real-world performance.

For a supplied failure: inspect source image, OCR text and boxes, routing signals, field evidence, and ground truth; classify the cause; make the smallest document-specific repair; add its regression test and exactly three labeled synthetic variations; run OCR, intake, RTC, and pipeline suites; then verify on held-out real documents when available. The production spaCy/Regex rules stay in the application; NLTK, BERT NER, and the lab spaCy/Regex candidate stay in this isolated comparison. No JurisGuard NLP model has been trained; training a task-specific model requires annotated data and evaluation showing a benefit.
