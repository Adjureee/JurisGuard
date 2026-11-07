# UI usability and loading improvements

Work remains on `codex/ui-ux-revamp`. No merge to master was performed.

## Baseline and scope

Reviewed the current method selectors and ChristInsanity's scan/upload and export changes. Retained separate manual and scan/upload entry points, camera selection, capture, crop review, extraction of Parts II/II-A, correction and saving. No field mapping, permission, API, export-row or database changes were made by this UI revision. Existing unrelated working-tree changes were preserved.

Priority issues were a mobile records table collapsing to 2px, desktop filters clipping actions, excessive navigation/dialog space, weak keyboard focus and eager loading of unrelated pages and Excel code.

## Implemented

- Responsive records filters and an independently scrollable, keyboard-focusable table. At 390px, the table has 464px of usable height without horizontal page overflow.
- Clearer table headings, readable row spacing, row hover/focus feedback and 44px controls.
- Smaller sidebar logo and reduced repeated page-category text; descriptive titles and navigation remain.
- Strong keyboard focus, restrained dialog transitions and reduced-motion support. Removed expensive blurred modal backdrops.
- Intake dialogs adapt to document selection versus full scan/field review, without altering conditional stages or actions.
- Lazy page imports and deferred case-transfer spreadsheet library loading. Workbook generation remains unchanged.

## Verification and measurements

`npm run typecheck` and `npm run build` passed. Seventeen focused Node tests passed across classification/export, client-map matching and camera geometry. Synthetic Playwright checks passed for camera crop/reset/retake, cancel-discard, desktop/mobile rendering, original preservation, exact preview image bytes submitted to OCR, review corrections and mocked saving. Analytics checks passed for administrator/staff date filtering (101 clients All dates versus 1 in the recent period).

Initial production entry JavaScript: 2,474,565 to 450,561 bytes; gzip 690,402 to 143,992 bytes. This defers code, rather than removing its functionality.

Local Edge/Vite synthetic-API warm navigation medians, three measured samples per page after one warm-up:

| Page | Before | After |
|---|---:|---:|
| Dashboard | 1366ms | 1152ms |
| Analytics | 1542ms | 1232ms |
| Cases | 1601ms | 1169ms |

These are small development measurements, not production latency guarantees. API request counts were unchanged; React development StrictMode and shared dashboard consumers still produce duplicate requests.

Before/after desktop dashboard, analytics, records, method-selection and mobile records screenshots are in Git-ignored `.local/ui-revamp/`. Synthetic camera screenshots are in `.local/camera-image-review/`. No private document or extracted personal information is included in this report.

## Remaining checks

Live NETUM hardware, real OCR quality, cloud modes, full manual case creation with real database persistence, live export downloads and an exhaustive keyboard/screen-reader audit were not verified in this revision. Existing export regression tests validate contents/grouping, not browser download behavior. Dashboard and analytics retain their existing distinct information and calculations; no extensive chart redesign was attempted. Further workflow or process changes require review before implementation.
