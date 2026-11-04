# PAO paper intake: Parts II and II-A

## Entry methods and field review

Add Client offers **Manual entry** and **Scan or upload PAO sheet**. Manual entry
uses the existing `/api/clients/` service, supports review before save, and needs
neither a document nor an OCR result. It does not create paper verification metadata.
Unknown manual ages are shown empty and stored as NULL by the existing API, and
citizenship and representative details are never prefilled. Client classifications
are optional and are not inferred from sex, age, or other personal details.

Local paper extraction uses label positions and separate columns, including the
existing higher-detail OCR candidates. It does not join neighbouring columns into
one person's name or address. Recognized printed label variants are handled only
as labels; answers themselves are not corrected using dictionaries or other fields.

The attorney scans, reviews/corrects Parts II and II-A beside the complete original,
and selects **Save reviewed record**. There is no per-field status control or extra
review-confirmation checkbox. Extraction diagnostics remain advisory; missing OCR
text never establishes a visibly blank answer or an unchecked box. Nakakulong
retains its actual Oo/Hindi answer control, including an empty/unverified choice.
When Part II-A is empty the screen shows **No representative details provided**;
entering representative information is optional. Fields follow the paper's row
order in the DOM, with visible keyboard focus and at least 44px-high controls.

The simplified save request omits `field_reviews` and `unreadable_fields`. Existing
status values and flags are preserved when omitted on update, and shown separately
as previously recorded notes. They neither gate saves nor get inferred from text
changes. New records need no status metadata. Optional legacy status metadata is
still checked for known field keys and enum values, but no complete status map is
required. Schema checks and valid Oo/Hindi/empty answers remain enforced.

Save failures leave text edits in place, focus an inline error explaining how to
retry, and re-enable **Save reviewed record**. Successful saves show an explicit
success message. Manual entry, case management, account security and inventory
workflows are unchanged by this simplification.

**Re-extract original scan** returns a fresh draft using the retained file, with
the same access checks as scan viewing. It replaces unsaved edits only after OCR
succeeds; it does not rewrite original extraction evidence or a saved review.
Corrections and field states still require explicit review and save.

The intake entry point retains camera capture and image/PDF upload. It sends the
existing upload API `extraction_target=paper_intake`. Auto and offline run locally;
Cloud Vision remains an explicit selection and uses the same two-section contract.
Case extraction and year-end inventory use their existing paths.

The field labels and paired rows follow the supplied FOSS.F.003/REV.3 sheet
(effective 14 April 2023). Part II is always the applicant. Part II-A is independent
and may be entirely empty. No citizenship, age, civil status, classification, or
detention state is supplied by default. A missing section boundary withholds its
values and requires review. OCR uses adjacent labelled text within each section;
it does not fill missing handwriting from another section. Unmarked or ambiguous
detention checkboxes remain empty for the attorney to review.

The review shows the complete original scan beside editable text for these two
sections only. The attorney can correct OCR, clear an erroneous candidate, or mark
an unreadable field (which must remain empty). Changing text invalidates the review
confirmation. A new scan clears all prior candidates and review state.

## Storage and existing data

On backend startup, SQLAlchemy creates the additive `reviewed_paper_intake` table.
There is no backfill, drop, or rewrite of existing records. The new table stores
only the two reviewed section dictionaries, unreadable field identifiers, source
document ID, reviewer, and review timestamp. The exact reviewed strings are the
authoritative intake values, including ages, dates, income, spelling, and blanks.
Typed client compatibility fields receive only directly representable values;
the full original text is never truncated to fit an old varchar column.

Original scans remain in the existing document upload storage, and original OCR
metadata remains separate from the reviewed values. The saved record can reopen
the complete original using an authenticated blob request. Saved paper intakes
have their own scoped correction screen. Legacy client records keep their prior
views. No interview classification, case involvement, consent, affidavit, or proof
of indigency fields are created by this intake workflow.

The new scan/read/save routes use existing authentication and record-access checks.
A source-document lock prevents two saves of the same sheet. New reviewed intake
saves and later corrections use the existing audit trail. The original file is
not cropped or replaced.

## Verification

From the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m unittest tests.backend.test_paper_intake -v
.\backend\venv\Scripts\python.exe -m unittest tests.test_paper_intake_ocr -v
.\backend\venv\Scripts\python.exe tests\paper_intake_api_smoke.py
```

The manual API smoke check creates a randomly named disposable local PostgreSQL
database and removes only that database on completion. It verifies upload, exact
original-file retrieval, applicant/representative separation, reviewed corrections,
blank fields, duplicate saves, unauthorized access, and preservation of a legacy
record. It never inserts test accounts or case records into the configured database.
OCR fixtures are synthetic and do not establish accuracy on real handwriting.

Also run the consolidated Python suite and frontend type checking/build. Live cloud
inference requires configured credentials; unit tests mock its response. Camera
hardware and real handwritten-paper accuracy require operator testing.
