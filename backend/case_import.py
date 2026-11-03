"""Read PAO case inventory workbooks without altering the supplied file."""

from __future__ import annotations

import io
import re
from html.parser import HTMLParser
from typing import Any


MAX_WORKBOOK_BYTES = 15 * 1024 * 1024

HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "control_no": ("CONTROL NUMBER", "CONTROL NO", "CONTROL NO.", "CONTROL #"),
    "client_name": ("CLIENT NAME", "NAME OF CLIENT", "CLIENT'S NAME", "CLIENTS NAME", "CLIENT FULL NAME", "FULL NAME"),
    "party_represented": ("PARTY REPRESENTED", "PARTY ROLE", "APPLICANT ROLE"),
    "sex": ("GENDER / SEX", "GENDER", "SEX"),
    "civil_status": ("CIVIL STATUS", "MARITAL STATUS"),
    "religion": ("RELIGION",),
    "educational_attainment": ("EDUCATIONAL ATTAINMENT", "EDUCATIONAL QUALIFICATION"),
    "citizenship": ("CITIZENSHIP",),
    "language_dialect": ("LANGUAGE / DIALECT", "LANGUAGE", "DIALECT"),
    "title": ("TITLE OF THE CASE", "TITLE", "CASE TITLE"),
    "court": ("COURT / BODY", "COURT", "BODY"),
    "case_no": ("CASE NO.", "CASE NO", "DOCKET NO", "DOCKET NUMBER"),
    "cause_of_action": ("CAUSE OF ACTION",),
    "nature_of_case": ("NATURE OF CASE",),
    "status": ("STATUS OF THE CASE", "CASE STATUS", "STATUS"),
    "last_action": ("LAST ACTION TAKEN", "LAST ACTION"),
    "cause_of_termination": ("CAUSE OF TERMINATION", "TERMINATION CAUSE"),
    "date_of_termination": ("DATE OF TERMINATION", "TERMINATION DATE"),
    "age": ("AGE",),
    "urban": ("URBAN",),
    "rural": ("RURAL",),
    "drugs": ("DRUGS", "DRUG RELATED"),
    "female": ("FEMALE",),
    "senior": ("SENIOR", "SENIOR CITIZEN"),
    "cicl": ("CICL",),
    "date_of_confinement": ("DATE OF CONFINEMENT", "DATE CONFINED"),
    "place_of_detention": ("PLACE OF DETENTION", "DETENTION PLACE"),
    "case_received": ("CASE RECEIVED", "DATE RECEIVED", "DATE OF RECEIPT"),
    "address": ("ADDRESS", "CLIENT ADDRESS"),
    "contact_no": ("CONTACT NUMBER", "CONTACT NO", "CONTACT NO.", "PHONE NUMBER"),
    "relationship": ("RELATIONSHIP TO APPLICANT", "RELATIONSHIP"),
}


def _normalize_header(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", " ", str(value or "").upper()).strip()


_HEADER_LOOKUP = {
    _normalize_header(alias): field
    for field, aliases in HEADER_ALIASES.items()
    for alias in aliases
}


def _mapped_header(values: list[Any]) -> dict[str, int]:
    mapped: dict[str, int] = {}
    for index, value in enumerate(values):
        key = _HEADER_LOOKUP.get(_normalize_header(value))
        if key and key not in mapped:
            mapped[key] = index
    return mapped


def _cell_text(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip() or None
    return value


def extract_case_title_client_names(title: Any) -> list[str]:
    """Conservatively extract a defendant list from recognized PP case titles."""
    text = " ".join(str(title or "").split())
    match = re.match(
        r"^(?:PP|PEOPLE(?:\s+OF\s+THE\s+PHILIPPINES)?)\s+(?:VS?\.?|VERSUS)\s+(.+)$",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return []
    defendant_side = match.group(1).strip().strip(" ,;.")
    if not defendant_side or re.search(r"\b(?:ET\s+AL|ETC)\.?\b", defendant_side, re.IGNORECASE):
        return []
    # These separators are used for the explicit list format; unsupported punctuation
    # and role labels are treated as ambiguous instead of becoming part of a name.
    if any(token in defendant_side for token in (";", "/", "|")):
        return []
    normalized = re.sub(r",\s*and\s+|\s+and\s+|\s*&\s*", "|", defendant_side, flags=re.IGNORECASE)
    names = [part.strip(" ,;.") for part in re.split(r"\s*,\s*|\|", normalized)]
    if not names or any(not name or len(name) > 255 for name in names):
        return []
    if any(re.search(r"\b(?:PLAINTIFF|DEFENDANT|ACCUSED|RESPONDENT)\b", name, re.IGNORECASE) for name in names):
        return []
    return names


def normalize_binary_indicator(value: Any, *, blank_default: str | None = None) -> str | None:
    """Return canonical 1/0 while retaining unexpected input for review."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return blank_default
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)) and value in (0, 1):
        return str(int(value))
    text = str(value).strip().casefold()
    if text in {"1", "1.0", "yes", "true", "y"}:
        return "1"
    if text in {"0", "0.0", "no", "false", "n"}:
        return "0"
    return str(value).strip()


def _rows_to_records(rows: list[list[Any]]) -> tuple[list[dict[str, Any]], int]:
    header_index = -1
    header_map: dict[str, int] = {}
    for index, row in enumerate(rows[:40]):
        candidate = _mapped_header(row)
        if "control_no" in candidate and len(candidate) >= 4:
            header_index, header_map = index, candidate
            break
    if header_index < 0:
        raise ValueError("No recognizable case inventory header row was found.")

    records: list[dict[str, Any]] = []
    processed_rows = 0
    for row_number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not any(_cell_text(value) is not None for value in row):
            continue
        processed_rows += 1
        values = {
            field: _cell_text(row[column]) if column < len(row) else None
            for field, column in header_map.items()
        }
        for field in ("client_name", "urban", "rural", "drugs", "female", "senior", "cicl"):
            values[f"_{field}_column_present"] = field in header_map
        control = str(values.get("control_no") or "").strip()
        if re.match(r"^TOTAL\s+CASES?\s*:", control, flags=re.IGNORECASE):
            continue
        if control:
            values["control_no"] = control
        values["_row_number"] = row_number
        records.append(values)
    if not records:
        raise ValueError("The workbook contains a header but no case rows.")
    return records, processed_rows


class _ExcelHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[dict[str, Any]]]] = []
        self.table: list[list[dict[str, Any]]] | None = None
        self.row: list[dict[str, Any]] | None = None
        self.cell: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        if tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in {"td", "th"} and self.row is not None:
            self.cell = {
                "text": [],
                "rowspan": max(1, int(attrs_map.get("rowspan") or 1)),
                "colspan": max(1, int(attrs_map.get("colspan") or 1)),
            }

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self.row is not None and self.cell is not None:
            self.cell["value"] = " ".join("".join(self.cell["text"]).split()) or None
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.table is not None and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            if self.table:
                self.tables.append(self.table)
            self.table = None


def _expand_html_table(table: list[list[dict[str, Any]]]) -> list[list[Any]]:
    grid: list[list[Any]] = []
    carry_spans: dict[int, tuple[Any, int]] = {}
    for row_index, cells in enumerate(table):
        expanded: list[Any] = []
        column = 0
        pending_spans = carry_spans
        carry_spans = {}

        def fill_spans() -> None:
            nonlocal column
            while column in pending_spans:
                value, remaining = pending_spans.pop(column)
                expanded.append(value)
                if remaining > 1:
                    carry_spans[column] = (value, remaining - 1)
                column += 1

        fill_spans()
        for cell in cells:
            fill_spans()
            value = cell["value"]
            colspan, rowspan = cell["colspan"], cell["rowspan"]
            for _ in range(colspan):
                if column in pending_spans:
                    fill_spans()
                expanded.append(value)
                if rowspan > 1:
                    carry_spans[column] = (value, rowspan - 1)
                column += 1
        while pending_spans:
            next_column = min(pending_spans)
            while column < next_column:
                expanded.append(None)
                column += 1
            if column in pending_spans:
                fill_spans()
            else:
                expanded.append(None)
                column += 1
        grid.append(expanded)
    return grid


def _header_score(rows: list[list[Any]]) -> int:
    return max((len(_mapped_header(row)) for row in rows[:40]), default=0)


def read_workbook(content: bytes, filename: str) -> tuple[list[dict[str, Any]], int, str]:
    if not content:
        raise ValueError("The selected file is empty.")
    if len(content) > MAX_WORKBOOK_BYTES:
        raise ValueError("The file is larger than the 15 MB limit.")
    prefix = content[:4096].lstrip(b"\xef\xbb\xbf\x00\t\r\n ").lower()
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if prefix.startswith((b"<!doctype html", b"<html", b"<table")) or b"<table" in prefix[:1000]:
        parser = _ExcelHtmlParser()
        parser.feed(content.decode("utf-8-sig", errors="replace"))
        candidate_rows = max(
            (_expand_html_table(table) for table in parser.tables),
            key=_header_score,
            default=[],
        )
        rows, processed = _rows_to_records(candidate_rows)
        return rows, processed, "HTML table"

    if content.startswith(b"PK\x03\x04"):
        try:
            from openpyxl import load_workbook

            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            best_rows: list[list[Any]] = []
            for sheet in workbook.worksheets:
                candidate = [list(row) for row in sheet.iter_rows(values_only=True)]
                if _header_score(candidate) > _header_score(best_rows):
                    best_rows = candidate
            rows, processed = _rows_to_records(best_rows)
            return rows, processed, "XLSX workbook"
        except ValueError:
            raise
        except ImportError as exc:
            raise ValueError("XLSX reading is unavailable. Install the backend requirements and retry.") from exc
        except Exception as exc:
            raise ValueError("The XLSX workbook is corrupted or unsupported.") from exc

    if content.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        try:
            import xlrd

            workbook = xlrd.open_workbook(file_contents=content, on_demand=True)
            best_rows: list[list[Any]] = []
            for sheet in workbook.sheets():
                candidate = []
                for row_index in range(sheet.nrows):
                    values = []
                    for cell in sheet.row(row_index):
                        if cell.ctype == xlrd.XL_CELL_DATE:
                            values.append(xlrd.xldate.xldate_as_datetime(cell.value, workbook.datemode))
                        else:
                            values.append(cell.value)
                    candidate.append(values)
                if _header_score(candidate) > _header_score(best_rows):
                    best_rows = candidate
            rows, processed = _rows_to_records(best_rows)
            return rows, processed, "XLS workbook"
        except ImportError as exc:
            raise ValueError("Legacy XLS reading is unavailable. Install the xlrd dependency and retry.") from exc
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("The legacy XLS workbook is corrupted or unsupported.") from exc

    raise ValueError(f"The file contents are not a supported Excel workbook (.{extension or 'unknown'}).")
