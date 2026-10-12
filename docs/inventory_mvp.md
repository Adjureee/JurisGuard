# Offline inventory extraction MVP

This is a standard-library, rule-based foundation. It does not train or require a model, call a cloud API, or download anything at runtime.

## Minimal layout

```text
backend/inventory_mvp/
  __init__.py       public imports
  schema.py         exact 21-field inventory and fresh initializer
  router.py         weighted routing, separate extractors, diagnostics
tests/
  test_document_router.py   synthetic-only regression examples
```

The existing FastAPI, OCR, and spaCy code is outside this MVP. Feed **one logical document's OCR string** to `DocumentRouter.process`. Keep the original OCR string in the caller's document store. The router creates a separate normalized working copy and keeps line boundaries; `process` does not store or alter the original string.

## Run locally

From the repository root, with Python 3.10 or later:

```powershell
python -m unittest discover -s tests -p test_document_router.py -v
```

Use the router in Python:

```python
from backend.inventory_mvp import DocumentRouter

result = DocumentRouter().process(ocr_text)
print(result["document_type"])
print(result["inventory"])
print(result["diagnostics"])
print(result["needs_review"])
```

`classify_document(text)` returns `intake_form`, `rtc_decision`, `sandiganbayan_document`, `unknown`, or `ambiguous`. `extract_intake_form(text)` and `extract_rtc_decision(text)` each return only the exact inventory dictionary. `process(text)` adds routing diagnostics and the review flag. Sandiganbayan pages are classified separately, with an empty 21-field inventory and review required until their field mappings are approved. If a likely concatenation is detected, `process` and the direct extractors return an empty inventory, and `process` requests review.

The constructor accepts `min_score`, `min_signal_groups`, `competing_score`, and `ambiguity_margin`. Matched signal names, independent signal groups, and raw additive point totals appear in `diagnostics`. These totals are **uncalibrated heuristic scores**, not probabilities or field confidence. A type must reach the minimum score and distinct-group count. Two qualifying types, or a close competitor above `competing_score`, yield `ambiguous`. Generic `Name` or `DECISION` alone cannot route a document.

## Current extraction rules

- On an already routed intake form, direct `Name` or `Pangalan` labels map to `Party Represented`. Explicit labels populate control number, sex/gender, address, contact number, place and date of confinement, title, court/body, and case number. Identifiers and phone numbers stay strings. A date must be ISO, a named-month date, or an unambiguous numeric day/month pair. For numeric dates where both positions could be a month, the result is `None`.
- Only direct inventory checkbox labels (`Urban`, `Rural`, `Drugs`, `Female`, `SENIOR`, `CICL`) are interpreted. Explicit checked and empty boxes become `True` and `False`; corrupt or missing marks remain `None`. `Gender/Sex: Female` does not automatically set the separate `Female` flag. `Senior Citizen`, age, and other demographic text do not automatically set inventory flags.
- On an RTC decision, the extractor uses an explicit Regional Trial Court line, an explicit case-number line, and a caption containing `People of the Philippines`, a versus line, and an accused role to populate court/body, case number, and case title. The accused is **not** assumed to be represented by PAO. A decision or promulgation date does not populate termination date or status.
- Field evidence and warnings stay in `diagnostics`, outside the inventory. Conflicting repeated field values remain unresolved. Unknown and ambiguous routing requests human identification through `diagnostics["review_question"]`. Plain OCR often lacks reliable checkbox layout; inspect the source image or OCR bounding boxes when marks or spatial relationships are unclear.

## Limits and next stage

Routing and extraction currently cover a narrow set of explicit labels and caption layouts. The rules can miss handwriting, broken captions, tables, and severe OCR corruption. Repeated `INTERVIEW SHEET` or `REPUBLIC OF THE PHILIPPINES` headings are a conservative concatenation signal, not proof of multiple documents. No court outcome, legal-status, or demographic mapping has been approved beyond the direct rules above.

Next, collect consented, de-identified OCR plus source images and independently annotated ground truth. Establish field definitions and approved mappings with PAO reviewers, then measure routing and field-level errors on held-out real documents. Repair rule failures with regression cases and three clearly labeled synthetic stress variations per failure. Add optional trained NLP only if annotated data and measured results show a benefit; keep local runtime operation.
