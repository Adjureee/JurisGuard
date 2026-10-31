# Local intake OCR review

The full-document local pipeline preserves the first OCR pass and, when both
printed applicant section boundaries and the education label are detected,
re-reads the two applicant columns with autocontrast and up to 2x enlargement.
This uses the configured local models; it does not download models or call a
cloud service. Set `LOCAL_OCR_REFINE_INTAKE=false` to disable the extra passes.
The additional passes consume CPU time and remain subject to the existing worker
deadline. Client-only extraction does not run this refinement.

Applicant extraction uses label positions within the section rather than the
next arbitrary line of OCR. Malformed phone, email, income, age, sex and numeric
date candidates are withheld from the corresponding fields. Validation checks
format only: a plausible phone number or name can still be wrong.

Diagnostics retain `ocr_refinements` and `applicant_field_evidence`, including
source boxes, model scores, rejected candidates and first-pass disagreements.
Scores are model outputs, not calibrated probabilities of correctness. All
image intake outputs require review. Checkbox values in sectioned results are
null (unverified); text OCR alone does not establish checkbox state.

Limitations: this change does not replace the handwriting model, correct names
or locations, implement visual checkbox recognition, or fix all legacy header
and representative extraction. Missing section anchors retain the legacy text
parser with a review warning. Partial pages and poor handwriting need particular
care. Do not promote these candidates to verified case records automatically.

Regression tests use synthetic text and images in
`tests/backend/test_intake_layout.py`. Real-document evaluation files belong in
ignored local folders and must never be committed.
