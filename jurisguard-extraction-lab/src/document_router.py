"""Explainable, weighted routing for one logical OCR document."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .extractors import (
    _lines,
    extract_intake,
    extract_intake_form,
    extract_rtc,
    extract_rtc_decision,
    extract_sandiganbayan,
    extract_sandiganbayan_document,
)
from .schema import empty_inventory


@dataclass(frozen=True)
class _Signal:
    name: str
    group: str
    points: int
    pattern: str


_INTAKE = (
    _Signal("interview_sheet", "heading", 5, r"\bINTERV[I1]EW\s+SHEET\b"),
    _Signal("intake_heading", "heading", 3, r"\b(?:PAO\s+)?(?:CLIENT\s+)?INTAKE\s+(?:FORM|SHEET)\b"),
    _Signal("pao_office_heading", "heading", 2, r"\b(?:Rehiyon\s+[IVX0-9]+\s+)?District\s+Office\s+PAO\b"),
    _Signal("request_section", "request", 3, r"\bURI\s+NG\s+INIHIHINGI\s+NG\s+TULONG\b"),
    _Signal("applicant_section", "applicant", 3, r"\bIMPORMASYON\s+UKOL\s+SA\s+APLIKANTE\b"),
    _Signal("control_number_label", "identifier", 2, r"(?m)^\s*Control\s+No\.?\s*[:：]"),
    _Signal("pangalan", "identity", 2, r"(?m)^\s*Pangalan\s*[:：]"),
    _Signal("name", "identity", 1, r"(?m)^\s*Name\s*[:：]"),
    _Signal("age", "identity", 1, r"\b(?:Edad|Age)\s*[:：]"),
    _Signal("contact", "contact", 2, r"(?m)^\s*Contact\s*(?:No\.?|Number)\s*[:：]"),
    _Signal("address", "contact", 1, r"(?m)^\s*(?:Address|Tirahan)\s*[:：]"),
    _Signal("detention", "detention", 2, r"\b(?:detained|nakakulong|detention|confinement)\b"),
    _Signal("demographic", "classification", 1, r"\b(?:Senior\s+Citizen|CICL|Child\s+in\s+Conflict\s+with\s+the\s+Law|VAWC\s+Victim)\b"),
)
_RTC = (
    _Signal("republic", "heading", 2, r"\bREPUBLIC\s+OF\s+THE\s+PHILIPPINES\b"),
    _Signal("regional_trial_court", "court", 4, r"\bREGIONAL\s+TR[I1l]AL\s+COURT\b"),
    _Signal("people_caption", "caption", 2, r"\bPEOPLE\s+OF\s+THE\s+PHILIPPINES\b"),
    _Signal("versus", "caption", 2, r"(?m)^\s*-?\s*(?:versus|vs?\.?)\s*-?\s*$"),
    _Signal("accused", "caption", 1, r"\bACCUS[EI]D\b"),
    _Signal("decision", "decision", 1, r"(?m)^\s*DEC[I1]SION\s*$"),
    _Signal("case_number", "case", 2, r"\b(?:Criminal\s+)?Case\s+No\.\s*[:：]?\s*[A-Z0-9]"),
    _Signal("separator", "layout", 1, r"(?m)^\s*x-{5,}x\s*$"),
)
_SANDIGANBAYAN = (
    _Signal("sandiganbayan_heading", "court", 6, r"\bSan[db][i1]ganba[ypt]a[nl]\b"),
    _Signal("sandiganbayan_case_number", "identifier", 5, r"\bSB\s*[-–]\s*\d{2}\s*[-–]\s*(?:CRM|SCA|A\s*/?\s*R)\s*[-–]?\s*\d{3,5}\b"),
    _Signal("case_label", "case", 1, r"\bCASE\s+NO\b"),
    _Signal("division_heading", "division", 2, r"(?m)^\s*(?:SPECIAL\s+)?(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|\d+(?:ST|ND|RD|TH)?)\s+DIVISION\b"),
    _Signal("people_caption", "caption", 1, r"\bPEOPLE\s+OF\s+THE\s+PHILIPPINES\b"),
    _Signal("republic_heading", "heading", 1, r"\bREPUBLIC\s+OF\s+THE\s+PHILIPPINES\b"),
)


def _court_header_cues(raw_text: str) -> tuple[bool, bool]:
    first_lines = [line.work for line in _lines(raw_text) if line.work][:8]
    header = "\n".join(first_lines)
    return (
        bool(re.search(r"(?m)^[ \t'\"“‘]{0,3}San[db][i1]ganba[ypt]a[nl]\b", header, re.I)),
        bool(re.search(r"(?m)^\s*REGIONAL\s+TR[I1l]AL\s+COURT\b", header, re.I)),
    )


def _out_of_scope_court_signal(raw_text: str) -> str | None:
    header = "\n".join(line.work for line in _lines(raw_text) if line.work)[:3000]
    # Blackletter headings can turn d into b and y into p (observed in OCR).
    if re.search(r"\bSan[db][i1]ganba[ypt]a[nl]\b", header, re.I):
        return "sandiganbayan_heading"
    if re.search(r"\bSB\s*[-–]?\s*\d{2}\s*[-–]?\s*[A-Z]{2,4}\s*[-–]?\s*\d{3,5}\b", header[:800], re.I):
        return "sandiganbayan_case_number"
    return None


class DocumentRouter:
    def __init__(self, *, min_score: int = 5, min_groups: int = 2, competing_score: int = 4, ambiguity_margin: int = 2) -> None:
        if min_score < 1 or min_groups < 1 or competing_score < 0 or ambiguity_margin < 0:
            raise ValueError("invalid routing threshold")
        self.min_score = min_score
        self.min_groups = min_groups
        self.competing_score = competing_score
        self.ambiguity_margin = ambiguity_margin

    def classify_document(self, raw_text: str) -> str:
        return self._classify(raw_text)[0]

    def extract_intake_form(self, raw_text: str) -> dict[str, str | bool | None]:
        if self._concatenated(raw_text):
            return empty_inventory()
        return extract_intake_form(raw_text)

    def extract_rtc_decision(self, raw_text: str) -> dict[str, str | bool | None]:
        if self._concatenated(raw_text) or self.classify_document(raw_text) != "rtc_decision":
            return empty_inventory()
        return extract_rtc_decision(raw_text)

    def extract_sandiganbayan_document(self, raw_text: str) -> dict[str, str | bool | None]:
        if self._concatenated(raw_text) or self.classify_document(raw_text) != "sandiganbayan_document":
            return empty_inventory()
        return extract_sandiganbayan_document(raw_text)

    def process(self, raw_text: str) -> dict[str, Any]:
        kind, diagnostics = self._classify(raw_text)
        inventory = empty_inventory()
        if diagnostics["suspected_concatenation"]:
            diagnostics["warnings"].append("Possible concatenated documents; separate and review before extraction.")
            diagnostics["review_question"] = "Are several documents present? Split into one OCR string per document."
        elif kind == "intake_form":
            extraction = extract_intake(raw_text)
            inventory = extraction.inventory
            diagnostics["field_evidence"] = extraction.field_evidence
            diagnostics["warnings"].extend(extraction.warnings)
        elif kind == "rtc_decision":
            extraction = extract_rtc(raw_text)
            inventory = extraction.inventory
            diagnostics["field_evidence"] = extraction.field_evidence
            diagnostics["warnings"].extend(extraction.warnings)
        elif kind == "sandiganbayan_document":
            extraction = extract_sandiganbayan(raw_text)
            inventory = extraction.inventory
            diagnostics["field_evidence"] = extraction.field_evidence
            diagnostics["warnings"].extend(extraction.warnings)
            if inventory["Case No."] is None:
                diagnostics["review_question"] = "Confirm the Sandiganbayan criminal case number from the source image."
        else:
            if diagnostics["out_of_scope_court_signal"]:
                diagnostics["warnings"].append("Court heading or case number suggests Sandiganbayan; RTC mapping is unsupported and requires review.")
                diagnostics["review_question"] = "Is this a Sandiganbayan document? Confirm whether to use a separate extractor."
            else:
                diagnostics["warnings"].append("Human document-type identification required before extraction.")
                diagnostics["review_question"] = "Is this an intake form or RTC decision?"
        return {
            "document_type": kind,
            "inventory": inventory,
            "diagnostics": diagnostics,
            "needs_review": kind in {"unknown", "ambiguous"} or diagnostics["suspected_concatenation"] or bool(diagnostics["warnings"]),
        }

    def _classify(self, raw_text: str) -> tuple[str, dict[str, Any]]:
        working = "\n".join(line.work for line in _lines(raw_text))
        scores: dict[str, int] = {}
        matched: dict[str, list[dict[str, str | int]]] = {}
        groups: dict[str, int] = {}
        for kind, signals in (("intake_form", _INTAKE), ("rtc_decision", _RTC), ("sandiganbayan_document", _SANDIGANBAYAN)):
            hits = [
                {"signal": signal.name, "group": signal.group, "points": signal.points}
                for signal in signals if re.search(signal.pattern, working, re.IGNORECASE)
            ]
            matched[kind] = hits
            scores[kind] = sum(int(hit["points"]) for hit in hits)
            groups[kind] = len({str(hit["group"]) for hit in hits})
        qualifies = {name: scores[name] >= self.min_score and groups[name] >= self.min_groups for name in scores}
        sand_header, rtc_header = _court_header_cues(raw_text)
        if sand_header and rtc_header:
            kind = "ambiguous"
        elif sand_header and qualifies["sandiganbayan_document"]:
            kind = "ambiguous" if qualifies["intake_form"] else "sandiganbayan_document"
        elif rtc_header and qualifies["rtc_decision"]:
            kind = "ambiguous" if qualifies["intake_form"] else "rtc_decision"
        elif sand_header or rtc_header:
            kind = "unknown"
        elif qualifies["sandiganbayan_document"] and any(hit["signal"] == "sandiganbayan_case_number" for hit in matched["sandiganbayan_document"]):
            kind = "ambiguous" if qualifies["intake_form"] else "sandiganbayan_document"
        else:
            winners = [name for name, accepted in qualifies.items() if accepted]
            if len(winners) != 1:
                kind = "ambiguous" if winners else "unknown"
            else:
                winner = winners[0]
                kind = "ambiguous" if any(
                    scores[other] >= self.competing_score and scores[winner] - scores[other] <= self.ambiguity_margin
                    for other in scores if other != winner
                ) else winner
        other_court = _out_of_scope_court_signal(raw_text)
        diagnostics: dict[str, Any] = {
            "classification_scores": scores,  # raw points, never calibrated probabilities
            "matched_signals": matched,
            "signal_group_counts": groups,
            "thresholds": {"min_score": self.min_score, "min_groups": self.min_groups, "competing_score": self.competing_score, "ambiguity_margin": self.ambiguity_margin},
            "suspected_concatenation": self._concatenated(raw_text),
            "out_of_scope_court_signal": other_court,
            "court_header_cues": {"sandiganbayan": sand_header, "rtc": rtc_header},
            "field_evidence": {},
            "warnings": [],
        }
        return kind, diagnostics

    @staticmethod
    def _concatenated(raw_text: str) -> bool:
        working = "\n".join(line.work for line in _lines(raw_text))
        interview = len(re.findall(r"(?m)^\s*INTERV[I1]EW\s+SHEET\b", working, re.IGNORECASE))
        republic = len(re.findall(r"(?m)^\s*REPUBLIC\s+OF\s+THE\s+PHILIPPINES\b", working, re.IGNORECASE))
        return interview > 1 or republic > 1 or (interview > 0 and republic > 0)
