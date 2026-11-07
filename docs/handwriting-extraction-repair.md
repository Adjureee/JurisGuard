# Handwriting extraction investigation

## Answer-only highlights

Source OCR boxes and display highlights are now distinct evidence properties. A separately recognized handwritten answer box can be highlighted. A merged label/answer line retains its full source box and text for provenance but has no answer highlight; character-count estimates are not shown as precise handwriting bounds. Joined fragments highlight only when every fragment has an answer-only box. A blank area may be outlined after a separately recognized label, bounded by the next label or column edge. Merged-label blank areas are withheld when boundaries cannot be isolated reliably. The UI also suppresses older colon-containing source boxes instead of drawing the printed label. This changes the review overlay, not OCR image cropping or stored reviewed values. Synthetic tests cover these distinctions and the detention-label regression.

## Latest screenshot-sheet investigation

Read-only inspection of the local screenshot-associated draft established that instruction fragments above Pangalan were competing with a handwritten name candidate. Nearby-answer association now requires overlap and uses the smaller text height, preventing the taller label from admitting the instruction row above it. The printed OCR variant `Lugar ng Detentior:` is also recognized as a label rather than an answer. Synthetic fixtures reproduce both defects without private values.

A fresh local extraction of that original 1920×1080 upload completed in 110.8 seconds. The name candidate is now present and uncertain instead of withheld by the instruction conflict; it still has OCR spelling errors. The detention location is now empty instead of containing the printed label. Sex remains missing and the N/A date remains incorrectly recognized. No source spelling or digits were automatically corrected. A separate 3× enlarged row experiment (15.0 seconds) still missed the visible handwritten F, so this ineffective extra pass was not enabled in intake.

This sheet has no fully verified answer set. Its five screenshots are views of one sheet, not five test documents. Overall handwriting accuracy remains unmeasured. The earlier 0/3 exact matches applies only to three confirmed fields on a different sheet; it must not be advertised as overall system accuracy. The evaluation runner now returns `exact_match_percent: null` when no verified fields exist and always reports the verified denominator. Two synthetic scoring tests verify exclusion of unverified predictions and exact/omitted/incorrect classification.

The recommended deployed behavior remains local OCR plus original-image comparison and mandatory attorney correction. Enlarging inputs alone cannot resolve all mobile-model recognition errors. A different pretrained recognizer should be benchmarked against complete verified sheets before changing the default; no training or cloud transmission occurred here. Private draft copies and probe/results are Git-ignored under `.local/physical-paper/latest-mapping/`. Existing drafts and reviewed records were left unchanged.

## Adjacent printed-label mapping repair

A read-only inspection of the reported local extraction drafts confirmed two concrete mapping defects: `Edad: Sex:FCivil Status:` was stored as Sex = `FCivil Status:`, and an OCR-misspelled `Pagkamamnamayan:` label became part of the citizenship answer. No stored draft or reviewed record was modified during investigation.

The local positional and text-only parsers now share printed-label boundaries. An underscore is accepted as a blank-rule separator (so `_Sex:` is recognized). A colon-terminated `Civil Status:` immediately touching F/M is recognized as the next label. The specific observed citizenship-label insertion is accepted only as a label spelling. Handwritten answer spelling is never corrected by these rules. Synthetic regressions verify applicant/representative separation, Sex F/M versus civil status, exclusion of printed labels from citizenship, empty age preservation and retention of original OCR evidence.

Existing drafts retain their original predictions. The attorney can correct them manually or use the existing confirmation-protected **Re-extract original scan** action after the backend reloads. No database backfill or silent alteration of reviewed answers is performed.

## Follow-up scanning improvements

The local refinement pass now covers both Part II and Part II-A. It requires each section's printed start/end headings and a right-column label; missing/invalid boundaries skip refinement rather than cutting by guessed coordinates. It reuses the original RGB pixels, keeps first-pass OCR immutable and maps crop boxes back to original coordinates. Cross-pass disagreements now mark a candidate uncertain even if model confidence is high. Source/working image dimensions, refinement duration and region count are recorded in OCR timing evidence.

Capture review now warns about dark photographs and limited resolution, without blocking manual crop or resampling the original. Existing camera code already requests 3840×2160 and captures the actual video size; no artificial camera upscaling was added.

On the same private sample, four column crops (two per section) produced 18 populated candidates, including 7 representative candidates, compared with 17/6 before this follow-up. A representative civil-status/address candidate became available; other representative readings changed and still require verification. Exactly matching the three confirmed fields remained 0/3, with 3 incorrect and 0 omitted. Runtime was 129.9s versus the previous 124.6s; these single runs are not a controlled latency benchmark. The new pass adds recognition work and does not claim faster scanning. New output remains local in `.local/physical-paper/handwriting-both-sections.json`.

No new model, training or cloud request was introduced. Synthetic checks cover section crop isolation, missing and cross-page boundaries, faint pixels, dark/low-resolution warnings, disagreement flags and existing camera/review behavior.

## Findings and changes

The inspected private 1920×1080 photograph is dark and slightly tilted; handwriting is small relative to the full photograph. Its required sections are visible. Automatic preparation retained the full resolution, declined uncertain perspective boundaries, and requested manual crop review. Original and prepared images were inspected locally. No cloud service was called.

1. The mobile recognizer read the applicant heading's `II.` as `I.`. Strict boundary matching discarded the entire applicant section even though the complete printed section title was recognized. Both section titles now serve as explicit boundary evidence when Roman numerals are missing/damaged. Boundaries are still required; no fixed page percentages or inferred identities were added. Applicant refinement uses these same boundary rules.
2. Separate adjacent handwritten word boxes were classified as conflicting answers. Disjoint same-row fragments can now join, with conservative gap/vertical limits and at most one printed label. Overlapping alternative readings and repeated labels remain unresolved. Original candidate boxes/text remain in evidence.
3. A label-only refinement suppressed first-pass answers. Both passes now remain available; a populated refinement has priority, but a label-only pass cannot erase a populated first pass. A visibly invalid age refinement still blocks automatic fallback and requires review.
4. Refinement used percentile autocontrast, which could clip faint marks. Refinement now uses original RGB crops with existing enlargement. A synthetic faint-pixel regression verifies that contrast is not stretched to white. Camera preparation and its crop-only interaction were preserved.
5. Printed `Contact N0.` was not recognized as `Contact No.`. Only this printed-label confusion is accepted; answer digits/letters are never repaired or guessed.
6. Pipeline provenance now also fingerprints `intake_layout.py`, which controls refinement boundaries.

No model training, fine-tuning, dictionary correction, or prompt modification occurred. These are preprocessing and deterministic mapping fixes. The installed local mobile OCR model continues to misrecognize handwriting.

## Actual measurements and limits

One previously used handwritten sheet was run locally before and after. It is not an unseen held-out test. The 12-photo collection remains quarantined because physical-document grouping and complete independent annotations are unfinished. A supplied answer file contains only three explicitly confirmed field values; the other 23 fields are not scored. The supplied synthetic PDF is supporting reference material, not an exact transcription of revised handwriting.

| Measurement | Before | Updated original | Updated prepared image |
|---|---:|---:|---:|
| Nonempty text candidates | 2 | 17 (11 applicant, 6 representative) | 10 |
| Exact matches among 3 confirmed fields | 0 | 0 | 0 |
| Omissions among 3 confirmed fields | 3 | 0 | 1 |
| Incorrect values among 3 confirmed fields | 0 | 3 | 2 |
| Local OCR + mapping + box detection | 93.2s | 124.6s | 123.3s |

Baseline mapping was replayed with frozen pre-change rules to isolate it from the active working tree. Current mapping was replayed on each saved OCR result after the final label fix. Mapping replay took 0.19–0.20s and is not included as another OCR run. Original-image first-pass recognition produced 103 boxes; prepared-image recognition produced 101. Updated runs also execute applicant refinement previously skipped by the damaged heading. CPU runs partially overlapped, so timings are descriptive and do not establish a speed regression or improvement.

For example, a recognized applicant name previously lost with its section is now available for review. The confirmed education entry still has character errors; both confirmed phone numbers remain incorrect OCR candidates. Increased candidate coverage is **not** increased verified accuracy. No full-sheet character/word error rate or field-accuracy percentage can be supported by these annotations.

On the inspected scan, Hindi has a visible slash. Updated visual detection reports Hindi checked and Oo unknown; uncertainty about Oo is retained rather than inferred from nearby text or detention fields. The baseline detector reported both unknown. The pair remains subject to attorney confirmation.

Prepared-image recognition was less complete than original-image recognition on this sample. Conservative lighting changes can still affect a model's predictions; image enhancement is not guaranteed to improve accuracy. No aggressive enhancement or model switch was enabled based on this single sample. Retaking with brighter even lighting and a closer upright page remains useful.

## Workflow verification

- 55 focused backend tests cover section scoping, original spelling/digits, adjacent fragments, conflicting readings, invalid ages, faint-pixel preservation, checkbox uncertainty and extraction contracts.
- Synthetic browser workflow passed capture, crop/reset, retake/cancel, desktop/mobile review, exact preview bytes submitted to OCR, original preservation, correction and mocked saving. Existing upload and case-editor regression paths also passed. Actual NETUM hardware was not exercised.
- One opt-in local PostgreSQL integration test passed upload → correction → save → GET/reopen, including exact reviewed sections, unknown box states, candidate snapshot and blank representative preservation. The test uses synthetic OCR and rolls back all rows. The real sheet was not saved as a client record.
- Cloud accuracy was not measured: private-image transmission lacks explicit authorization. Local outputs cannot be presented as cloud results.

The UI continues to show missing/unreliable readings beside the original, supports attorney unreadable flags, and preserves edits through the existing save workflow. Recognition cannot reliably decide whether an empty answer area is genuinely blank or contains handwriting it failed to detect; those fields still require visual review.

## Reproduce locally

Run from the repository root. Set model directories to already cached models; the runner cannot download them. Use the same image and settings for each version:

```powershell
$env:PADDLEOCR_DET_MODEL_DIR="$PWD/.local/models/PP-OCRv5_mobile_det"
$env:PADDLEOCR_REC_MODEL_DIR="$PWD/.local/models/en_PP-OCRv5_mobile_rec"
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK='True'
.\backend\venv\Scripts\python.exe scripts/evaluate_handwriting_pair.py <local-image-path> --output .local/physical-paper/evaluation.json --reference .local/physical-paper/user-supplied/image-001.json

$env:PYTHONPATH="$PWD/backend"
.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_paper_intake tests.backend.test_local_ocr tests.backend.test_paper_checkboxes tests.backend.test_paper_review_evidence tests.backend.test_intake_layout -q
```

Use a reference belonging to the selected image. `--replay <saved-evaluation.json>` remaps retained OCR without rerunning recognition. Output must be Git-ignored; the runner refuses other locations. Private original/prepared scans, transcripts, candidates, baseline snapshots and measurements are under `.local/physical-paper/`, outside Git. No private values are included in committed fixtures or this report.
