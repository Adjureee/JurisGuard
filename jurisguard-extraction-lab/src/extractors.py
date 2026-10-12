"""Separate, conservative rule-based extractors. OCR text is data, never instructions."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime

from .schema import CLASSIFICATION_FIELDS, DATE_FIELDS, empty_inventory


@dataclass
class ExtractionResult:
    inventory: dict[str, str | bool | None] = field(default_factory=empty_inventory)
    field_evidence: dict[str, dict[str, str | int]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    _conflicts: set[str] = field(default_factory=set, repr=False)

    def assign(self, name: str, value: str | bool, number: int, raw_line: str) -> None:
        if name in self._conflicts:
            return
        previous = self.inventory[name]
        if previous is not None and previous != value:
            self.inventory[name] = None
            self.field_evidence.pop(name, None)
            self._conflicts.add(name)
            self.warnings.append(f"Line {number}: conflicting {name} values; human review required.")
            return
        self.inventory[name] = value
        self.field_evidence[name] = {"line": number, "snippet": raw_line.strip()[:160]}


@dataclass(frozen=True)
class _Line:
    number: int
    raw: str
    work: str


def _lines(raw_text: str) -> list[_Line]:
    if not isinstance(raw_text, str):
        raise TypeError("raw_text must be a string")
    return [
        _Line(i, raw, re.sub(r"[\t\u00a0 ]+", " ", unicodedata.normalize("NFKC", raw)).strip())
        for i, raw in enumerate(raw_text.splitlines(), 1)
    ]


# A None field marks a label boundary that has no approved inventory mapping.
_INTAKE_LABELS: tuple[tuple[str | None, str], ...] = (
    ("Control Number", r"Control\s*(?:Number|No\.?)"),
    ("Party Represented", r"Party\s+Represented|Pangalan|Name"),
    ("Gender/Sex", r"Gender\s*/\s*Sex|Gender|Sex|Kasarian"),
    ("Address", r"Address|Tirahan"),
    ("Contact Number", r"Contact\s*(?:Number|No\.?)"),
    ("Place of Detention", r"Place\s+of\s+Detention"),
    ("Date of Confinement", r"Date\s+of\s+Confinement"),
    ("Title of the Case", r"Title\s+of\s+the\s+Case"),
    ("Court/Body", r"Court\s*/\s*Body"),
    ("Case No.", r"Case\s+No\.?(?!\w)"),
    ("Urban", r"Urban"), ("Rural", r"Rural"), ("Drugs", r"Drugs"),
    ("Female", r"Female"), ("SENIOR", r"SENIOR"), ("CICL", r"CICL"),
    (None, r"Edad|Age|Civil\s+Status|Senior\s+Citizen|VAWC\s+Victim"),
)
_LABEL_RE = re.compile(
    r"(?<!\w)(?:" + "|".join(f"(?P<L{i}>{pattern})" for i, (_, pattern) in enumerate(_INTAKE_LABELS)) + r")\s*[:：]\s*",
    re.IGNORECASE,
)
_BOX_RE = re.compile(r"^\s*(\[[^\]]*\]|\([^)]*\)|[☑☐])\s*$")
_UNAPPROVED_DEMOGRAPHIC_RE = re.compile(r"\b(?:Senior\s+Citizen|Child\s+in\s+Conflict\s+with\s+the\s+Law|VAWC\s+Victim)\b", re.IGNORECASE)
_UNPOSITIONED_BOX_RE = re.compile(r"\b(?:Urban|Rural|Drugs|Female|SENIOR|CICL)\b\s*(?:\[[^\]]*\]|[☑☐]|\?)", re.IGNORECASE)


def _checkbox(value: str) -> bool | None:
    match = _BOX_RE.fullmatch(value)
    if not match:
        return None
    token = match.group(1)
    if token == "☑" or token[1:-1].strip().casefold() in {"x", "✓", "✔"}:
        return True
    if token == "☐" or token[1:-1].strip() == "":
        return False
    return None


def _date(value: str) -> str | None:
    value = value.strip().rstrip(".")
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    match = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", value)
    if not match:
        return None
    a, b, year = map(int, match.groups())
    if a <= 12 and b <= 12:
        return None
    day, month = (a, b) if a > 12 else (b, a)
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def _heading(value: str) -> bool:
    return bool(re.fullmatch(r"[IVX]+\.?\s+[A-Z][A-Z\s.-]{4,}", value) or re.search(
        r"\b(?:INTERV[I1]EW\s+SHEET|DEC[I1]SION|REPUBLIC\s+OF\s+THE\s+PHILIPPINES|REGIONAL\s+TR[I1l]AL\s+COURT)\b",
        value, re.IGNORECASE,
    ))


def extract_intake(raw_text: str) -> ExtractionResult:
    result = ExtractionResult()
    lines = _lines(raw_text)
    for index, line in enumerate(lines):
        if _UNAPPROVED_DEMOGRAPHIC_RE.search(line.work):
            result.warnings.append(f"Line {line.number}: demographic label has no approved inventory mapping; human review required.")
        matches = list(_LABEL_RE.finditer(line.work))
        if not matches and _UNPOSITIONED_BOX_RE.search(line.work):
            result.warnings.append(f"Line {line.number}: checkbox association is unclear in plain OCR; inspect image or bounding boxes.")
        if not matches or line.work[:matches[0].start()].strip():
            continue
        for position, match in enumerate(matches):
            name = next(name for i, (name, _) in enumerate(_INTAKE_LABELS) if match.group(f"L{i}") is not None)
            if name is None:
                continue
            end = matches[position + 1].start() if position + 1 < len(matches) else len(line.work)
            value = line.work[match.end():end].strip(" \t;|")
            source = line
            if not value and position == len(matches) - 1 and index + 1 < len(lines):
                next_line = lines[index + 1]
                if next_line.work and not _LABEL_RE.match(next_line.work) and not _heading(next_line.work):
                    value, source = next_line.work, next_line
            if not value:
                continue
            if name in CLASSIFICATION_FIELDS:
                parsed = _checkbox(value)
                if parsed is None:
                    result.warnings.append(f"Line {source.number}: unclear {name} checkbox; inspect image or bounding boxes.")
                    continue
            elif name in DATE_FIELDS:
                parsed = _date(value)
                if parsed is None:
                    result.warnings.append(f"Line {source.number}: unclear {name} date.")
                    continue
            else:
                parsed = value
            result.assign(name, parsed, source.number, source.raw)
    return result


def extract_rtc(raw_text: str) -> ExtractionResult:
    result = ExtractionResult()
    lines = _lines(raw_text)
    for i, line in enumerate(lines):
        court = re.search(r"\bREGIONAL\s+TR[I1l]AL\s+COURT\b", line.work, re.IGNORECASE)
        if court:
            value = line.work[court.start():].strip(" ,")
            if i + 1 < len(lines) and re.fullmatch(r"Branch\s+(?:No\.?\s*)?[A-Z0-9-]+", lines[i + 1].work, re.IGNORECASE):
                value += ", " + lines[i + 1].work
            result.assign("Court/Body", value, line.number, line.raw)
        case = re.fullmatch(r"(?:Criminal\s+)?Case\s+No\.\s*[:：]?\s*([A-Z0-9][A-Z0-9/ .-]*)", line.work, re.IGNORECASE)
        if case:
            result.assign("Case No.", case.group(1).strip(), line.number, line.raw)
    for i, line in enumerate(lines):
        if not re.match(r"PEOPLE\s+OF\s+THE\s+PHILIPPINES\b", line.work, re.IGNORECASE):
            continue
        versus = next((j for j in range(i + 1, min(i + 5, len(lines))) if re.fullmatch(r"-?\s*(?:versus|vs?\.?)\s*-?", lines[j].work, re.IGNORECASE)), None)
        if versus is None:
            continue
        for j in range(versus + 1, min(versus + 4, len(lines))):
            raw_name = lines[j].work
            name = re.sub(r",?\s*Accus[ei]d\.?\s*$", "", raw_name, flags=re.IGNORECASE).strip(" ,.")
            role = bool(re.search(r"\bAccus[ei]d\b", raw_name, re.IGNORECASE))
            if not role and j + 1 < len(lines):
                role = bool(re.fullmatch(r"Accus[ei]d\.?", lines[j + 1].work, re.IGNORECASE))
            if role and name and not _heading(name):
                result.assign("Title of the Case", "People of the Philippines v. " + name, lines[j].number, lines[j].raw)
                break
        break
    return result


def extract_intake_form(raw_text: str) -> dict[str, str | bool | None]:
    """Public extractor contract: exactly the inventory fields, no metadata."""
    return extract_intake(raw_text).inventory


def extract_rtc_decision(raw_text: str) -> dict[str, str | bool | None]:
    """Public extractor contract: exactly the inventory fields, no metadata."""
    return extract_rtc(raw_text).inventory
