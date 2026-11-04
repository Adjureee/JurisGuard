# PAO scan processing

As of 4 November 2026, **Scan with camera** and **Upload PAO sheet** send the complete captured or uploaded page directly to OCR. There is no processing-mode choice or section-crop review in the attorney intake flow. Extraction returns only Part II applicant and Part II-A representative fields, and the complete original remains available for attorney comparison and correction. A captured camera photo can still be checked or retaken before extraction. If OCR fails or is cancelled, the same scan can be retried.

The backend still recognizes older crop-mode diagnostics and records. It accepts the historical optional crop-plan upload parameter for compatibility, but the current frontend does not send it. Whole-page PDFs use local or auto OCR; the configured cloud mode does not accept an uncropped PDF.

Candidate text, OCR diagnostics, and three-state checkbox results remain subject to attorney correction. A blank Part II-A remains empty. Each new extraction records `whole_page` in diagnostics; older crop-mode records are preserved.

## Current verification

- A synthetic camera photo and the same uploaded JPEG both went directly from capture/upload to local OCR review, with no crop controls or processing-mode choice. Both produced applicant and representative fields, retained Oo checked/Hindi unchecked, allowed an attorney correction, saved successfully, and reopened with the complete original scan.
- A simulated 503 upload failure exposed **Retry OCR**. Retrying the same uploaded file completed extraction and save without selecting the file again.
- Frontend typecheck and build, six focused frontend tests, and 20 backend intake/checkbox tests passed. Physical camera hardware and real handwriting were not tested in this update.

## Earlier crop-mode verification (historical)

- The same synthetic PAO-style JPEG produced identical Part II and II-A field dictionaries in local whole-page and reviewed-crop OCR: seven populated applicant fields, six populated representative fields, and Nakakulong **Oo checked / Hindi unchecked**. The original SHA-256 did not change.
- A second synthetic version with blank Part II-A produced zero representative values in both modes while preserving the applicant fields and Oo/Hindi states.
- Synthetic geometry tests cover tilted and clipped pages, missing headings, review validation, selected-region preparation, evidence coordinate mapping, quarter-turn rotation, single-page PDF rendering, and multi-page PDF rejection from crop review.
- Browser tests completed all four camera/upload and crop/whole-page combinations through OCR review, correction, save, and authenticated retrieval with the original scan. A single-page PDF also completed the crop path. A simulated uncertain heading result showed the warning and allowed switching from crop review to whole-page processing, then saving successfully. Preparation mode remained in the saved candidate diagnostics.
- Browser tests use a disposable local PostgreSQL database and synthetic camera/upload data. No real legal document belongs in fixtures or committed output.

Run the focused checks from the repository root:

```powershell
$env:PYTHONPATH='backend'
.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_paper_capture tests.backend.test_paper_checkboxes tests.backend.test_paper_intake tests.backend.test_paper_review_evidence
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run build
```
