# PAO checkbox recording fix

Verified 3 November 2026. The supplied FOSS.F.003/REV.3 form has only two checkbox choices in the retained sections: **Nakakulong: Oo / Hindi** in Part II. Part II-A contains text fields, not checkboxes. Checkboxes in all other sections remain outside intake extraction and recording.

## Reproduction and cause

A synthetic scan with a visible X in the printed Oo rectangle reproduced the failure with real local PaddleOCR: OCR returned `Nakakulong: Oo X Hindi`, but the extracted detention answer was empty. The previous parser required recognizable textual box glyphs, such as `Oo [X] Hindi []`. Physical box borders and marks are not reliably transcribed as those glyphs.

The old review control stored only a single string, `Oo`, `Hindi`, or empty. This flattened visibly empty, unreadable, and missing boxes into the same empty string. The legacy compatibility serializer additionally used `bool(details.detained)`, converting SQL NULL to false. None of these representations could retain each individual box's state.

## Changes

- `paper_checkboxes.py` uses local source pixels. OCR and section boundaries locate the Nakakulong row and establish printed option order; OCR text never establishes the checked state. The detector requires two identifiable rectangular borders in the bounded row. It inspects each interior for a clear mark, clear empty background, or uncertainty. Weak identity, faint ink, missing boxes, cropped geometry, and ambiguous matches remain unknown. Evidence includes each box's page and bounding rectangle.
- Text-only extraction returns unknown checkbox states. Cloud text answers also cannot establish per-box visual states. Clear candidates still require attorney review.
- A separate `checkbox_states` dictionary travels through extraction, the public-response whitelist, typed services, review state, POST/PATCH, the additive nullable JSONB column, the client API response, and reopened review UI. Its only allowed keys are `applicant_personal_circumstances.detained.oo` and `.hindi`; each value is strictly `checked`, `unchecked`, or `unknown`.
- Review offers a separate, labeled three-state control for each actual printed choice, with the original scan accessible. Saved views display Checked, Unchecked, or Unknown explicitly. Both checked boxes are preserved and flagged as conflicting; no single answer is inferred.
- The text summary is Oo only for checked Oo + unchecked Hindi, and Hindi only for unchecked Oo + checked Hindi. Every other pair keeps a blank summary. Both empty boxes remain **unchecked / unchecked**, not a Hindi answer. A checked box with an unknown partner also retains uncertainty about the group answer.
- Compatibility values are true/false only for those exclusive, reviewed choices; otherwise they remain NULL. Paper-intake serialization and TypeScript types preserve NULL. Existing non-paper intake serialization retains its behavior.
- Existing records are not backfilled from their old text answer or boolean. Their missing per-box metadata stays unknown until explicitly reviewed. An omitted checkbox payload preserves existing metadata; a contradictory text-only update is rejected. No legacy status selection requirement was restored.

## Verification

Five real local OCR runs used synthetic scans with actual drawn rectangles and marks:

| Scan | Oo | Hindi | Text summary |
|---|---|---|---|
| Marked Oo | checked | unchecked | Oo |
| Marked Hindi | unchecked | checked | Hindi |
| Both visibly empty | unchecked | unchecked | blank |
| Faint Oo mark | unknown | unchecked | blank |
| One box missing/cropped | unknown | unknown | blank |

The last case deliberately withholds both identities when the complete pair cannot be located reliably. It does not assign the remaining rectangle by guess. Pixel inspection of the supplied blank template, using a manually supplied row location, also recognized its two empty boxes; that check was separate from the automated OCR runs.

Browser testing used the actual product intake/review components connected to a disposable PostgreSQL database and real OCR/upload/save endpoints on a separate local test server. Production authentication was unchanged. The marked sample extracted Oo checked / Hindi unchecked, saved successfully, and reopened with those exact states. The attorney control was then used to change Oo to Unknown; after PATCH and a fresh GET, the reopened view showed Oo Unknown / Hindi Unchecked, blank summary, and NULL compatibility value. This was a controlled UI correction exercise, not a claim that the clearly marked synthetic scan was unreadable.

Local evidence: [reopened unknown state](../.local/checkbox-review/reopened-unknown.png). Raw before/after results and synthetic scan images are ignored artifacts under `.local/checkbox-review/`; no real document or transcript was committed.

Automated checks:

- 147 Python tests ran successfully, one optional Tesseract test skipped. Focused pixel tests also passed again after adding cropped-coordinate guards.
- 21 frontend tests passed, including unknown preservation and exclusive-pair summary mapping.
- Disposable-database API smoke checks passed for create/update/reopen and all six representative state pairs: Oo selected, Hindi selected, both empty, one unknown, both checked, and both unknown. They verified exact JSON states and true/false/NULL projections, metadata preservation on omitted updates, rejection of boolean coercion, and unchanged legacy data.
- Frontend typecheck, production build, and `git diff --check` passed. Existing bundle-size and Browserslist warnings remain.

## Limits

The detector targets the supplied form's two-choice suffix-box layout. Heavy skew, touching strokes, incomplete borders, low contrast, alternate layouts, or OCR that cannot locate the row can yield Unknown even when a human can read the scan. Attorney correction is the recovery path. This is not a handwriting accuracy benchmark. Cloud-only text extraction intentionally leaves these states unknown. Historical source coordinates are not reloaded in saved review views, although the saved states and complete original are retained; re-extraction can refresh evidence in the editable workflow. No case-level detention flags, year-end inventory fields, unrelated form sections, or account-security workflows were redesigned.

## Camera contrast follow-up

A later user-supplied crop exposed a false checked result on an empty, narrow box with a gray camera background and blurred borders. The classifier now estimates nearby paper brightness, excludes border bleed, and requires intact borders before declaring a box empty. A clear interior mark can remain checked when it obscures one edge; an obscured edge without a clear mark stays unknown. Synthetic regression cases cover gray backgrounds, blurred narrow boxes, faint ink, and occluded edges. All 21 focused checkbox/intake/evidence tests passed. The provided crop was checked at manually located box coordinates; this is not verification of automatic full-sheet location or a new save/reopen test.

A subsequent live OCR test of a complete synthetic sheet with reduced exposure and blur exposed joined option labels (OoHindi). The locator now restores that label boundary without deriving mark states from text. The rerun passed automatic location, real extraction, reviewed API save, and a fresh API reopen with Oo checked / Hindi unchecked. The saved result displayed correctly in the product review component. All 22 focused tests passed, including merged labels with marked, empty, and faint boxes. A disposable database was used; the user's complete sheet has not been tested.
