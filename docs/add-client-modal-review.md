# Add Client modal refinement — November 5, 2026

## Implemented

The initial method/document selection fits a compact 768px-wide dialog with
content-driven height, capped to the viewport. Crop/extraction/detail review
expands to the available desktop width and 95dvh. On smaller screens the existing
scan/fields switch remains available. Original images are retained by the existing
upload API; OCR output remains limited to Parts II and II-A.

Upload PAO Sheet and Scan with Camera are balanced, labeled choices with Lucide
icons. Upload supports keyboard file selection and drag/drop; filename, size and
image preview appear before extraction. Replacement is explicit and confirmed.
The browser-default file input is hidden behind an accessible upload button.
PDF selection shows a file representation; its full original is available on the
existing review viewer after extraction.

Whole-page processing remains the default. Optional section crops reconnect the
existing local capture-analyze endpoint and crop_plan upload contract. Suggested
boundaries are displayed and adjustable with keyboard-operable sliders. Page
corners can be edited numerically, with rotation; geometric edits require a
rebuilt preview before confirmation. Both sections require an attorney check,
including blank Part II-A and box marks. Uncertain headings are explained and
whole-page processing remains available. The original capture is uploaded in
both modes; the backend creates the OCR preparation separately.

Selection, optional crop review, extraction, detail review and save stages are
shown explicitly. OCR engine explanations distinguish local processing from
automatic/cloud routing. Extraction begins with an explicit primary action,
not immediately after selecting a file. Existing extraction cancellation,
progress timing, scan controls, applicant/representative fields, tri-state boxes,
unreadable flags and save error handling remain.

Close, Change method and Discard entry are separate actions. Selected documents
and corrections trigger confirmation; cancel retains the work. Manual client
edits also report dirty state. The dialog traps keyboard focus while active,
respects nested confirmation dialogs, supports Escape with confirmation, and
uses visible focus and 44px control targets. The existing modal portal restores
focus and body scrolling on close.

## Verification

- `npm run typecheck` and `npm run build` passed. Existing bundle-size and
  Browserslist warnings remain.
- `tests/intake_modal_browser_check.py` passed with synthetic API responses:
  file validation, compact selection, visible filename, focus wrap, cancel-close
  confirmation, optional crop acknowledgement and boundary adjustment, extraction,
  all editable Part II/II-A fields reachable, correction, failed-save edit
  preservation, retry, success, phone/tablet layouts, and simulated camera
  preview/capture through OCR review. No production records are written.
- `tests/paper_browser_roundtrip.py` passed using real cached local PaddleOCR
  and an isolated temporary PostgreSQL database. It preserves reviewed names,
  independent people, leading-zero phone digits, date, unreadable flag and Oo /
  Hindi box states after save/reopen. Its synthetic sheet returned Oo unchecked
  and Hindi checked. No cloud inference was used. Its Playwright upload bridge
  re-encodes the selected fixture through TestClient; this is not a raw HTTP
  multipart transport test.
- Seven existing `tests.backend.test_paper_capture` tests passed for crop
  validation/preparation and source-coordinate behavior.
- Before, selection, crop, review, save-error, success and responsive screenshots
  are in local Git-ignored `.local/intake-redesign/`. The before screenshot was
  captured from the previous implementation. All screenshots contain synthetic
  data. A development hot-reload interrupted one integration attempt; the
  unchanged-interface rerun passed.

```powershell
.\backend\venv\Scripts\python.exe tests/intake_modal_browser_check.py
.\backend\venv\Scripts\python.exe tests/paper_browser_roundtrip.py
$env:PYTHONPATH='backend;.'
.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_paper_capture -q
```

Run the browser scripts with Vite on localhost:5173 and the required local
dependencies. The real-OCR script also requires local PostgreSQL/cached models.

## Remaining limits

Camera verification used the browser's simulated camera, not physical NETUM
hardware. Real device availability, driver permissions and captured handwriting
quality need a hardware check. PDF section cropping supports single-page PDFs;
multi-page documents can use whole-page processing. Page corners use accessible
numeric controls rather than drag handles. Small screens require ordinary
vertical scrolling and the scan/fields switch. No OCR accuracy or model training
claim follows from this interface change.
