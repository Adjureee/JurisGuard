"""Pure mapping from extraction output to JSONB/API payload; no DB writes."""

from __future__ import annotations

from typing import Any

from inventory_mvp import empty_inventory, validate_inventory


_FAILED_MODES = {"OFFLINE_OCR_FAILED", "OFFLINE_OCR_EMPTY", "ONLINE_MISTRAL_FAILED", "ONLINE_MISTRAL_TIMEOUT"}


def public_extraction_payload(extracted: dict[str, Any]) -> dict[str, Any]:
    inventory = extracted.get("inventory")
    warnings: list[str] = []
    try:
        validate_inventory(inventory)
    except ValueError:
        inventory = empty_inventory()
        warnings.append("Unified inventory was missing or invalid; human review required.")
    diagnostics = extracted.get("diagnostics")
    if not isinstance(diagnostics, dict):
        diagnostics = {}
    else:
        diagnostics = dict(diagnostics)
    diagnostics["warnings"] = list(diagnostics.get("warnings") or []) + warnings
    sections = extracted.get("sections")
    if not isinstance(sections, dict):
        sections = {}
    return {
        "sections": sections,
        "extraction_mode": extracted.get("extraction_mode"),
        "raw_text": extracted.get("raw_text") if isinstance(extracted.get("raw_text"), str) else "",
        "document_type": extracted.get("document_type", "unknown"),
        "inventory": inventory,
        "diagnostics": diagnostics,
        "needs_review": bool(extracted.get("needs_review", True)) or bool(warnings),
    }


def ocr_status_for_result(extracted: dict[str, Any]) -> str:
    return "FAILED" if extracted.get("extraction_mode") in _FAILED_MODES else "COMPLETED"
