"""Deterministic, offline document routing and conservative field extraction.

OCR is untrusted data. No OCR content is evaluated, executed, or sent to a service.
The caller retains the original OCR string; normalization is local to this module.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .schema import CLASSIFICATION_FIELDS, DATE_FIELDS, empty_inventory


@dataclass(frozen=True)
class _Signal:
    name: str
    group: str
    weight: int
    pattern: str


@dataclass(frozen=True)
class _Line:
    number: int
    raw: str
    working: str


_INTAKE_SIGNALS = (
    _Signal("interview_sheet_heading", "heading", 5, r"\bINTERV[I1]EW\s+SHEET\b"),
    _Signal("pao_intake_heading", "heading", 3, r"\b(?:PAO\s+)?(?:CLIENT\s+)?INTAKE\s+(?:FORM|SHEET)\b"),
    _Signal("pao_office_heading", "heading", 2, r"\b(?:Rehiyon\s+[IVX0-9]+\s+)?District\s+Office\s+PAO\b"),
    _Signal("request_section", "request", 3, r"\bURI\s+NG\s+INIHIHINGI\s+NG\s+TULONG\b"),
    _Signal("applicant_section", "applicant", 3, r"\bIMPORMASYON\s+UKOL\s+SA\s+APLIKANTE\b"),
    _Signal("control_number_label", "identifier", 2, r"(?m)^\s*Control\s+No\.?\s*[:：]"),
    _Signal("pangalan_label", "identity", 2, r"(?m)^\s*Pangalan\s*[:：]"),
    _Signal("name_label", "identity", 1, r"(?m)^\s*Name\s*[:：]"),
    _Signal("age_label", "identity", 1, r"(?m)^\s*(?:Edad|Age)\s*[:：]"),
    _Signal("contact_label", "contact", 2, r"(?m)^\s*Contact\s*(?:No\.?|Number)\s*[:：]"),
    _Signal("address_label", "contact", 1, r"(?m)^\s*(?:Address|Tirahan)\s*[:：]"),
    _Signal("detention_question", "detention", 2, r"\b(?:detained|nakakulong|detention|confinement)\b"),
    _Signal("demographic_checkbox", "classification", 1, r"\b(?:Senior\s+Citizen|CICL|Child\s+in\s+Conflict\s+with\s+the\s+Law|VAWC\s+Victim)\b"),
)

_RTC_SIGNALS = (
    _Signal("republic_heading", "heading", 2, r"\bREPUBLIC\s+OF\s+THE\s+PHILIPPINES\b"),
    _Signal("rtc_heading", "court", 4, r"\bREGIONAL\s+TR[I1l]AL\s+COURT\b"),
    _Signal("people_caption", "caption", 2, r"\bPEOPLE\s+OF\s+THE\s+PHILIPPINES\b"),
    _Signal("versus_separator", "caption", 2, r"(?m)^\s*-?\s*(?:versus|vs?\.?)\s*-?\s*$"),
    _Signal("accused_role", "caption", 1, r"\bACCUS[EI]D\b"),
    _Signal("decision_heading", "decision", 1, r"(?m)^\s*DEC[I1]SION\s*$"),
    _Signal("case_number_label", "case", 2, r"\b(?:Criminal\s+)?Case\s+No\.\s*[:：]?\s*[A-Z0-9]"),
    _Signal("decorative_separator", "layout", 1, r"(?m)^\s*x-{5,}x\s*$"),
)

_SANDIGANBAYAN_SIGNALS = (
    _Signal("sandiganbayan_heading", "court", 6, r"\bSan[db][i1]ganba[ypt]a[nl]\b"),
    _Signal("sandiganbayan_case_number", "identifier", 5, r"\bSB\s*[-–]\s*\d{2}\s*[-–]\s*(?:CRM|SCA|A\s*/?\s*R)\s*[-–]?\s*\d{3,5}\b"),
    _Signal("case_label", "case", 1, r"\bCASE\s+NO\b"),
    _Signal("division_heading", "division", 2, r"(?m)^\s*(?:SPECIAL\s+)?(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|\d+(?:ST|ND|RD|TH)?)\s+DIVISION\b"),
    _Signal("people_caption", "caption", 1, r"\bPEOPLE\s+OF\s+THE\s+PHILIPPINES\b"),
    _Signal("republic_heading", "heading", 1, r"\bREPUBLIC\s+OF\s+THE\s+PHILIPPINES\b"),
)


def _court_header_cues(raw_text: str) -> tuple[bool, bool]:
    first_lines = [line.working for line in _lines(raw_text) if line.working][:8]
    header = "\n".join(first_lines)
    return (
        bool(re.search(r"(?m)^[ \t'\"“‘]{0,3}San[db][i1]ganba[ypt]a[nl]\b", header, re.IGNORECASE)),
        bool(re.search(r"(?m)^\s*REGIONAL\s+TR[I1l]AL\s+COURT\b", header, re.IGNORECASE)),
    )


def _out_of_scope_court_signal(raw_text: str) -> str | None:
    header = "\n".join(line.working for line in _lines(raw_text) if line.working)[:3000]
    # Blackletter headings can turn d into b and y into p (observed in OCR).
    if re.search(r"\bSan[db][i1]ganba[ypt]a[nl]\b", header, re.IGNORECASE):
        return "sandiganbayan_heading"
    if re.search(r"\bSB\s*[-–]?\s*\d{2}\s*[-–]?\s*[A-Z]{2,4}\s*[-–]?\s*\d{3,5}\b", header[:800], re.IGNORECASE):
        return "sandiganbayan_case_number"
    return None

# Only direct labels on an already classified intake form are mapped to inventory
# fields. Demographic aliases such as "Senior Citizen" are intentionally absent:
# their mapping to inventory flags still needs an approved business rule.
_INTAKE_LABELS = (
    ("Control Number", r"Control\s*(?:Number|No\.?)"),
    ("Party Represented", r"Party\s+Represented|Pangalan|Name"),
    ("Gender/Sex", r"Gender\s*/\s*Sex|Gender|Sex|Kasarian"),
    ("Address", r"Address|Tirahan"),
    ("Contact Number", r"Contact\s*(?:Number|No\.?)"),
    ("Place of Detention", r"Place\s+of\s+Detention"),
    ("Date of Confinement", r"Date\s+of\s+Confinement"),
    ("Title of the Case", r"Title\s+of\s+the\s+Case"),
    ("Court/Body", r"Court\s*/\s*Body"),
    ("Case No.", r"Case\s+No\.?"),
    ("Urban", r"Urban"),
    ("Rural", r"Rural"),
    ("Drugs", r"Drugs"),
    ("Female", r"Female"),
    ("SENIOR", r"SENIOR"),
    ("CICL", r"CICL"),
    (None, r"Edad|Age|Civil\s+Status"),  # boundary only; no approved inventory mapping
)
_LABEL_RE = re.compile(
    r"(?<!\w)(?:" + "|".join(f"(?P<L{i}>{pattern})" for i, (_, pattern) in enumerate(_INTAKE_LABELS)) + r")\s*[:：]\s*",
    re.IGNORECASE,
)
_CHECKBOX_RE = re.compile(r"^\s*(\[[^\]]*\]|\([^)]*\)|[☑☐])\s*$")


class DocumentRouter:
    """Route one logical OCR document using raw heuristic points, not probabilities."""

    def __init__(
        self,
        *,
        min_score: int = 5,
        min_signal_groups: int = 2,
        competing_score: int = 4,
        ambiguity_margin: int = 2,
    ) -> None:
        if min_score < 1 or min_signal_groups < 1 or competing_score < 0 or ambiguity_margin < 0:
            raise ValueError("classification thresholds must be nonnegative; min_score and min_signal_groups must be positive")
        self.min_score = min_score
        self.min_signal_groups = min_signal_groups
        self.competing_score = competing_score
        self.ambiguity_margin = ambiguity_margin

    def classify_document(self, raw_text: str) -> str:
        """Return intake_form, rtc_decision, sandiganbayan_document, unknown, or ambiguous."""
        return self._classify(raw_text)[0]

    def extract_intake_form(self, raw_text: str) -> dict[str, str | bool | None]:
        """Extract direct intake labels; return only the exact inventory schema."""
        if _suspected_concatenation("\n".join(line.working for line in _lines(raw_text))):
            return empty_inventory()
        inventory, _ = self._extract_intake(raw_text)
        return inventory

    def extract_rtc_decision(self, raw_text: str) -> dict[str, str | bool | None]:
        """Extract explicit RTC court, case number, and caption only."""
        if _suspected_concatenation("\n".join(line.working for line in _lines(raw_text))) or self.classify_document(raw_text) != "rtc_decision":
            return empty_inventory()
        inventory, _ = self._extract_rtc(raw_text)
        return inventory

    def process(self, raw_text: str) -> dict[str, Any]:
        """Return routing, inventory, diagnostics, and a human-review flag."""
        document_type, diagnostics = self._classify(raw_text)
        inventory = empty_inventory()
        if diagnostics["suspected_concatenation"]:
            diagnostics["warnings"].append("Possible concatenated documents: split and review before extraction.")
        elif document_type == "intake_form":
            inventory, extraction = self._extract_intake(raw_text)
            diagnostics["field_evidence"] = extraction["field_evidence"]
            diagnostics["warnings"].extend(extraction["warnings"])
        elif document_type == "rtc_decision":
            inventory, extraction = self._extract_rtc(raw_text)
            diagnostics["field_evidence"] = extraction["field_evidence"]
            diagnostics["warnings"].extend(extraction["warnings"])
        elif document_type == "sandiganbayan_document":
            diagnostics["warnings"].append("Sandiganbayan routing is supported; PAO inventory field mapping for this court is not yet approved.")
            diagnostics["review_question"] = "Review the document and define approved Sandiganbayan inventory mappings before field extraction."
        else:
            if diagnostics["out_of_scope_court_signal"]:
                diagnostics["warnings"].append("Court heading or case number suggests Sandiganbayan; RTC mapping is unsupported and requires review.")
                diagnostics["review_question"] = "Is this a Sandiganbayan document? Confirm whether to use a separate extractor."
            else:
                diagnostics["warnings"].append("Human document-type identification required before extraction.")
                diagnostics["review_question"] = "Is this an intake form, an RTC decision, or several documents needing separation?"
        if diagnostics["suspected_concatenation"]:
            diagnostics["review_question"] = "Are several documents present? Separate them into one OCR string per document."
        return {
            "document_type": document_type,
            "inventory": inventory,
            "diagnostics": diagnostics,
            "needs_review": document_type in {"unknown", "ambiguous", "sandiganbayan_document"} or diagnostics["suspected_concatenation"] or bool(diagnostics["warnings"]),
        }

    def _classify(self, raw_text: str) -> tuple[str, dict[str, Any]]:
        if not isinstance(raw_text, str):
            raise TypeError("raw_text must be a string")
        working = "\n".join(line.working for line in _lines(raw_text))
        matched: dict[str, list[dict[str, str | int]]] = {}
        scores: dict[str, int] = {}
        groups: dict[str, int] = {}
        for kind, signals in (("intake_form", _INTAKE_SIGNALS), ("rtc_decision", _RTC_SIGNALS), ("sandiganbayan_document", _SANDIGANBAYAN_SIGNALS)):
            hits = [
                {"signal": signal.name, "group": signal.group, "points": signal.weight}
                for signal in signals
                if re.search(signal.pattern, working, re.IGNORECASE)
            ]
            matched[kind] = hits
            scores[kind] = sum(int(hit["points"]) for hit in hits)
            groups[kind] = len({str(hit["group"]) for hit in hits})
        qualifies = {name: scores[name] >= self.min_score and groups[name] >= self.min_signal_groups for name in scores}
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
        suspected = _suspected_concatenation(working)
        diagnostics: dict[str, Any] = {
            "classification_scores": scores,  # uncalibrated heuristic points
            "matched_signals": matched,
            "signal_group_counts": groups,
            "thresholds": {
                "min_score": self.min_score,
                "min_signal_groups": self.min_signal_groups,
                "competing_score": self.competing_score,
                "ambiguity_margin": self.ambiguity_margin,
            },
            "suspected_concatenation": suspected,
            "out_of_scope_court_signal": other_court,
            "court_header_cues": {"sandiganbayan": sand_header, "rtc": rtc_header},
            "field_evidence": {},
            "warnings": [],
        }
        return kind, diagnostics

    def _extract_intake(self, raw_text: str) -> tuple[dict[str, str | bool | None], dict[str, Any]]:
        inventory = empty_inventory()
        diagnostics: dict[str, Any] = {"field_evidence": {}, "warnings": []}
        lines = _lines(raw_text)
        for index, line in enumerate(lines):
            matches = list(_LABEL_RE.finditer(line.working))
            if not matches or line.working[: matches[0].start()].strip():
                continue
            for position, match in enumerate(matches):
                field = next(name for number, (name, _) in enumerate(_INTAKE_LABELS) if match.group(f"L{number}") is not None)
                end = matches[position + 1].start() if position + 1 < len(matches) else len(line.working)
                value = line.working[match.end() : end].strip(" \t;|")
                if field is None:
                    continue
                source = line
                if not value and position == len(matches) - 1 and index + 1 < len(lines):
                    following = lines[index + 1]
                    if following.working and not _LABEL_RE.match(following.working) and not _looks_like_heading(following.working):
                        value, source = following.working, following
                if not value:
                    continue
                if field in CLASSIFICATION_FIELDS:
                    parsed = _parse_checkbox(value)
                    if parsed is None:
                        diagnostics["warnings"].append(f"Line {source.number}: unresolved {field} checkbox; inspect source image if layout or marks were lost.")
                        continue
                elif field in DATE_FIELDS:
                    parsed = _parse_date(value)
                    if parsed is None:
                        diagnostics["warnings"].append(f"Line {source.number}: unresolved {field} date.")
                        continue
                else:
                    parsed = value.strip()
                _assign(inventory, diagnostics, field, parsed, source)
        return inventory, diagnostics

    def _extract_rtc(self, raw_text: str) -> tuple[dict[str, str | bool | None], dict[str, Any]]:
        inventory = empty_inventory()
        diagnostics: dict[str, Any] = {"field_evidence": {}, "warnings": []}
        lines = _lines(raw_text)
        for index, line in enumerate(lines):
            court_match = re.search(r"\bREGIONAL\s+TR[I1l]AL\s+COURT\b", line.working, re.IGNORECASE)
            if court_match:
                court = line.working[court_match.start() :].strip(" ,")
                if index + 1 < len(lines) and re.fullmatch(r"Branch\s+(?:No\.?\s*)?[A-Z0-9-]+", lines[index + 1].working, re.IGNORECASE):
                    court += ", " + lines[index + 1].working
                _assign(inventory, diagnostics, "Court/Body", court, line)
            case_match = re.match(r"^\s*(?:Criminal\s+)?Case\s+No\.\s*[:：]?\s*([A-Z0-9][A-Z0-9/ .-]*)\s*$", line.working, re.IGNORECASE)
            if case_match:
                _assign(inventory, diagnostics, "Case No.", case_match.group(1).strip(), line)
        for index, line in enumerate(lines):
            if not re.match(r"^\s*PEOPLE\s+OF\s+THE\s+PHILIPPINES\b", line.working, re.IGNORECASE):
                continue
            versus_index = next((j for j in range(index + 1, min(index + 5, len(lines))) if re.fullmatch(r"-?\s*(?:versus|vs?\.?)\s*-?", lines[j].working, re.IGNORECASE)), None)
            if versus_index is None:
                continue
            for accused_index in range(versus_index + 1, min(versus_index + 4, len(lines))):
                accused = re.sub(r",?\s*Accus[ei]d\.?\s*$", "", lines[accused_index].working, flags=re.IGNORECASE).strip(" ,.")
                has_role = bool(re.search(r"\bAccus[ei]d\b", lines[accused_index].working, re.IGNORECASE))
                if not has_role and accused_index + 1 < len(lines) and re.fullmatch(r"Accus[ei]d\.?", lines[accused_index + 1].working, re.IGNORECASE):
                    has_role = True
                if has_role and accused and not _looks_like_heading(accused):
                    title = "People of the Philippines v. " + accused
                    _assign(inventory, diagnostics, "Title of the Case", title, lines[accused_index])
                    break
            break
        return inventory, diagnostics


def _lines(raw_text: str) -> list[_Line]:
    if not isinstance(raw_text, str):
        raise TypeError("raw_text must be a string")
    return [
        _Line(number, raw, re.sub(r"[\t\u00a0 ]+", " ", unicodedata.normalize("NFKC", raw)).strip())
        for number, raw in enumerate(raw_text.splitlines(), start=1)
    ]


def _looks_like_heading(value: str) -> bool:
    return bool(re.fullmatch(r"[IVX]+\.?\s+[A-Z][A-Z\s.-]{4,}", value) or re.search(r"\b(?:INTERV[I1]EW\s+SHEET|DEC[I1]SION|REPUBLIC\s+OF\s+THE\s+PHILIPPINES|REGIONAL\s+TR[I1l]AL\s+COURT)\b", value, re.IGNORECASE))


def _parse_checkbox(value: str) -> bool | None:
    match = _CHECKBOX_RE.fullmatch(value)
    if not match:
        return None
    mark = match.group(1)
    if mark == "☑" or mark[1:-1].strip().casefold() in {"x", "✓", "✔"}:
        return True
    if mark == "☐" or mark[1:-1].strip() == "":
        return False
    return None


def _parse_date(value: str) -> str | None:
    value = value.strip().rstrip(".")
    for pattern in ("%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            pass
    match = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", value)
    if not match:
        return None
    first, second, year = map(int, match.groups())
    if first <= 12 and second <= 12:
        return None
    day, month = (first, second) if first > 12 else (second, first)
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def _assign(inventory: dict[str, str | bool | None], diagnostics: dict[str, Any], field: str, value: str | bool, line: _Line) -> None:
    if field in diagnostics.setdefault("conflicted_fields", set()):
        return
    previous = inventory[field]
    if previous is not None and previous != value:
        inventory[field] = None
        diagnostics["field_evidence"].pop(field, None)
        diagnostics["conflicted_fields"].add(field)
        diagnostics["warnings"].append(f"Line {line.number}: conflicting values for {field}; left unresolved.")
        return
    inventory[field] = value
    diagnostics["field_evidence"][field] = {"line": line.number, "snippet": line.raw.strip()[:160]}


def _suspected_concatenation(working: str) -> bool:
    intake_headings = len(re.findall(r"(?m)^\s*INTERV[I1]EW\s+SHEET\b", working, re.IGNORECASE))
    rtc_headings = len(re.findall(r"(?m)^\s*REPUBLIC\s+OF\s+THE\s+PHILIPPINES\b", working, re.IGNORECASE))
    return intake_headings > 1 or rtc_headings > 1 or (intake_headings > 0 and rtc_headings > 0)
