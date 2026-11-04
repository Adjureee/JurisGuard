# OCR review usability verification

## Review-screen update — 4 November 2026

The attorney review screen now gives one instruction to compare all extracted entries and the Oo/Hindi boxes with the original scan. It no longer displays per-field “uncertain OCR candidate” messages or the expanded OCR review-notes panel. OCR diagnostics and candidate snapshots remain in the extraction data; blank entries and unknown checkbox states remain blank or unknown for human verification. Actual scan-loading and extraction failures still have actionable messages.

**Open full size** now opens the original scan in a modal instead of a new tab. The modal has Fit, Actual size, Zoom out, Zoom in, Rotate 90°, drag and arrow-key panning, a Close viewer button, Escape handling, and focus return to the trigger. The inline preview keeps its existing controls. A browser test using a synthetic camera scan exercised the full-size controls, closed the dialog with Escape, corrected an applicant field, saved the record, and confirmed that the original scan was retained. Frontend typecheck, production build, and six focused review/geometry tests passed. The production build still reports its existing large-chunk advisory.

This update was checked with a synthetic sheet in a browser; physical camera capture, real handwriting, and screen-reader interaction were not verified in this update. If a PDF page preview cannot render, the browser's embedded PDF viewer provides its own controls.

Verified on 3 November 2026 using the running React components, real local PaddleOCR, the real FastAPI upload/save routes, and a disposable PostgreSQL database. A synthetic test owner was supplied only by the separate test server on port 8001. Production account security was not changed. No real legal documents were used.

## Findings and changes

The previous modal spent substantial height on upload controls before the review area. Its sticky preview, outer modal scrolling, and sticky save controls made field comparison difficult. The new viewport-sized workspace places the scan and fields side by side from 1024px, collapses replacement-upload controls after extraction, and gives the fields one clearly bounded scroll area. Section navigation and the save footer are structural siblings, so they cannot overlay inputs. Expanded OCR notes and replacement settings have bounded heights.

The scan offers Fit, zoom, quarter-turn rotation, pointer-drag panning, keyboard arrow panning, and a full-size original link. Image and source rectangle share the same transform. Focusing a field outlines its available OCR evidence. PDF page previews render locally at the same scale used by OCR, retain ownership checks, expose page count, and keep the complete original accessible. Unavailable previews fall back to the original PDF. No coordinates are invented.

Part II and Part II-A retain the server schema's printed order and separate identities. Section buttons scroll and focus the requested section. Below the desktop breakpoint, explicit Original scan / Extracted fields buttons switch panes; each field has a View scan action. Missing OCR text remains distinct from a visibly blank paper. Empty unverified fields receive a warning, uncertain candidates retain a warning beside the value, and checkbox candidates still require checking the actual marks.

Close, change method, replacement upload, and re-extraction request confirmation for an unsaved draft. Cancelling keeps corrections. Browser unload also warns. Save failures preserve values, focus an actionable error, and leave Save reviewed record available for retry. The manual client creation option remains available. No status selector or status completion requirement was added.

## Actual test

1. Uploaded a clearly marked synthetic 1800 × 1500 PAO-style sheet, including all 18 applicant fields, all eight representative fields, a visibly marked Oo checkbox, and an out-of-scope Part III retained in the scan.
2. Local extraction returned `OFFLINE_PAPER_INTAKE`, all 26 expected values, and 26 source boxes. Values were compared with the synthetic source; applicant and representative shared labels stayed separate. The perfect printed fixture did not require an OCR repair, so an explicit temporary synthetic address edit exercised the correction path. This is a usability test, not a handwriting accuracy benchmark.
3. At 1440 × 900, the two panes each had about 596px of height. Pressing Tab through the 26 fields reached each once in paper order. Every focused input was fully inside the field viewport, with a solid visible focus outline. Source highlighting remained available while scrolling.
4. Tested zoom, quarter-turn rotation, keyboard panning, Fit, and opening the actual retained image at its native 1800 × 1500 dimensions in another tab.
5. Cancelled the discard confirmation and checked the address edit remained. Injected one client-side connection interruption before a save request; checked that the inline error explained retry and the edit remained. The subsequent request reached the real save endpoint successfully.
6. At an emulated 390 × 844 viewport, switched between scan and fields, used representative section navigation, and confirmed Save remained inside the viewport with no horizontal overflow. A browser unload attempt was cancelled and also retained the draft.
7. Read the saved client back through the API. Only the two requested sections were present, the exact edited text persisted, and the representative name remained separate. The retained original's SHA-256 matched the upload: `7f5344f1613d98b3afb7340af770e3771b4a6e01a1953f0cc80f09e5121048d9`.

Screenshots are local, ignored test artifacts:

- [Before: real extraction in previous layout](../.local/ocr-usability/before.png)
- [After: desktop review and retained edit after failed save](../.local/ocr-usability/after-desktop.png)
- [After: small-screen scan view with source outline](../.local/ocr-usability/after-mobile.png)
- [After: saved record at 390px](../.local/ocr-usability/after-mobile-390.png)
- [Successful save message](../.local/ocr-usability/saved.png)

## Automated verification

- Python discovery: 143 tests, OK, one optional Tesseract test skipped.
- Frontend Node tests: 20 passed, including new scan-fit tests for portrait, landscape, rotation, and hidden/unloaded dimensions.
- Disposable-database API smoke check: passed. Added checks for protected page-preview access, invalid pages, image-versus-PDF validation, synthetic two-page PDF rendering at OCR scale, page count, and private/no-store caching.
- Frontend typecheck and production build: passed. Existing bundle-size and Browserslist-age warnings remain.
- Cleanup: stopped the separate test server and removed its two verified synthetic databases. Restarted the normal backend and confirmed database health and registration of the page-preview route.

## Remaining limitations

- This was a synthetic printed-sheet test, not a study with attorneys or a benchmark of real handwriting. Actual poor handwriting, shadows, skew, and faint marks still require human comparison. Camera hardware, touch dragging on a physical device, and screen-reader behavior were not tested.
- Coordinates are available during a fresh extraction. Reopened saved records currently do not reload historical OCR coordinate diagnostics; they show that coordinates are unavailable. An editable record can re-extract its retained original after confirmation. Saved text is not silently overwritten.
- PDF rendering and access were checked with synthetic API tests; the complete interactive PDF scan-to-save path was not repeated in the browser. The completed browser path used PNG.
- Corrections are held in memory until saving. Discard/unload confirmations reduce accidental loss but do not recover edits after a browser or computer crash.
- Small screens show fewer fields at once, especially while an error is visible. The persistent section navigation and scan/fields switch make the rest reachable; a physical phone with an open software keyboard still needs device testing.
