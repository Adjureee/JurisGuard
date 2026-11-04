# PAO checkbox recognition and repeatability audit

4 November 2026. Scope: Part II and Part II-A of FOSS.F.003/REV.3. The only printed checkbox choices in those sections are **Oo / Hindi for Nakakulong in Part II**. Part II-A has no checkboxes. Other form sections remain outside intake extraction, review fields, and canonical saved intake data. The complete original scan remains accessible.

The revised locator reads the visible selections in the three supplied photographs correctly when applied to their captured OCR output. Complete repeated local processing was also verified on the first photograph and on an independently controlled synthetic sheet. This does not establish general handwriting accuracy.

## Root causes and fixes

1. **OCR dropped a printed option.** In the real photos it recognized the Nakakulong row and Hindi but omitted Oo where the mark touched its label. Requiring both option names in OCR withheld every result. The locator now requires reliable section/row anchors and identifiable physical box geometry. For this specific printed form it associates the ordered pair with Oo then Hindi even when OCR misses one option label. It never supplies a mark state from the surviving text label.
2. **Connected marks broke contour detection.** The marked rectangle merged with the adjacent printed Oo, while noise and slight tilt made another rectangle fail the four-corner test. The new locator combines exposure-relative masks, border-stroke morphology, connected components, and rectified contour geometry. It excludes the Nakakulong word's letter counters and requires one compatible pair aligned with the row. Missing or competing pairs stay unknown.
3. **Camera exposure looked like ink.** Relative paper brightness and local background-noise estimates now distinguish gray paper/border blur from interior marks. A clear interior mark can obscure one border; an empty decision requires complete border evidence. Source-image boundary cropping remains unknown. Very faint/noisy interiors remain unknown rather than empty.
4. **Model candidates and reviewed values lacked a complete link after re-extraction.** Extraction drafts are now immutable, content-addressed rows associated with their original document. Saving records the reviewed draft ID and a candidate snapshot separately from approved text and checkbox states. Re-reading creates a draft without overwriting original OCR metadata or reviewed data. Invalid/mismatched draft IDs are rejected. Saved source coordinates can now be reloaded for highlighting.
5. **Cloud numeric text values were silently discarded.** The former validator accepted numbers, but the paper mapper retained only strings. The paper-specific schema now requests and validates strings/null, flags rejected types, and retains the original model JSON as candidate evidence. It does not invent leading zeroes or convert a numeric model answer into presumed source text.
6. **Cloud boxes were flattened and then withheld.** The explicit cloud schema now includes independent checked/unchecked/unknown box candidates. Invalid or absent states become unknown with warnings; booleans are not coerced into choices. Conflicting marks are preserved and warned about.
7. **A cloud request is not necessarily a cloud success.** Local fallback remains available, but its mode, provenance, and warning explicitly identify it as local. The benchmark calls the cloud stage directly so a fallback never counts as a provider prediction.

The retained three-state persistence contract remains intact. The text summary is Oo only for checked/unchecked, Hindi only for unchecked/checked, and empty otherwise. Both empty boxes are not a Hindi answer. Unknown and conflicting pairs retain null compatibility values. No checkbox or detention state is inferred from names, addresses, detention-place text, or missing OCR text.

## Which stages are rules and which are predictions?

| Stage | Behavior in this scoped workflow |
|---|---|
| Decode, EXIF orientation, rasterization, resize, contrast and column refinement bounds | Fixed operations/settings. The original source file is retained. |
| Local detection and transcription | PaddleOCR model predictions: PP-OCRv5 mobile detection and English mobile recognition, CPU. OCR scores are model outputs, not proof of correctness. |
| Applicant/representative extraction | Fixed section boundaries, label/column/row matching and validation. This paper-specific route does **not** call the legacy spaCy/DocumentRouter extraction path. |
| Local checkbox recognition | Fixed geometry and pixel rules, conditional on OCR locating the correct row. No language generation or random line sampling. |
| Explicit cloud extraction | Hosted vision/language-model predictions followed by strict schema/type/state validation. There is no independent cloud OCR transcript; retained model JSON is labeled as model candidates. |
| Review and save | Attorney corrections are separate from candidates. Explicit save records reviewer identity/time using existing authorization. No OCR result auto-saves itself as reviewed. |

No hardcoded applicant names, contacts, religions, nationalities, or sample detention answers were found in the scoped production path. Printed labels, field order, Oo/Hindi order, thresholds, and unknown/empty schema placeholders are rules, not sample applicant data. Synthetic names exist only in tests. Source abbreviations such as M, N/A, leading-zero contacts, amounts, and dates are not expanded into inferred facts.

Numeric age gates still withhold non-digit OCR readings such as a letter/digit ambiguity; those readings are now retained in diagnostics and shown for comparison rather than silently lost. Canonical reviewed text can retain an attorney's exact correction. Older compatibility/client forms still have numeric zero conventions, but the paper review binds to its canonical text sections and keeps missing paper entries empty; those legacy forms and inventory behavior were not redesigned.

## Explicit repeated-run results

Comparisons use content hashes of recognized text, canonical candidate fields, checkbox states, ordered warnings, and evidence. Database IDs, review timestamps, and timing measurements are not semantic extraction content and are excluded. Input bytes, settings, model-file digests, and rule fingerprints are recorded. Repeatability and accuracy are evaluated separately.

| Experiment | Runs | Result |
|---|---:|---|
| Baseline first real photograph | 3 | Identical full OCR text, fields, unknown checkbox states, and warnings. **Repeatable but wrong** for the visible selections. |
| Revised first real photograph, complete local pipeline | 3 | Recognized text, fields, checkbox states, evidence and warnings identical. Each returned Oo checked / Hindi unchecked. Model/settings fingerprints were identical. |
| Revised controlled synthetic sheet, complete local pipeline | 3 | One source hash, one settings/model fingerprint, one rule fingerprint; all compared outputs identical. All 26 candidate fields matched the known synthetic reference. |
| Revised locator on each supplied photo's captured OCR | 3 photos | Correct visible pair on all three. Part II-A stayed empty in all original photo extractions. Photos 2/3 were replayed through mapping/pixel inspection rather than subjected to three more model runs each. |
| Baseline configured cloud, synthetic input | 3 attempts | One successful prediction, two HTTP 429 responses. This cannot establish model repeatability. Old cloud box handling left both unknown. |
| Revised configured cloud, same synthetic input | 3 attempts | Two successful predictions matched byte-for-byte on model JSON and on all 26 fields, checkbox states and warnings. Third attempt received HTTP 429, despite spacing requests by 65 seconds. A rate-limit error is not a differing model prediction. |

The first real-photo repeated batch spanned an on-disk edit to **cloud-only diagnostics**, so its recorded file-level rule-bundle fingerprints had two versions, despite an unchanged loaded local path and identical model/settings/output hashes. It is observed output repeatability, not the strongest fixed-code control. The separate three-run synthetic batch used one rule-bundle fingerprint throughout and is the controlled repeatability result.

Local environment recorded in the controlled run: Python 3.11.9; package metadata PaddleOCR 3.7.0, PaddlePaddle 3.3.1, NumPy 1.26.4, OpenCV Python 4.11.0.86, Pillow 13.0.0. Settings: mobile profile, maximum image dimension 2500, detection limit 1280, four CPU threads, batch size eight, MKL-DNN disabled, bounded intake refinement enabled. Detection/recognition model configuration and weight-file SHA-256 digests are retained in private run provenance. Package metadata is not a complete operating-system/native-library fingerprint.

### Cloud model identity limits

Requests used the configured default identifier `pixtral-12b-2409`, temperature 0, maximum 4096 output tokens, and the new configurable `MISTRAL_RANDOM_SEED=0`. The provider reported **`ministral-14b-latest`** in both successful responses. Requested and returned identifiers are now stored, and the mismatch is flagged. No model was silently selected by this application to conceal that mismatch.

The provider exposes a sampling seed in its [official API/SDK documentation](https://github.com/mistralai/client-python/blob/main/docs/sdks/chat/README.md). A fixed request and seed are reproducibility controls, not an accuracy test or proof that hosted model weights will stay unchanged. The two successful responses are limited evidence of repeatability; the returned `latest` identifier and rate limits prevent a stronger version-pinned cloud guarantee. No supplied legal photograph was sent to the cloud: all cloud requests used a clearly synthetic fixture.

## Review, persistence and synthetic verification

The real local OCR/API matrix completed these extraction → reviewed save → fresh API reopen cases in a disposable database:

| Synthetic case | Stored Oo | Stored Hindi | Summary |
|---|---|---|---|
| Marked | checked | unchecked | Oo |
| Both empty | unchecked | unchecked | empty |
| Unclear/faint | unknown | unchecked | empty |
| Conflicting marks | checked | checked | empty; conflict warned |

Focused synthetic tests also cover checkmarks, crosses, filled rectangles, readable faint marks versus ambiguous marks, gray/noisy backgrounds, ±4° tilt, missing/cropped boxes, merged/missing OCR option labels, rejected cloud types, and strict unknown preservation. Geometry cases are repeated three times; the live matrix actually runs local OCR. These are distinct tests, not cached OCR masquerading as new predictions.

Browser testing loaded the actual extracted synthetic draft into the production review component, corrected its name, saved through the actual API, and reopened the returned record. The reviewed value and original extracted reading remained separate. The saved draft, candidate snapshot, checkbox states, provenance and source highlighting survived reopening. A lingering success toast was also found intercepting pointer clicks over Save in repeated review; the paper workflow's notice now appears at the top instead of over the footer.

API smoke tests verify initial and re-extracted draft linkage, immutable original metadata, preserved old records/status notes, invalid draft rejection, all representative checkbox pairs, and existing document/client ownership protections. Re-extraction does not change a saved record until the reviewed draft is explicitly saved.

Validation: **155 Python tests ran successfully, one optional Tesseract test skipped; 21 frontend tests passed; frontend typecheck/build and `git diff --check` passed.** Existing build-size/Browserslist warnings remain. The test server uses a synthetic approved owner only within its separate process; production authentication and existing records are not changed.

Private, ignored artifacts under `.local/checkbox-audit/` include the benchmark JSON, real-photo OCR captures, synthetic fixtures, live matrix and [review trace screenshot](../.local/checkbox-audit/review-trace.png). None of the supplied documents, their transcripts, or credentials is committed.

## Reproduce

From the repository root:

```powershell
.\backend\venv\Scripts\python.exe tests\paper_repeatability.py --synthetic --runs 3 --output .local\paper-repeatability
.\backend\venv\Scripts\python.exe tests\paper_repeatability.py --scan <private-scan.jpg> --runs 3 --output .local\private-repeatability
```

Explicit cloud benchmark using synthetic data only:

```powershell
.\backend\venv\Scripts\python.exe tests\paper_repeatability.py --mode cloud --synthetic --allow-cloud --runs 3 --interval 65 --output .local\cloud-repeatability
```

The cloud benchmark deliberately rejects private `--scan` uploads and reports failed requests separately. `.env` supplies existing configuration; keys are not printed. Provider quotas can still prevent successful repeats.

## Remaining limits

- These tests do not establish deterministic or accurate behavior on every document, device, hardware backend, future model version, or extreme skew. Missing borders, severely faint ink, unsupported forms, multiple possible pairs, and unreadable/cropped row anchors must still remain unknown for review.
- The supplied photos' checkbox selections were compared visually; their full handwritten contents were not exhaustively ground-truthed. Synthetic 26/26 agreement is not a real-world accuracy percentage.
- Hosted predictions can return plausible but wrong strings that pass type validation. Source comparison and explicit attorney review remain required.
- Existing records are not backfilled with guessed states, coordinates or draft provenance. New extraction/review creates the trace. Rereading an old scan is an explicit action, not an automatic replacement of reviewed values.
- The fingerprints establish input/configuration identity for these runs, not formal mathematical determinism. Timing differences, stable wrong readings, and provider unavailability must not be confused with model-output variability.
