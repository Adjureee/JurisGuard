"""Ground-truth checks and exact-match OCR/NLP diagnostics."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence

from .schema import DOCUMENT_TYPES, INVENTORY_FIELDS, validate_inventory


def load_ground_truth(path: str | Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        truth = json.load(handle)
    if not isinstance(truth, dict) or truth.get("document_type") not in DOCUMENT_TYPES:
        raise ValueError("ground truth needs a valid document_type")
    validate_inventory(truth.get("inventory"))
    if "reference_text" in truth and not isinstance(truth["reference_text"], str):
        raise ValueError("reference_text must be a string")
    if truth.get("sample_origin", "synthetic") not in {"synthetic", "real"}:
        raise ValueError("sample_origin must be synthetic or real")
    return truth


def edit_distance(reference: Sequence[Any], hypothesis: Sequence[Any]) -> int:
    """Levenshtein distance with linear memory; inputs may be characters or words."""
    previous = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(hypothesis, 1):
            current.append(min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def ocr_metrics(reference_text: str, raw_ocr_text: str) -> dict[str, float | int | None]:
    characters = edit_distance(reference_text, raw_ocr_text)
    reference_words, ocr_words = reference_text.split(), raw_ocr_text.split()
    words = edit_distance(reference_words, ocr_words)
    return {
        "character_edits": characters,
        "reference_characters": len(reference_text),
        "cer": characters / len(reference_text) if reference_text else (0.0 if not raw_ocr_text else None),
        "word_edits": words,
        "reference_words": len(reference_words),
        "wer": words / len(reference_words) if reference_words else (0.0 if not ocr_words else None),
    }


def compare(result: dict[str, Any], truth: dict[str, Any], raw_ocr_text: str | None = None) -> dict[str, Any]:
    if truth.get("document_type") not in DOCUMENT_TYPES:
        raise ValueError("ground truth needs a valid document_type")
    validate_inventory(truth.get("inventory"))
    validate_inventory(result.get("inventory"))
    if result.get("document_type") not in DOCUMENT_TYPES:
        raise ValueError("result needs a valid document_type")
    fields: dict[str, dict[str, Any]] = {}
    for name in INVENTORY_FIELDS:
        expected, actual = truth["inventory"][name], result["inventory"][name]
        if expected == actual and type(expected) is type(actual):
            status = "match"
        elif expected is None:
            status = "unsupported_extraction"
        elif actual is None:
            status = "missing_extraction"
        else:
            status = "incorrect_extraction"
        fields[name] = {"expected": expected, "actual": actual, "status": status}
    matched = sum(item["status"] == "match" for item in fields.values())
    expected_present = sum(value is not None for value in truth["inventory"].values())
    present_matched = sum(truth["inventory"][name] is not None and item["status"] == "match" for name, item in fields.items())
    ocr = ocr_metrics(truth["reference_text"], raw_ocr_text) if "reference_text" in truth and raw_ocr_text is not None else None
    hints: list[str] = []
    if result["document_type"] != truth["document_type"]:
        hints.append("Classification mismatch: inspect routing signals and the annotated document type.")
    if ocr and (ocr["character_edits"] or ocr["word_edits"]):
        hints.append("OCR differs from reference: inspect text and boxes before changing extraction rules.")
    if matched < len(INVENTORY_FIELDS):
        hints.append("Field mismatches: inspect source evidence, mapping rules, and annotation consistency; this report cannot decide which is wrong.")
    return {
        "sample_id": truth.get("sample_id"),
        "sample_origin": truth.get("sample_origin", "synthetic"),
        "classification": {"expected": truth["document_type"], "actual": result["document_type"], "match": result["document_type"] == truth["document_type"]},
        "fields": fields,
        "field_exact_match_rate": matched / len(INVENTORY_FIELDS),
        "non_null_expected_match_rate": present_matched / expected_present if expected_present else None,
        "ocr": ocr,
        "diagnosis_hints": hints,
    }
