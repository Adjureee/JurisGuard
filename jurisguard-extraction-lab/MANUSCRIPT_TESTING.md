# Reproducing the manuscript's three OCR and three NLP comparisons

The manuscript names **three OCR candidates** (PyTesseract, EasyOCR, PaddleOCR) and **three NLP candidates** (NLTK rules, BERT NER, spaCy plus Regex). “Three” refers to candidate methods, not three uploaded images. Its quality-group tables describe **30 PAO interview-sheet captures**: 10 clean scans, 10 mobile captures, and 10 low-quality captures. Run every OCR candidate on the same 30 images. Then run every NLP candidate on the same saved text for those 30 samples. Keep RTC decisions as a separately labeled supplementary set unless the study protocol is changed.

The figures already printed in Tables 19–22 are **manuscript claims**, not results reproduced by this lab. Table 19 also prints `6.82%%` for EasyOCR, which needs an editorial correction after source data are checked. Do not replace those numbers with the single synthetic example below or describe the new cached BERT checkpoint as the original study model.

**If only 20 labeled images are available:** use the same 20 for all six candidates and replace `--require-manuscript-30` in every command below with `--require-samples 20`. Record the actual number of clean, mobile, and low-quality images; do not invent a 10/10/10 split. This is a new **n=20 evaluation**, so revise the manuscript's sample-count statements and recalculate Tables 19–22 and 26 from the measured results. Do not retain the previous n=30 percentages as findings from these 20 images. The original `--require-manuscript-30` option remains available if the remaining 10 annotated images arrive later.

## Prepare private reference data

Place images in `data/input/` and reviewed 21-field ground-truth JSON files in `data/ground_truth/`. Both directories are ignored by Git. The ground-truth format is illustrated by `data/synthetic/synthetic_intake.json`; change `sample_origin` to `real`, provide a unique `sample_id`, and include the reviewed UTF-8 `reference_text`. The lab never copies document contents into a benchmark report.

Create `data/ground_truth/manifest.json` with 30 entries. Paths are relative to the manifest file:

```json
{
  "dataset_origin": "real",
  "samples": [
    {
      "sample_id": "A01",
      "quality_group": "clean",
      "image": "../input/A01.png",
      "ground_truth": "A01.json"
    }
  ]
}
```

Complete the array with exactly 10 `clean`, 10 `mobile`, and 10 `low_quality` samples. The `--require-manuscript-30` switch rejects any other count or synthetic origin. Ground truth must be reviewed against the image; the system does not generate it from OCR.

## Run each candidate individually

From the repository root in PowerShell, enter the lab. The existing backend Python environment on this machine contains the tested local OCR engines and optional NLP packages; these commands import only lab code and never open the production database.

```powershell
cd jurisguard-extraction-lab
$py = '..\backend\venv\Scripts\python.exe'
$manifest = 'data\ground_truth\manifest.json'
```

Run the three OCR candidates separately. PaddleOCR text is saved privately for the later NLP comparison:

```powershell
& $py -m src.manuscript_benchmark ocr tesseract --manifest $manifest --require-manuscript-30 --output data\outputs\ocr_tesseract.json
& $py -m src.manuscript_benchmark ocr easyocr --manifest $manifest --require-manuscript-30 --output data\outputs\ocr_easyocr.json
& $py -m src.manuscript_benchmark ocr paddleocr --manifest $manifest --require-manuscript-30 --ocr-text-dir data\outputs\paddle_text --output data\outputs\ocr_paddleocr.json
```

Use the same PaddleOCR transcripts for all three NLP candidates, avoiding OCR differences within the NLP comparison. The BERT run uses the cached `dslim/bert-base-NER` token-classification checkpoint as a **new, explicitly named baseline**:

```powershell
$bert = "$env:USERPROFILE\.cache\huggingface\hub\models--dslim--bert-base-NER\snapshots\d1a3e8f13f8c3566299d95fcfc9a8d2382a9affc"
& $py -m src.manuscript_benchmark nlp nltk_rules --manifest $manifest --require-manuscript-30 --nlp-text-dir data\outputs\paddle_text --output data\outputs\nlp_nltk.json
& $py -m src.manuscript_benchmark nlp bert_ner --bert-model $bert --manifest $manifest --require-manuscript-30 --nlp-text-dir data\outputs\paddle_text --output data\outputs\nlp_bert.json
& $py -m src.manuscript_benchmark nlp spacy_regex --manifest $manifest --require-manuscript-30 --nlp-text-dir data\outputs\paddle_text --output data\outputs\nlp_spacy_regex.json
```

All candidate model files must already be local. EasyOCR uses `~/.EasyOCR/model` by default and disables downloads. Set `JURISGUARD_LAB_EASYOCR_MODEL_DIR` if your models are elsewhere. PaddleOCR checks local model files and compatible 2.x Paddle packages. BERT loads only the specified local checkpoint, with offline mode enabled. A missing dependency or model **fails the run**; it is never scored as zero accuracy. The tested optional versions here are NLTK 3.9.2, spaCy 3.8.14, Transformers 4.40.2, CPU PyTorch 2.0.1, EasyOCR 1.7.2, PaddleOCR 2.8.1, and PaddlePaddle 2.6.2. Record model versions and machine hardware in the study method.

## What the reports mean

OCR reports contain per-sample and per-quality-group CER, WER, wall time, sampled CPU time (including Tesseract child-process samples), and sampled peak process-tree memory. Use **wall time** for the primary latency comparison because sampled CPU time can miss a short-lived child process. CER/WER use exact Unicode and whitespace-token edit distances against reviewed transcripts. The report includes macro means and pooled micro rates; state which one is used in a manuscript table. Model initialization and one warm-up pass on the first sample are reported separately from timed samples. `--no-warmup` changes that protocol and should not be mixed into the same comparison.

NLP reports use the same saved OCR text for all candidates. They report exact matches among reviewed, non-null values for `Party Represented`, `Address`, and `Court/Body`, plus unsupported predictions, routing results, timing, and sampled memory. This is a **declared three-field entity-mapping benchmark**; it is not automatically the same “Target Entity Accuracy” measure as Table 22 because the manuscript does not define that denominator. NLTK uses tokenization and label rules; spaCy uses `Matcher` label anchors with Regex value extraction; BERT uses a local generic English NER checkpoint and only maps supported entity spans following explicit labels. No JurisGuard NLP model was trained. For Tagalog and RTC documents, publish results separately with suitable annotations and candidate definitions.

The synthetic smoke manifest at `data/synthetic/synthetic_benchmark.json` runs without `--require-manuscript-30`. Its results only check that each candidate executes. They must never be called the manuscript's 30-sample evaluation.

## Current 20 decision images

The folder `../test_images/` contains 20 PNG pages. Visual inspection of all 20 showed **Sandiganbayan** headings; some pages contain several case numbers or only a caption, and some mention Regional Trial Courts inside captions or procedural history. The router now distinguishes `sandiganbayan_document` from `rtc_decision`. Sandiganbayan inventory extraction remains unresolved pending approved field mappings, so routed Sandiganbayan pages keep all 21 inventory fields null with `needs_review=true`. This set is a **separate Sandiganbayan court-page OCR set**, not the PAO interview-sheet quality groups in Tables 21–22.

Raw OCR can still be compared after independently reviewed transcripts are supplied. Until then, use this unlabeled pass to confirm that each engine runs and to save private transcripts. It does not calculate CER, WER, or NLP field accuracy:

```powershell
& $py -m src.scan_unlabeled tesseract --images-dir ..\test_images --expected-count 20 --output-dir data\outputs\decision_20\tesseract
& $py -m src.scan_unlabeled easyocr --images-dir ..\test_images --expected-count 20 --output-dir data\outputs\decision_20\easyocr
& $py -m src.scan_unlabeled paddleocr --images-dir ..\test_images --expected-count 20 --output-dir data\outputs\decision_20\paddleocr
```

Each output directory contains a private `<sample_id>.txt` transcript, routed `<sample_id>.json`, and a `summary.json` without document text. After changing only routing rules, append `--reuse-ocr-text` to update the routing result without repeating OCR; those timings then cover routing only. All generated files are ignored by Git. A Sandiganbayan NLP extractor and its field mappings require approved annotations before field accuracy can be measured on this set.

### Produce the document routing report

The private manifest now has a visual document-family label for each of these 20 inspected pages. From the lab directory, rerun routing on the saved OCR text and generate the JSON and Markdown report:

```powershell
foreach ($candidate in 'tesseract', 'easyocr', 'paddleocr') {
  & $py -m src.scan_unlabeled $candidate --images-dir ..\test_images --expected-count 20 --output-dir "data\outputs\decision_20\$candidate" --reuse-ocr-text
}
& $py -m src.classification_report --images-dir ..\test_images --manifest data\ground_truth\decision_20\manifest.json --ocr-base-dir data\outputs\decision_20 --output-json reports\decision_20_classification.json --output-md reports\decision_20_classification.md
& $py -m unittest discover -s tests -v
cd ..
& .\backend\venv\Scripts\python.exe -m unittest discover -s tests -p test_document_router.py -v
```

The report checks image hashes, exact inventory shape, and routing against the agent's visual document-family labels. Its label-match counts are **in-sample** because these pages helped refine the rules. This folder has no visually labeled RTC images, so the RTC path is currently verified by synthetic regression tests only. The report does not contain OCR text or claim OCR CER/WER, field accuracy, or performance on unseen court documents.

For the complete executed OCR protocol, local environment, separate warmed OCR wall-time observations, the Tesseract TSV parser repair, and interpretation limits, see `OCR_TESTING_REPORT.md`. Its timing command repeats OCR; `scan_unlabeled --reuse-ocr-text` times routing only.

### Prepare the 20-image transcription template

The available images have no independently reviewed reference transcripts. Create one empty private UTF-8 text file per image and a hash manifest:

```powershell
& $py -m src.decision_ocr_reference prepare --images-dir ..\test_images --reference-dir data\ground_truth\decision_20 --expected-count 20
```

To save typing, populate **only empty** template files from the existing PaddleOCR run:

```powershell
& $py -m src.decision_ocr_reference draft --images-dir ..\test_images --reference-dir data\ground_truth\decision_20 --ocr-base-dir data\outputs\decision_20
```

This produces OCR-assisted **drafts**, not ground truth. The manifest records `transcript_origin: paddleocr_assisted_draft` and keeps `reviewed_against_image: false`. The draft command never overwrites a nonempty transcript. Open each numbered `.txt` beside the matching image and correct **every visible word**, including headings, punctuation, capitalization, and meaningful line breaks. A second reviewer should check the corrected transcript against the image. Then set that image's `reviewed_against_image` to `true` and `transcript_origin` to `manually_corrected_from_ocr_draft` in `manifest.json`. If independently transcribed without OCR assistance, use `independent_manual`. Do not simply mark the generated draft as reviewed. If some text cannot be read, record that separately and decide a consistent exclusion or adjudication policy before scoring. The template command preserves existing annotations and review marks, and evaluation rejects changed source images. The private transcript files and manifest are ignored by Git.

After all 20 reference files are reviewed and the three OCR outputs above exist, run:

```powershell
& $py -m src.decision_ocr_reference evaluate --images-dir ..\test_images --reference-dir data\ground_truth\decision_20 --ocr-base-dir data\outputs\decision_20 --output reports\decision_20_ocr.json
```

This fails while any reference is empty, lacks a review mark, or remains tagged as an OCR draft. Its report contains per-image and aggregate CER/WER for the three OCR engines, but no document text. OCR-assisted references may still bias a comparison even after manual correction, so report their provenance. It evaluates **20 images/pages**, which may not be 20 distinct legal decisions; determine document boundaries separately before any case-level NLP evaluation.

## Manuscript alignment still requiring evidence

- Verify the source data and calculation behind Tables 19–22. The current DOCX does not provide per-sample transcripts, annotations, model checkpoints, or machine configuration needed to reproduce its percentages and latencies.
- Specify the original BERT checkpoint if the study intends to retain the old BERT values; the cached `dslim/bert-base-NER` run is a new baseline.
- Define “Target Entity Accuracy” and the entity set before comparing new results with Table 22. The lab's three-field exact-match measure is explicit and reproducible.
- Report the 30-sample PAO study and the separate RTC-decision checks independently. Synthetic tests verify code behavior; held-out real documents support performance claims.
