# JurisGuard OCR testing report and reproducible procedure

**Run date:** 7 October 2026, Asia/Singapore
**Dataset:** 20 private images in `../test_images/`
**Status:** Local execution and routing checks complete; OCR transcription accuracy awaits reviewed references.

## 1. Purpose and boundary

This report records how the three local OCR engines were run on the same 20 supplied images, what outputs were saved, what was verified, and which measurements cannot yet be reported. It is a supplementary **Sandiganbayan court-page** test. All 20 images were visually inspected for court family; some are caption pages or show multiple case numbers. There are no PAO interview sheets or real RTC pages in this set. Thus this run does not reproduce the manuscript's 30-image PAO interview-sheet study or establish RTC real-image performance.

The OCR candidates are Tesseract, EasyOCR, and PaddleOCR. The Tesseract adapter invokes the installed `tesseract` executable directly to request TSV; it does **not** call the `pytesseract` Python wrapper named in the manuscript. The OCR engine is Tesseract in both cases, but the command and output parsing should be stated accurately in the method. The lab uses no cloud OCR or mandatory network API.

## 2. Input set and data handling

| Property | Recorded value |
| --- | --- |
| Number of images | 20 |
| Format and color mode | PNG, RGBA |
| Width range | 489–639 pixels |
| Height range | 738–787 pixels |
| File size range | 98,504–881,831 bytes |
| Document family observed | Sandiganbayan pages |
| Capture-quality labels | Not supplied; no clean/mobile/low-quality stratification claimed |
| Independent reference transcripts | Not supplied |
| PAO inventory field annotations | Not supplied |

The image files are not copied into the lab. The private manifest stores an SHA-256 fingerprint for each input so a changed image cannot silently be scored as the original sample. `test_images/`, generated OCR text, draft transcripts, and reports are ignored by Git. OCR output and document text remain local.

## 3. Local environment and fixed engine settings

The runs used the existing backend virtual environment on Windows (`Windows-10-10.0.19045-SP0` as reported by Python), Python 3.10.11, and eight logical CPU cores. All adapters were configured for CPU inference.

| Candidate | Installed version | Settings used |
| --- | --- | --- |
| Tesseract executable | 5.5.3.20260724 | `tesseract <image> stdout -l eng tsv`; local binary; one subprocess per image; 120-second call timeout |
| EasyOCR | 1.7.2 | English reader, `gpu=False`, `download_enabled=False`, `detail=1`, `paragraph=False`, local cached model directory |
| PaddleOCR / PaddlePaddle | 2.8.1 / 2.6.2 | English, `use_gpu=False`, `use_angle_cls=False`, `enable_mkldnn=False`; local detection and recognition model directories; no classifier model |

The Paddle adapter checks for `inference.pdmodel` and `inference.pdiparams` before constructing the engine. The EasyOCR adapter checks local `.pth` files and disables downloads. No external API endpoint appears in the lab OCR path. The code did not apply a shared image enhancement, deskew, denoising, or upscaling step; each engine performed its own internal preparation from the original PNG. Differences therefore reflect both engine recognition and each engine's own preprocessing/line ordering.

## 4. Procedure actually performed

1. **Inventory inputs.** Confirmed exactly 20 PNG files, numbered 1–20. Recorded dimensions, file type, and SHA-256 fingerprints. Kept the images outside the production application and database.
2. **Run each OCR engine individually.** The `scan_unlabeled` runner processed files in numeric order, one engine at a time. For every image it saved UTF-8 OCR text as `<id>.txt`, routing output as `<id>.json`, and an engine summary as `summary.json`. Tesseract TSV words were grouped into lines; EasyOCR boxes were sorted top-to-bottom then left-to-right; PaddleOCR's returned detection order was preserved. The original image was not rewritten for extraction.
3. **Check execution.** Counted completed and failed images per engine. All three completed 20/20 with zero execution failures. This checks operational completion, not text correctness.
4. **Inspect document family.** Visually inspected all 20 images for court heading and page structure. The private manifest records the agent's `sandiganbayan_document` visual labels. This was a page-family check, not a word-by-word transcription review.
5. **Route saved OCR text.** Ran the deterministic router again on each engine's saved text after adding Sandiganbayan as a distinct class. This rerouting did **not** rerun OCR. It generated the in-sample classification report and preserved an empty 21-field inventory with `needs_review=true` for Sandiganbayan pages.
6. **Prepare annotation drafts.** Populated 20 private transcript files from PaddleOCR output and marked each `transcript_origin=paddleocr_assisted_draft`, `reviewed_against_image=false`. These are drafting aids, not reference truth. The CER/WER evaluator correctly refuses them until a full image-based review and provenance update.
7. **Time OCR separately.** Used `ocr_timing.py` to instantiate one engine, run an untimed first-image warm-up, and then time only one `engine.extract(image)` call on each of the same 20 images in numeric order. Model startup and warm-up are recorded separately. The measured call excludes input hashing, document routing, and JSON writes. OCR text from this repeat was compared exactly with the originally saved text without replacing it. The final retained timing passes were PaddleOCR, then EasyOCR, then corrected Tesseract, each run serially. This was one measured pass per engine; engine order was not randomized and no variance across repeated trials was estimated.
8. **Repair a Tesseract TSV parsing fault.** A quote recognized on image 2 caused the original CSV-style TSV parser to merge later rows into an OCR line. The parser now splits Tesseract rows by tabs without treating quote characters as CSV syntax. Three synthetic quote variations were added as regression cases. Tesseract OCR, timing, and routing reports were rerun after the repair; the reported results below are from the corrected parser.
9. **Run regression checks.** Ran lab tests, production router tests, backend OCR/integration tests, and frontend typecheck. The test results are listed below. Synthetic RTC and Sandiganbayan examples test the routing rules; they are separate from real-image performance claims.

## 5. Observed results

### 5.1 OCR completion and routing from its text

| OCR source | OCR completed | OCR failures | Routed Sandiganbayan | Unknown | Routed RTC | Match to visual page-family label |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract | 20/20 | 0 | 20 | 0 | 0 | 20/20 |
| EasyOCR | 20/20 | 0 | 19 | 1 (image 15) | 0 | 19/20 |
| PaddleOCR | 20/20 | 0 | 20 | 0 | 0 | 20/20 |

The label matches are **in-sample routing agreement**, not OCR text accuracy and not held-out classifier performance. The same 20 pages helped refine the router. EasyOCR image 15 remains `unknown` because its court cues are heavily corrupted; none of the 60 OCR texts was incorrectly routed to RTC in the final pass. Tesseract image 2 became routable after the TSV parser repair.

### 5.2 OCR wall time under the separate warm-up protocol

| Engine | Startup + warm-up (s) | Mean OCR (s/image) | Median (s/image) | P90 (s/image) | Total measured OCR (s) | Repeated text matches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract | 0.81156 | 0.80169 | 0.78465 | 0.87482 | 16.03385 | 20/20 |
| EasyOCR | 26.88904 | 21.21160 | 20.63871 | 25.72777 | 424.23198 | 20/20 |
| PaddleOCR | 11.53481 | 7.25308 | 7.32924 | 8.83967 | 145.06159 | 20/20 |

P90 uses the nearest-rank method on 20 measured calls. These are **local, single-pass CPU wall times** under the stated adapter settings. The measured calls exclude startup, warm-up, routing, hashing, and report writes. Exact repeated-text matches check output stability across the two local passes; they do not establish correctness. Engine order, OS caching, and machine load were not controlled; no confidence interval was estimated. The table is not a general speed ranking.

### 5.3 Automated software checks

- Lab suite: **30 passed**, including synthetic OCR-adapter, TSV quote, router, report, annotation-gate, and timing-protocol tests.
- Production router suite: **17 passed**.
- Backend OCR/integration suite: **12 passed**.
- Frontend TypeScript typecheck: **passed**.
- Production router on the 60 saved OCR texts: the same 19/20, 19/20, and 20/20 routing counts as the lab router.

## 6. What was not measured

**CER and WER are unavailable.** A system-generated transcript cannot be scored against itself. The present files are PaddleOCR-assisted drafts, and their review flags remain false. Do not describe them as independent references or interpret OCR-engine confidence scores as extraction confidence. Once every page is transcribed or corrected against its image, the evaluator can calculate:

- **CER** = Levenshtein character edits ÷ number of reference characters.
- **WER** = Levenshtein whitespace-token word edits ÷ number of reference words.

The current evaluator uses exact Unicode text for CER and splits words on whitespace for WER. It does not normalize case or punctuation. Reading order and line breaks therefore affect scores. Any treatment of illegible handwriting, signatures, footnotes, or cropped text must be fixed before scoring and documented consistently for all candidates. OCR-assisted references may bias a comparison toward the engine used to draft them even after correction; preserve their provenance and have a reviewer check every word.

**Field accuracy is unavailable.** The 20 pages have no reviewed PAO inventory field labels or approved Sandiganbayan-to-inventory mapping. Several pages contain multiple case numbers, so a single case-number assignment would be unsafe. The Sandiganbayan classifier returns an exactly 21-field null inventory and requests human review. The three existing NLP entity candidates were not scored on this set. Real RTC performance is also unmeasured because this set has zero RTC images.

## 7. Reproduce the procedure locally

From the repository root in PowerShell:

```powershell
cd jurisguard-extraction-lab
$py = '..\backend\venv\Scripts\python.exe'
```

Run each local OCR candidate on the same 20 images. This overwrites that candidate's private output files, so copy an earlier run first if preserving a prior experiment:

```powershell
& $py -m src.scan_unlabeled tesseract --images-dir ..\test_images --expected-count 20 --output-dir data\outputs\decision_20\tesseract
& $py -m src.scan_unlabeled easyocr --images-dir ..\test_images --expected-count 20 --output-dir data\outputs\decision_20\easyocr
& $py -m src.scan_unlabeled paddleocr --images-dir ..\test_images --expected-count 20 --output-dir data\outputs\decision_20\paddleocr
```

To test only changed routing code against already saved OCR, append `--reuse-ocr-text` to each command. Its `summary.json` then records **routing-only** timing and must not be used for OCR latency.

For the separate CPU wall-time pass, run the engines **sequentially**, not concurrently:

```powershell
& $py -m src.ocr_timing paddleocr --images-dir ..\test_images --expected-count 20 --saved-text-dir data\outputs\decision_20\paddleocr --output reports\decision_20_timing_paddleocr.json
& $py -m src.ocr_timing easyocr --images-dir ..\test_images --expected-count 20 --saved-text-dir data\outputs\decision_20\easyocr --output reports\decision_20_timing_easyocr.json
& $py -m src.ocr_timing tesseract --images-dir ..\test_images --expected-count 20 --saved-text-dir data\outputs\decision_20\tesseract --output reports\decision_20_timing_tesseract.json
```

Generate the routing report from saved OCR and the private visual-label manifest:

```powershell
& $py -m src.classification_report --images-dir ..\test_images --manifest data\ground_truth\decision_20\manifest.json --ocr-base-dir data\outputs\decision_20 --output-json reports\decision_20_classification.json --output-md reports\decision_20_classification.md
```

After reference transcripts have been fully image-reviewed and the manifest updated according to `MANUSCRIPT_TESTING.md`, calculate CER/WER:

```powershell
& $py -m src.decision_ocr_reference evaluate --images-dir ..\test_images --reference-dir data\ground_truth\decision_20 --ocr-base-dir data\outputs\decision_20 --output reports\decision_20_ocr.json
```

At present that last command fails by design because the drafts are unreviewed. Run the lab tests with `& $py -m unittest discover -s tests -v`; run the production router suite from the repository root and backend integration suite from `backend/` as described in `MANUSCRIPT_TESTING.md`.

## 8. Interpretation and next evaluation stage

The evidence currently supports: all three local engines executed on all 20 pages; the repeated OCR text matched each engine's saved text exactly; Tesseract and PaddleOCR text supported the router on all 20 pages in this **tuning set**, while EasyOCR had one unresolved page. It does **not** establish which engine reads legal text most accurately. Single-pass CPU timing is machine- and load-dependent.

For a manuscript-quality comparison, first complete and adjudicate reference transcripts, label actual image-quality groups, then score each engine on the **same** images with the declared CER/WER policy. Collect a held-out set for document classification and separate real RTC pages. Keep the 20-page Sandiganbayan study separate from the manuscript's 30 PAO interview-sheet experiment and from synthetic regression tests.
