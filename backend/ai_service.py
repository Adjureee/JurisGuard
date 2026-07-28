import os
import socket
import json
import requests
import base64
import tempfile
import time
import traceback
import re
import importlib.util
from pathlib import Path
from requests import exceptions as requests_exceptions
import cv2
import numpy as np
from PIL import Image
try:
    from paddleocr import PaddleOCR
except Exception as exc:
    PaddleOCR = None
    PADDLEOCR_IMPORT_ERROR = exc
else:
    PADDLEOCR_IMPORT_ERROR = None
import spacy
from spacy.matcher import Matcher
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)

def get_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

def get_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

def get_str_env(name: str, default: str) -> str:
    return os.getenv(name, default).strip().lower()

def as_sequence(value):
    if value is None:
        return []
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value

def normalize_ocr_text(raw_text: str) -> str:
    replacements = {
        "lnindorso": "Inindorso",
        "lnindorsong": "Inindorso ng",
        "Petsa:": "Petsa:",
        "Mananayam.": "Mananayam:",
        "Control No.": "Control No.:",
        "Control No": "Control No.:",
        "LegalDocumentation": "Legal Documentation",
        "Oatl": "Oath",
        "FURI": "URI",
        "INIHIHINGINGT": "INIHIHINGI NG",
    }
    normalized = raw_text or ""
    for old, new in replacements.items():
        normalized = normalized.replace(old, new)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{2,}", "\n", normalized)
    return normalized.strip()

def clean_ocr_value(value: str) -> str:
    value = value or ""
    value = value.replace("_", " ")
    value = re.sub(r"[|]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    value = value.strip(" :-.,")
    return value.strip()

def normalize_lines(raw_text: str) -> list[str]:
    return [
        clean_ocr_value(line)
        for line in normalize_ocr_text(raw_text).splitlines()
        if clean_ocr_value(line)
    ]

def line_after_label(lines: list[str], label_pattern: str, stop_pattern: str | None = None) -> str | None:
    label_re = re.compile(label_pattern, re.IGNORECASE)
    stop_re = re.compile(stop_pattern, re.IGNORECASE) if stop_pattern else None
    for index, line in enumerate(lines):
        if not label_re.search(line):
            continue

        inline_value = label_re.sub("", line, count=1)
        inline_value = clean_ocr_value(inline_value)
        if inline_value:
            return inline_value

        values = []
        for next_line in lines[index + 1:index + 4]:
            if stop_re and stop_re.search(next_line):
                break
            if label_re.search(next_line):
                continue
            values.append(next_line)
            if len(values) >= 2:
                break
        if values:
            return clean_ocr_value(" ".join(values))
    return None

def lines_between(
    lines: list[str],
    start_pattern: str,
    end_pattern: str | None = None,
) -> list[str]:
    start_re = re.compile(start_pattern, re.IGNORECASE)
    end_re = re.compile(end_pattern, re.IGNORECASE) if end_pattern else None
    start_index = next((index for index, line in enumerate(lines) if start_re.search(line)), -1)
    if start_index < 0:
        return []
    end_index = len(lines)
    if end_re:
        for index in range(start_index + 1, len(lines)):
            if end_re.search(lines[index]):
                end_index = index
                break
    return lines[start_index:end_index]

def section_text(lines: list[str]) -> str:
    return " ".join(lines)

def normalize_year(year_text: str) -> str:
    year = year_text.upper().replace("O", "0").replace("R", "2").replace("I", "1").replace("L", "1")
    return year if len(year) == 4 and year.isdigit() else year_text

PAO_MONTH_ALIASES = {
    "january": "January",
    "jan": "January",
    "enero": "January",
    "february": "February",
    "feb": "February",
    "pebrero": "February",
    "march": "March",
    "mar": "March",
    "marso": "March",
    "april": "April",
    "apr": "April",
    "abril": "April",
    "may": "May",
    "mayo": "May",
    "june": "June",
    "jun": "June",
    "hunyo": "June",
    "july": "July",
    "jul": "July",
    "hulyo": "July",
    "august": "August",
    "aug": "August",
    "agosto": "August",
    "september": "September",
    "sept": "September",
    "sep": "September",
    "setyembre": "September",
    "septiyembre": "September",
    "october": "October",
    "oct": "October",
    "oktubre": "October",
    "november": "November",
    "nov": "November",
    "nobyembre": "November",
    "december": "December",
    "dec": "December",
    "disyembre": "December",
}

PAO_MONTH_PATTERN = "|".join(
    re.escape(month) for month in sorted(PAO_MONTH_ALIASES, key=len, reverse=True)
)

def normalize_control_no(control_text: str) -> str:
    value = control_text.upper()
    value = value.replace("—", "-").replace("–", "-").replace("−", "-")
    value = re.sub(r"[^A-Z0-9-]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("-")
    parts = [part for part in value.split("-") if part]

    fixed_parts = []
    for index, part in enumerate(parts):
        if index == 0 and part == "X1":
            part = "XI"
        elif index >= 2:
            part = part.replace("O", "0").replace("I", "1").replace("L", "1")
        fixed_parts.append(part)

    return "-".join(fixed_parts)

def extract_control_no(text: str) -> str | None:
    match = re.search(
        r"\b(?:XI|X1|[A-Z0-9]{1,3})[-\s]+[A-Z0-9]{1,4}[-\s]+(?:20[0-9A-Z]{2})[-\s]+[0-9A-Z]{1,2}[-\s]+[0-9A-Z]{2,5}\b",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    return normalize_control_no(match.group(0))

def extract_date(text: str) -> str | None:
    match = re.search(
        rf"\b({PAO_MONTH_PATTERN})\.?\s*([0-9]{{1,2}})?\s*[,]?\s*([0-9OIRL]{{4}})\b",
        text,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(
            rf"\b({PAO_MONTH_PATTERN})\.?([0-9]{{1,2}})([0-9OIRL]{{4}})\b",
            text,
            re.IGNORECASE,
        )
    if not match:
        return None
    month = PAO_MONTH_ALIASES.get(match.group(1).lower(), match.group(1).title())
    day = match.group(2)
    year = normalize_year(match.group(3))
    return f"{month} {day}, {year}" if day else f"{month} {year}"

def extract_labeled_date(lines: list[str], compact_text: str) -> str | None:
    label_value = line_after_label(
        lines,
        r"\bpetsa\b",
        stop_pattern=r"\bcontrol\b|\bmananayam\b|\brehiyon\b|\bdistrict\b",
    )
    if label_value:
        date_value = extract_date(label_value)
        if date_value:
            return date_value
    return extract_date(compact_text)

def extract_labeled_control_no(lines: list[str], compact_text: str) -> str | None:
    label_value = line_after_label(
        lines,
        r"\bcontrol\s*no\.?\b",
        stop_pattern=r"\bpetsa\b|\bmananayam\b|\brehiyon\b|\bdistrict\b|\bini[-\s]?refer\b",
    )
    if label_value:
        control_no = extract_control_no(label_value)
        if control_no:
            return control_no
        candidate = normalize_control_no(label_value)
        if len(candidate.split("-")) >= 4:
            return candidate
    return extract_control_no(compact_text)

def extract_interviewer(lines: list[str]) -> str | None:
    value = line_after_label(
        lines,
        r"\bmananayam\b",
        stop_pattern=r"\bini[-\s]?refer\b|\buri\b|\bpetsa\b|\bcontrol\b",
    )
    if not value:
        return None
    value = re.sub(r"\([^)]*\)", "", value)
    value = re.sub(r"\bpublic attorney\b", "", value, flags=re.IGNORECASE)
    return clean_ocr_value(value) or None

def extract_region(lines: list[str]) -> str | None:
    region_pattern = re.compile(r"\brehiyon\b|\bregion\b", re.IGNORECASE)
    stop_pattern = re.compile(r"\bdistrict\s*office\b|\bpetsa\b|\bcontrol\b|\bmananayam\b", re.IGNORECASE)

    for line in lines:
        if not region_pattern.search(line):
            continue

        value = region_pattern.sub("", line, count=1)
        value = stop_pattern.split(value, maxsplit=1)[0]
        value = clean_ocr_value(value)
        if not value:
            return None

        match = re.search(r"\b([IVX]{1,6}|X1|[0-9]{1,2})\b", value, re.IGNORECASE)
        if not match:
            return None

        region = match.group(1).upper()
        return "XI" if region == "X1" else region

    return None

def section_visible(compact_text: str, *patterns: str) -> bool:
    return any(re.search(pattern, compact_text, re.IGNORECASE) for pattern in patterns)

def is_checked_option(lines: list[str], option_pattern: str) -> bool:
    option_re = re.compile(option_pattern, re.IGNORECASE)
    mark_re = re.compile(r"(?:☑|☒|✓|✔|\[[xX/]\]|\([xX/]\)|\b[xX]\b|■|▣)")

    for index, line in enumerate(lines):
        if not option_re.search(line):
            continue

        before_option = option_re.split(line, maxsplit=1)[0]
        nearby_text = " ".join(lines[max(0, index - 1):index + 2])

        if mark_re.search(before_option):
            return True
        if re.search(r"(?:checked|tsek|may\s*marka)", nearby_text, re.IGNORECASE):
            return True

    return False

def has_visible_option(compact_text: str, option_pattern: str) -> bool:
    return bool(re.search(option_pattern, compact_text, re.IGNORECASE))

def extract_district_office(lines: list[str]) -> str | None:
    for line in lines:
        match = re.search(
            r"\bdistrict\s*office\b[:\s]*(.*?)(?:\bpetsa\b|\bcontrol\b|\bmananayam\b|\bginawang\b|$)",
            line,
            re.IGNORECASE,
        )
        if match:
            value = clean_ocr_value(match.group(1))
            value = re.sub(r"^rehiyon\s+[A-Z0-9IVX]+\s*", "", value, flags=re.IGNORECASE)
            if value:
                return value

    value = line_after_label(
        lines,
        r"\bdistrict\s*office\b",
        stop_pattern=r"\bpetsa\b|\bcontrol\b|\bmananayam\b|\bginawang\b|\boras\b",
    )
    if not value or re.search(r"\bpetsa\b|\bcontrol\b|\bmananayam\b", value, re.IGNORECASE):
        return None
    return clean_ocr_value(value) or None

COMMON_STOP_LABELS = (
    r"\brehiyon\b|\bdistrict\s*office\b|\bpetsa\b|\bcontrol\s*no\b|\bginawang\s+aksyon\b|"
    r"\bini[-\s]?atas\b|\bmananayam\b|\bini[-\s]?refer\b|\binindorso\b|\baprobado\b|"
    r"\bpangalan\b|\bedad\b|\bsex\b|\bcivil\s*status\b|\btirahan\b|\bcontact\s*no\b|"
    r"\be[-\s]?mail\b|\brelihiyon\b|\bpagkamamamayan\b|\bnaabot\s+na\s+pag[-\s]?aaral\b|"
    r"\bcitizenship\b|\breligion\b|\beducational\s+attainment\b|\blanguage\s*/?\s*dialect\b|"
    r"\bsalita\s*/?\s*di(?:a|ya)lekto\b|\bspouse\b|\basawa\b|\bindividual\s+monthly\s+income\b|"
    r"\baddress\s+of\s+spouse\b|\btirahan\s+ng\s+asawa\b|\bcontact\s*no\.?\s+of\s+spouse\b|"
    r"\bcontact\s*no\.?\s+ng\s+asawa\b|\bnakakulong\b|\bdetained\b|\bdetained\s+since\b|"
    r"\bpetsa\s+ng\s+pag[ak]*akulong\b|\blugar\s+ng\s+detention\b|\bplace\s+of\s+detention\b|"
    r"\brelasyon\b|\buri\s+ng\s+kaso\b|\bsektor\b|\bproof\s+of\s+indigency\b|"
    r"\bkinalaman\b|\bkatunggali\b|\bimpormasyon\s+sa\s+kaso\b|\bcause\s+of\s+action\b|"
    r"\bpamagat\b|\bcourt\b"
)

PROXIMITY_STOP_LABELS = COMMON_STOP_LABELS

def label_contexts(lines: list[str], label_pattern: str, radius: int = 1) -> list[tuple[int, str]]:
    label_re = re.compile(label_pattern, re.IGNORECASE)
    contexts: list[tuple[int, str]] = []
    seen: set[int] = set()
    for index, line in enumerate(lines):
        if not label_re.search(line):
            continue
        for nearby_index in range(max(0, index - radius), min(len(lines), index + radius + 1)):
            if nearby_index not in seen:
                contexts.append((nearby_index, lines[nearby_index]))
                seen.add(nearby_index)
    return contexts

def split_around_first_label(line: str, label_pattern: str) -> tuple[str, str, tuple[int, int] | None]:
    match = re.search(label_pattern, line, re.IGNORECASE)
    if not match:
        return "", "", None
    return line[: match.start()], line[match.end() :], match.span()

def nearest_segment_before_label(text_before_label: str, stop_pattern: str = PROXIMITY_STOP_LABELS) -> str | None:
    pieces = [
        clean_ocr_value(piece)
        for piece in re.split(stop_pattern, text_before_label, flags=re.IGNORECASE)
        if clean_ocr_value(piece)
    ]
    return pieces[-1] if pieces else None

def nearest_segment_after_label(text_after_label: str, stop_pattern: str = PROXIMITY_STOP_LABELS) -> str | None:
    piece = re.split(stop_pattern, text_after_label, maxsplit=1, flags=re.IGNORECASE)[0]
    piece = clean_ocr_value(piece)
    return piece or None

def bidirectional_label_value(
    lines: list[str],
    label_pattern: str,
    stop_pattern: str = PROXIMITY_STOP_LABELS,
    *,
    prefer_before: bool = False,
    radius: int = 0,
) -> str | None:
    for _, line in label_contexts(lines, label_pattern, radius):
        before, after, span = split_around_first_label(line, label_pattern)
        if span is None:
            continue
        before_value = nearest_segment_before_label(before, stop_pattern)
        after_value = nearest_segment_after_label(after, stop_pattern)
        ordered = (before_value, after_value) if prefer_before else (after_value, before_value)
        for value in ordered:
            if value and not re.fullmatch(r"[_\-\s.]+", value):
                return value
    return None

def find_nearest_regex_to_label(
    lines: list[str],
    label_pattern: str,
    value_pattern: str,
    *,
    radius: int = 0,
    exclude_pattern: str | None = None,
) -> str | None:
    label_re = re.compile(label_pattern, re.IGNORECASE)
    value_re = re.compile(value_pattern, re.IGNORECASE)
    exclude_re = re.compile(exclude_pattern, re.IGNORECASE) if exclude_pattern else None
    best: tuple[int, str] | None = None

    for _, line in label_contexts(lines, label_pattern, radius):
        label_matches = list(label_re.finditer(line))
        if not label_matches:
            continue
        for value_match in value_re.finditer(line):
            value = clean_ocr_value(value_match.group(0))
            if not value:
                continue
            if exclude_re and exclude_re.search(value):
                continue
            distance = min(
                abs(value_match.start() - label_match.start())
                for label_match in label_matches
            )
            if best is None or distance < best[0]:
                best = (distance, value)

    return best[1] if best else None

def extract_age_near_label(lines: list[str], label_pattern: str = r"\bedad\b") -> str | None:
    value = find_nearest_regex_to_label(
        lines,
        label_pattern,
        r"\b(?:[1-9][0-9]?|1[01][0-9]|120)\b",
        radius=0,
    )
    if not value:
        return None
    age = int(value)
    return str(age) if 1 <= age <= 120 else None

def extract_sex_near_label(lines: list[str], label_pattern: str = r"\bsex\b") -> str | None:
    value = find_nearest_regex_to_label(
        lines,
        label_pattern,
        r"\b(?:male|female|m|f)\b",
        radius=0,
        exclude_pattern=r"civil|status|single|married",
    )
    return normalize_sex_value(value)

def extract_email_near_label(lines: list[str], label_pattern: str = r"\be[-\s]?mail\b") -> str | None:
    return find_nearest_regex_to_label(
        lines,
        label_pattern,
        r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}",
        radius=1,
    )

def extract_title_words_near_label(lines: list[str], label_pattern: str) -> str | None:
    candidate = bidirectional_label_value(lines, label_pattern, prefer_before=True, radius=0)
    if not candidate:
        candidate = bidirectional_label_value(lines, label_pattern, prefer_before=False, radius=0)
    if not candidate:
        return None
    match = re.search(r"\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,}){0,3}\b", candidate)
    if not match:
        return None
    value = clean_ocr_value(match.group(0))
    if re.search(PROXIMITY_STOP_LABELS, value, re.IGNORECASE):
        return None
    return value

def extract_text_near_label(
    lines: list[str],
    label_pattern: str,
    *,
    stop_pattern: str = PROXIMITY_STOP_LABELS,
    prefer_before: bool = False,
    radius: int = 0,
) -> str | None:
    value = bidirectional_label_value(
        lines,
        label_pattern,
        stop_pattern=stop_pattern,
        prefer_before=prefer_before,
        radius=radius,
    )
    if not value or has_mixed_form_labels(value):
        return None
    return value

def extract_text_after_label(
    lines: list[str],
    label_pattern: str,
    *,
    stop_pattern: str = PROXIMITY_STOP_LABELS,
    radius: int = 0,
) -> str | None:
    for _, line in label_contexts(lines, label_pattern, radius):
        _, after, span = split_around_first_label(line, label_pattern)
        if span is None:
            continue
        value = nearest_segment_after_label(after, stop_pattern)
        if value and not has_mixed_form_labels(value):
            return value
    return None

def clean_detention_place_candidate(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = clean_ocr_value(value)
    cleaned = re.sub(r"\bnakakulong\s*[:.]?\s*", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bdetained\s*[:.]?\s*", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:oo|yes)\s*(?:hindi|no)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:oo|yes|hindi|no)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = clean_ocr_value(cleaned)
    if not cleaned or has_mixed_form_labels(cleaned):
        return None
    if len(cleaned) < 3:
        return None
    return cleaned

def extract_money_near_label(lines: list[str], label_pattern: str) -> str | None:
    for _, line in label_contexts(lines, label_pattern, radius=0):
        _, after, span = split_around_first_label(line, label_pattern)
        if span is None:
            continue
        after_value = nearest_segment_after_label(after, PROXIMITY_STOP_LABELS)
        if not after_value:
            continue
        match = re.search(r"(?:P|₱|PHP)?\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|(?:P|₱|PHP)?\s*[0-9]+", after_value, re.IGNORECASE)
        if match:
            return clean_ocr_value(match.group(0))
    return None

def extract_detention_date_near_label(lines: list[str]) -> str | None:
    for label_pattern in [r"\bdetained\s+since\b", r"\bpetsa\s+ng\s+pag[ak]*akulong\b"]:
        value = bidirectional_label_value(lines, label_pattern, prefer_before=False, radius=0)
        if value:
            date_value = extract_date(value)
            if date_value:
                return date_value
            numeric_date = re.search(r"\b[0-9]{1,2}[/-][0-9]{1,2}[/-](?:19|20)?[0-9]{2}\b", value)
            if numeric_date:
                return numeric_date.group(0)
    return None

def extract_civil_status_near_label(lines: list[str]) -> str | None:
    for _, line in label_contexts(lines, r"\bcivil\s*status\b", radius=0):
        before, after, span = split_around_first_label(line, r"\bcivil\s*status\b")
        if span is None:
            continue
        nearby = " ".join(
            value for value in [
                nearest_segment_before_label(before),
                nearest_segment_after_label(after),
                line,
            ]
            if value
        )
        status = normalize_civil_status_value(nearby)
        if status:
            return status
    value = find_nearest_regex_to_label(
        lines,
        r"\bcivil\s*status\b",
        r"\b(?:single|sing|sngle|ing|married|widowed|widow|separated)\b",
        radius=0,
    )
    if value:
        return normalize_civil_status_value(value)
    return None

def extract_squashed_binary_choice(
    lines: list[str],
    label_pattern: str,
    true_pattern: str = r"oo|yes",
    false_pattern: str = r"hindi|no",
) -> bool | None:
    label_re = re.compile(label_pattern, re.IGNORECASE)
    true_re = re.compile(true_pattern, re.IGNORECASE)
    false_re = re.compile(false_pattern, re.IGNORECASE)
    mark_re = re.compile(r"(?:☑|☒|✓|✔|\[[xX/]\]|\([xX/]\)|■|▣)")

    for line in lines:
        if not label_re.search(line):
            continue
        compact = re.sub(r"\s+", "", line)
        true_match = true_re.search(compact)
        false_match = false_re.search(compact)

        if true_match:
            true_window = compact[max(0, true_match.start() - 4): true_match.end() + 4]
            if mark_re.search(true_window):
                return True
        if false_match:
            false_window = compact[max(0, false_match.start() - 4): false_match.end() + 4]
            if mark_re.search(false_window):
                return False

        if true_match and not false_match:
            return True
        if false_match and not true_match:
            return False

    return None

STRING_FIELD_PATTERNS = {
    "assigned_to": r"\bini[-\s]?atas\s+kay\b",
    "referred_by": r"\bini[-\s]?refer\s+ni\s*/?\s*inindorso\s+ng\b|\bini[-\s]?refer\s+ni\b|\binindorso\s+ng\b",
    "approved_by": r"\baprobado\s+ang\s+aksyon\s+ni\b",
    "action_legal_service_text": r"\bibinigay\s+na\s+serbisyong[-\s]?legal\b",
    "action_other_text": r"\biba\s+pa\b",
    "case_information": r"\bimpormasyon\s+sa\s+kaso\b",
    "cause_of_action": r"\bcause\s+of\s+action\b|\buri\s+ng\s+offense\b",
    "case_docket_title": r"\bpamagat\s+at\s+docket\s+no\.?\s+ng\s+kaso\b|\bpamagat\s+at\s+docket\s+no\b",
    "court_body": r"\bcourt/body/tribunal\s+kung\s+saan\s+naka[-\s]?file\b|\bcourt/body/tribunal\b|\bcourt\b.*\bfile\b",
}

ACTION_PATTERNS = {
    "action_merit_test": r"higit\s+pang\s+pag[-\s]?aaralan|merit\s+at\s+indigency",
    "action_representation": r"para\s+sa\s+representasyon|ibang\s+tulong[-\s]?legal",
}

CASE_TYPE_PATTERNS = {
    "case_type_criminal": r"\bcriminal\b",
    "case_type_civil": r"\bcivil\b",
    "case_type_labor": r"\blabor\b",
    "case_type_admin": r"\badministrative\b",
    "case_type_appealed": r"\bappealed\b",
}

SECTOR_PATTERNS = {
    "sector_foreign_national": r"foreign\s+national",
    "sector_urban_poor": r"urban\s+poor",
    "sector_rural_poor": r"rural\s+poor",
    "sector_indigenous": r"indigenous\s+people",
    "sector_pwd": r"\bpwd\b|person\s+with\s+disability|type\s+of\s+disability",
}

PROOF_PATTERNS = {
    "has_proof_submit_later": r"isusumite\s+sa\s+o\s+bago",
    "has_proof_itr": r"income\s+tax\s+return",
    "has_proof_brgy": r"certification\s+from\s+barangay",
    "has_proof_dswd": r"certification\s+from\s+dswd",
    "has_proof_other": r"iba\s+pa\s+\(gaya\s+ng\s+payslips|payslips",
}

ROLE_PATTERNS = {
    "applicant_role": r"plaintiff|defendant|oppositor|petitioner|respondent|complainant|accused|iba\s+pa",
    "adversary_role": r"plaintiff/complainant|defendant/respondent/accused|oppositor/iba\s+pa",
}

SPACY_ENTITY_PATTERNS = [
    {"label": "PAO_DATE_LABEL", "pattern": [{"LOWER": {"REGEX": "petsa"}}]},
    {"label": "PAO_CONTROL_LABEL", "pattern": [{"LOWER": "control"}, {"LOWER": {"REGEX": "no\\.?|number"}}]},
    {"label": "PAO_REGION_LABEL", "pattern": [{"LOWER": {"REGEX": "rehiyon|region"}}]},
    {"label": "PAO_DISTRICT_LABEL", "pattern": [{"LOWER": "district"}, {"LOWER": "office"}]},
    {"label": "PAO_INTERVIEWER_LABEL", "pattern": [{"LOWER": {"REGEX": "mananayam|interviewer"}}]},
    {"label": "PAO_ASSIGNED_TO_LABEL", "pattern": [{"LOWER": "ini"}, {"LOWER": {"REGEX": "atas|atasan"}}, {"LOWER": "kay"}]},
    {"label": "PAO_REFERRED_BY_LABEL", "pattern": [{"LOWER": {"REGEX": "ini|inirefer|ini-refer"}}, {"LOWER": {"REGEX": "refer|referred"}}, {"LOWER": {"REGEX": "ni|by"}}]},
    {"label": "LEGAL_SERVICE", "pattern": "Legal Documentation"},
    {"label": "LEGAL_SERVICE", "pattern": "Salaysay"},
    {"label": "LEGAL_SERVICE", "pattern": "Administration of Oath"},
    {"label": "LEGAL_SERVICE", "pattern": "Notaryo"},
    {"label": "LEGAL_SERVICE", "pattern": "Representasyon sa Korte"},
    {"label": "LEGAL_SERVICE", "pattern": "Inquest Legal Assistance"},
    {"label": "LEGAL_SERVICE", "pattern": "Mediation"},
    {"label": "CASE_TYPE", "pattern": "Criminal"},
    {"label": "CASE_TYPE", "pattern": "Civil"},
    {"label": "CASE_TYPE", "pattern": "Labor"},
    {"label": "CASE_TYPE", "pattern": "Administrative"},
    {"label": "CASE_TYPE", "pattern": "Appealed"},
    {"label": "PROOF_TYPE", "pattern": "Income Tax Return"},
    {"label": "PROOF_TYPE", "pattern": "Certification from Barangay"},
    {"label": "PROOF_TYPE", "pattern": "Certification from DSWD"},
    {"label": "COURT_FIELD_LABEL", "pattern": "Pamagat at Docket No. ng Kaso"},
    {"label": "COURT_FIELD_LABEL", "pattern": "Court Body Tribunal"},
]

_spacy_pao_nlp = None
_spacy_pao_matcher = None

def build_spacy_pao_pipeline():
    nlp = spacy.blank("xx")
    ruler = nlp.add_pipe("entity_ruler")
    ruler.add_patterns(SPACY_ENTITY_PATTERNS)

    matcher = Matcher(nlp.vocab)
    matcher.add("DATE_VALUE", [[
        {"LOWER": {"REGEX": PAO_MONTH_PATTERN}},
        {"IS_DIGIT": True, "OP": "?"},
        {"TEXT": {"REGEX": "^[0-9OIRL]{4}$"}},
    ]])
    matcher.add("CONTROL_NO_VALUE", [[
        {"TEXT": {"REGEX": "^(XI|X1|[A-Z0-9]{1,3})",}},
        {"TEXT": {"REGEX": "^[-A-Z0-9]+$"}, "OP": "+"},
    ]])
    matcher.add("PERSON_LABEL", [[{"LOWER": {"REGEX": "pangalan|mananayam"}}]])
    matcher.add("CONTACT_LABEL", [[{"LOWER": "contact"}, {"LOWER": {"REGEX": "no\\.?|number"}}]])
    return nlp, matcher

def get_spacy_pao_pipeline():
    global _spacy_pao_nlp, _spacy_pao_matcher
    if _spacy_pao_nlp is None or _spacy_pao_matcher is None:
        _spacy_pao_nlp, _spacy_pao_matcher = build_spacy_pao_pipeline()
    return _spacy_pao_nlp, _spacy_pao_matcher

def spacy_extract_pao_fields(raw_text: str, empty_schema: dict) -> dict:
    text = normalize_ocr_text(raw_text)
    nlp, matcher = get_spacy_pao_pipeline()
    doc = nlp(text)
    matches = matcher(doc)

    extracted = extract_offline_fields(raw_text, empty_schema)
    extracted["extraction_mode"] = "OFFLINE_SPACY_RULES"
    if get_bool_env("PAO_SPACY_DEBUG", False):
        extracted["spacy_entities"] = [
            {"label": ent.label_, "text": ent.text}
            for ent in doc.ents
        ]
        extracted["spacy_matches"] = [
            {"label": nlp.vocab.strings[match_id], "text": doc[start:end].text}
            for match_id, start, end in matches
        ]

    if not extracted.get("control_no"):
        for match_id, start, end in matches:
            if nlp.vocab.strings[match_id] == "CONTROL_NO_VALUE":
                control_no = extract_control_no(doc[start:end].text)
                if control_no:
                    extracted["control_no"] = control_no
                    break

    if not extracted.get("petsa"):
        for match_id, start, end in matches:
            if nlp.vocab.strings[match_id] == "DATE_VALUE":
                date_value = extract_date(doc[start:end].text)
                if date_value:
                    extracted["petsa"] = date_value
                    break

    extracted["rehiyon"] = extract_region(normalize_lines(raw_text))
    extracted = apply_quality_filters(remove_printed_template_leaks(extracted))
    return extracted

def extract_value_by_label(lines: list[str], label_pattern: str) -> str | None:
    value = bidirectional_label_value(lines, label_pattern, stop_pattern=COMMON_STOP_LABELS)
    if not value:
        return None
    value = re.sub(r"^/+\s*", "", value)
    value = re.sub(r"\b_{2,}\b", "", value)
    value = clean_ocr_value(value)
    if not value or re.fullmatch(r"[_\-\s.]+", value):
        return None
    return value

def apply_string_field_patterns(extracted: dict, lines: list[str]) -> None:
    for field_name, label_pattern in STRING_FIELD_PATTERNS.items():
        if extracted.get(field_name):
            continue
        value = extract_value_by_label(lines, label_pattern)
        if value:
            extracted[field_name] = value

def extract_inline_value(text: str, label_pattern: str, stop_pattern: str | None = None) -> str | None:
    pattern = label_pattern + r"\s*[:.]?\s*(.+)"
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    value = match.group(1)
    if stop_pattern:
        value = re.split(stop_pattern, value, maxsplit=1, flags=re.IGNORECASE)[0]
    value = clean_ocr_value(value)
    return value or None

def extract_section_value(lines: list[str], label_pattern: str, stop_pattern: str | None = None) -> str | None:
    value = bidirectional_label_value(lines, label_pattern, stop_pattern=stop_pattern or COMMON_STOP_LABELS)
    if value:
        return value
    return extract_inline_value(section_text(lines), label_pattern, stop_pattern or COMMON_STOP_LABELS)

def apply_applicant_section_fields(extracted: dict, lines: list[str]) -> None:
    applicant_lines = lines_between(
        lines,
        r"impormasyon\s+ukol\s+sa\s+aplikante|information\s+.*applicant",
        r"ii[-\s]?a|impormasyon\s+ukol\s+sa\s+representative|uri\s+ng\s+kaso|sektor\s+na\s+kabilang",
    )
    if not applicant_lines:
        return

    name = bidirectional_label_value(
        applicant_lines,
        r"\bpangalan\b",
        r"\bedad\b|\bsex\b|\bcivil\s*status\b|\brelihiyon\b|\bpagkamamamayan\b|\btirahan\b|\be[-\s]?mail\b",
        prefer_before=True,
    )
    if name and not re.search(r"impormasyon|aplikante|representative", name, re.IGNORECASE):
        extracted["applicant_name"] = name

    age = extract_age_near_label(applicant_lines)
    if age:
        extracted["applicant_age"] = age

    sex = extract_sex_near_label(applicant_lines)
    if sex:
        extracted["applicant_sex"] = sex

    civil_status = extract_civil_status_near_label(applicant_lines)
    if civil_status:
        extracted["applicant_civil_status"] = civil_status

    religion = extract_title_words_near_label(applicant_lines, r"\brelihiyon\b")
    if not religion:
        religion = extract_title_words_near_label(applicant_lines, r"\breligion\b")
    if religion:
        extracted["applicant_religion"] = religion

    email = extract_email_near_label(applicant_lines)
    if email:
        extracted["applicant_email"] = email

    address = extract_text_near_label(
        applicant_lines,
        r"\btirahan\b(?!\s+ng\s+asawa)|\baddress\b(?!\s+of\s+spouse)",
        stop_pattern=r"\be[-\s]?mail\b|\bspouse\b|\basawa\b|\bindividual\s+monthly\s+income\b|\bcontact\b|\bnakakulong\b|\bdetained\b",
    )
    if address:
        extracted["applicant_address"] = address

    education = extract_text_after_label(
        applicant_lines,
        r"\bnaabot\s+na\s+pag[-\s]?aaral\b|\beducational\s+attainment\b",
        stop_pattern=r"\brelihiyon\b|\breligion\b|\bsalita\s*/?\s*di(?:a|ya)lekto\b|\blanguage\s*/?\s*dialect\b|\bcontact\b|\bspouse\b|\basawa\b",
    )
    if education:
        extracted["applicant_educational_attainment"] = education

    citizenship = extract_text_after_label(
        applicant_lines,
        r"\bpagkamamamayan\b|\bcitizenship\b",
        stop_pattern=r"\btirahan\b|\baddress\b|\be[-\s]?mail\b|\bcontact\b",
    )
    if citizenship:
        extracted["applicant_citizenship"] = citizenship

    language = extract_text_after_label(
        applicant_lines,
        r"\bsalita\s*/?\s*di(?:a|ya)lekto\b|\blanguage\s*/?\s*dialect\b",
        stop_pattern=r"\bcontact\b|\bspouse\b|\basawa\b|\bindividual\s+monthly\s+income\b",
    )
    if language:
        extracted["applicant_language_dialect"] = language

    spouse = extract_text_near_label(
        applicant_lines,
        r"\basawa\s*[:.]|\bspouse\s*[:.]",
        stop_pattern=r"\bindividual\s+monthly\s+income\b|\be[-\s]?mail\b|\btirahan\s+ng\s+asawa\b|\baddress\s+of\s+spouse\b|\bcontact\s*no\b|\bnakakulong\b|\bdetained\b",
    )
    if spouse:
        extracted["spouse_name"] = spouse

    monthly_income = extract_money_near_label(applicant_lines, r"\bindividual\s+monthly\s+income\b")
    if monthly_income:
        extracted["individual_monthly_income"] = monthly_income

    spouse_address = extract_text_near_label(
        applicant_lines,
        r"\btirahan\s+ng\s+asawa\b|\baddress\s+of\s+spouse\b",
        stop_pattern=r"\bindividual\s+monthly\s+income\b|\be[-\s]?mail\b|\bspouse\b|\basawa\b|\bcontact\s*no\b|\bnakakulong\b|\bdetained\b|\blugar\s+ng\s+detention\b|\bplace\s+of\s+detention\b",
    )
    if spouse_address:
        extracted["spouse_address"] = spouse_address

    spouse_contact = extract_text_near_label(
        applicant_lines,
        r"\bcontact\s*no\.?\s+ng\s+asawa\b|\bcontact\s*no\.?\s+of\s+spouse\b",
        stop_pattern=r"\bnakakulong\b|\bdetained\b|\blugar\s+ng\s+detention\b|\bplace\s+of\s+detention\b",
    )
    if spouse_contact:
        extracted["spouse_contact"] = spouse_contact

    contact = extract_section_value(
        applicant_lines,
        r"\bcontact\s*no\.?\b",
        r"\basawa\b|\btirahan\s+ng\s+asawa\b|\bcontact\s*no\.\s*ng\s*asawa\b|\blugar\s+ng\s+detention\b",
    )
    if contact and not re.search(r"asawa|detention|petsa", contact, re.IGNORECASE):
        extracted["applicant_contact"] = contact

    detained = extract_squashed_binary_choice(applicant_lines, r"\bnakakulong\b")
    if detained is None:
        detained = extract_squashed_binary_choice(applicant_lines, r"\bdetained\b")
    if detained is not None:
        extracted["is_detained"] = detained

    detained_since = extract_detention_date_near_label(applicant_lines)
    if detained_since:
        extracted["detained_since"] = detained_since

    place_of_detention = clean_detention_place_candidate(extract_text_near_label(
        applicant_lines,
        r"\blugar\s+ng\s+detention\b|\bplace\s+of\s+detention\b",
        stop_pattern=r"\bpetsa\s+ng\s+pag[ak]*akulong\b|\bdetained\s+since\b|\buri\s+ng\s+kaso\b|\bii[-\s]?a\b|\brepresentative\b",
        prefer_before=True,
    ))
    if place_of_detention:
        extracted["place_of_detention"] = place_of_detention

def apply_representative_section_fields(extracted: dict, lines: list[str]) -> None:
    representative_lines = lines_between(
        lines,
        r"ii[-\s]?a\s+impormasyon|impormasyon\s+ukol\s+sa\s+representative",
        r"uri\s+ng\s+kaso|sektor\s+na\s+kabilang|affidavit",
    )
    if not representative_lines:
        return
    representative_compact = section_text(representative_lines)

    field_specs = {
        "rep_name": (r"\bpangalan\b", r"\bedad\b|\bsex\b|\bcivil\s*status\b|\btirahan\b|\bcontact\b|\be[-\s]?mail\b"),
        "rep_address": (r"\btirahan\b", r"\brelasyon\b|\bcontact\b|\be[-\s]?mail\b"),
        "rep_contact": (r"\bcontact\s*no\.?\b", r"\be[-\s]?mail\b|\brelasyon\b"),
        "rep_relation": (r"\brelasyon\s+sa\s+aplikante\b", r"\bcontact\b|\be[-\s]?mail\b|\buri\s+ng\s+kaso\b"),
        "rep_email": (r"\be[-\s]?mail\b", r"\buri\s+ng\s+kaso\b|\bsektor\b"),
    }
    for field_name, (label_pattern, stop_pattern) in field_specs.items():
        value = extract_section_value(representative_lines, label_pattern, stop_pattern)
        if value and not re.search(r"representative|pupunan|aplikante", value, re.IGNORECASE):
            extracted[field_name] = value

    age_match = re.search(r"\bedad\s*[:.]?\s*([0-9]{1,3})\b", representative_compact, re.IGNORECASE)
    if age_match:
        extracted["rep_age"] = age_match.group(1)
    sex_match = re.search(r"\bsex\s*[:.]?\s*([A-Za-z]+)\b", representative_compact, re.IGNORECASE)
    if sex_match:
        extracted["rep_sex"] = clean_ocr_value(sex_match.group(1))
    civil_status = extract_inline_value(representative_compact, r"\bcivil\s*status\b", r"\bcontact\b|\be[-\s]?mail\b")
    if civil_status:
        extracted["rep_civil_status"] = civil_status

def apply_adversary_section_fields(extracted: dict, lines: list[str]) -> None:
    adversary_lines = lines_between(
        lines,
        r"katunggali\s+sa\s+kaso|adverse\s+party|kalabang\s+partido",
        r"impormasyon\s+sa\s+kaso|pamagat\s+at\s+docket|court/body|cause\s+of\s+action",
    )
    if not adversary_lines:
        return
    name = extract_section_value(adversary_lines, r"\bpangalan\b", r"\btirahan\b|\bimpormasyon\b|\bpamagat\b")
    address = extract_section_value(adversary_lines, r"\btirahan\b", r"\bimpormasyon\b|\bpamagat\b|\bcourt\b")
    if name:
        extracted["adversary_name"] = name
    if address:
        extracted["adversary_address"] = address

def apply_visible_or_checked_patterns(
    extracted: dict,
    lines: list[str],
    compact: str,
    patterns: dict[str, str],
    checkbox_mode: str,
) -> None:
    for field_name, pattern in patterns.items():
        if checkbox_mode == "strict":
            extracted[field_name] = is_checked_option(lines, pattern)
        else:
            extracted[field_name] = has_visible_option(compact, pattern)

def extract_selected_option(
    lines: list[str],
    compact: str,
    option_patterns: dict[str, str],
    checkbox_mode: str,
) -> str | None:
    for option_value, pattern in option_patterns.items():
        if checkbox_mode == "strict":
            if is_checked_option(lines, pattern):
                return option_value
        elif has_visible_option(compact, pattern):
            return option_value
    return None

def extract_court_filing_status(compact: str) -> bool | None:
    match = re.search(r"nakahain\s+na\s+ba\s+sa\s+hukuman.*?\b(oo|hindi)\b", compact, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).lower() == "oo"

PRINTED_TEMPLATE_VALUES = {
    "(pangalan at lagda) public attorney",
    "pangalan at lagda public attorney",
    "public attorney",
    "pangalan at lagda ng dpa/rpa/oic",
    "signature of affiant",
    "buong pangalan at lagda ng party/representative",
}

PRINTED_TEMPLATE_PATTERNS = [
    r"\blagda\b.*\bpublic\s+attorney\b",
    r"\bpangalan\b.*\blagda\b",
    r"\bpublic\s+attorney\b",
    r"\blawyer\b",
    r"\bang\s+aksyon\s+ni\b",
    r"\bsignature\s+of\s+affiant\b",
    r"\bparty/representative\b",
    r"\bdpa/rpa/oic\b",
]

def remove_printed_template_leaks(extracted_data: dict) -> dict:
    cleaned = dict(extracted_data)
    for field_name, value in list(cleaned.items()):
        if field_name == "raw_text":
            continue
        if not isinstance(value, str):
            continue
        normalized = clean_ocr_value(value).lower()
        normalized = re.sub(r"\s+", " ", normalized)
        if normalized in PRINTED_TEMPLATE_VALUES or any(
            re.search(pattern, normalized, re.IGNORECASE) for pattern in PRINTED_TEMPLATE_PATTERNS
        ):
            cleaned[field_name] = None
    return cleaned

def has_mixed_form_labels(value: str) -> bool:
    label_hits = re.findall(
        r"\b(pangalan|edad|sex|civil\s*status|relihiyon|tirahan|contact|asawa|detention|relasyon|e[-\s]?mail)\b",
        value,
        flags=re.IGNORECASE,
    )
    return len(label_hits) >= 2

def looks_like_ocr_noise(value: str) -> bool:
    cleaned = clean_ocr_value(value)
    if not cleaned:
        return True
    if len(cleaned) <= 2:
        return True
    letters = re.findall(r"[A-Za-z]", cleaned)
    if len(letters) >= 6:
        vowels = re.findall(r"[AEIOUaeiou]", cleaned)
        if len(vowels) / len(letters) < 0.18:
            return True
    if re.search(r"[a-z]{2,}[A-Z]{2,}[a-z]{1,}|[A-Z]{3,}[a-z]{2,}[A-Z]", cleaned):
        return True
    return False

def clean_person_name_candidate(value: str | None) -> str | None:
    if not value:
        return None
    candidate = clean_ocr_value(value)
    if re.search(r"\bedad\b", candidate, re.IGNORECASE):
        parts = re.split(r"\bedad\s*[:.]?", candidate, maxsplit=1, flags=re.IGNORECASE)
        candidate = parts[-1]
    candidate = re.sub(r"\b(sex|civil\s*status|pangalan)\b\s*[:.]?", " ", candidate, flags=re.IGNORECASE)
    candidate = re.sub(r"\b(male|female|single|married|widow(?:ed)?|separated|m|f)\b", " ", candidate, flags=re.IGNORECASE)
    candidate = clean_ocr_value(candidate)
    if not candidate or len(candidate) < 3:
        return None
    if has_mixed_form_labels(candidate):
        return None
    return candidate

def normalize_sex_value(value: str | None) -> str | None:
    if not value:
        return None
    compact = clean_ocr_value(value).lower()
    if re.fullmatch(r"m|male", compact):
        return "Male"
    if re.fullmatch(r"f|female", compact):
        return "Female"
    return None

def normalize_civil_status_value(value: str | None) -> str | None:
    if not value:
        return None
    compact = clean_ocr_value(value).lower()
    if compact in {"sing", "sngle", "ing"}:
        return "Single"
    for status in ["single", "married", "widowed", "widow", "separated"]:
        if re.search(rf"\b{status}\b", compact):
            return "Widowed" if status == "widow" else status.title()
    return None

RELIGION_TERMS = {
    "catholic",
    "roman catholic",
    "christian",
    "islam",
    "muslim",
    "iglesia ni cristo",
    "inc",
    "born again",
    "baptist",
    "adventist",
    "protestant",
}

ADDRESS_SIGNAL_PATTERN = (
    r"\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|barangay|brgy\.?|purok|sitio|subdivision|"
    r"village|zone|block|blk\.?|lot|phase|city|municipality|province|davao|panabo|tagum|"
    r"del\s+norte|del\s+sur)\b|#|\d"
)
ADDRESS_REJECT_PATTERN = (
    r"\b(?:individual\s+monthly\s+income|monthly\s+income|income|contact\s*no|e[-\s]?mail|"
    r"nakakulong|detained|petsa\s+ng\s+pag[ak]*akulong|edad|sex|civil\s*status|"
    r"relihiyon|religion|pangalan|name|asawa|spouse)\b"
)

def normalize_simple_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", clean_ocr_value(value).lower()).strip(" .,:;")

def is_religion_like(value: str | None) -> bool:
    normalized = normalize_simple_text(value)
    return normalized in RELIGION_TERMS

def clean_education_candidate(value: str | None, religion: str | None = None) -> str | None:
    if not value:
        return None
    candidate = clean_ocr_value(value)
    if not candidate or has_mixed_form_labels(candidate) or looks_like_ocr_noise(candidate):
        return None
    if normalize_simple_text(candidate) == normalize_simple_text(religion):
        return None
    if is_religion_like(candidate):
        return None
    return candidate

def clean_address_candidate(value: str | None) -> str | None:
    if not value:
        return None
    candidate = clean_ocr_value(value)
    if not candidate or has_mixed_form_labels(candidate) or looks_like_ocr_noise(candidate):
        return None
    if re.search(ADDRESS_REJECT_PATTERN, candidate, re.IGNORECASE):
        return None
    words = re.findall(r"[A-Za-z]+", candidate)
    has_address_signal = bool(re.search(ADDRESS_SIGNAL_PATTERN, candidate, re.IGNORECASE))
    if len(words) <= 1 and not has_address_signal:
        return None
    if candidate.isupper() and len(candidate) <= 8 and not has_address_signal:
        return None
    return candidate

def apply_quality_filters(extracted: dict) -> dict:
    cleaned = dict(extracted)
    cleaned["applicant_name"] = clean_person_name_candidate(cleaned.get("applicant_name"))
    cleaned["rep_name"] = clean_person_name_candidate(cleaned.get("rep_name"))
    cleaned["adversary_name"] = clean_person_name_candidate(cleaned.get("adversary_name"))
    cleaned["applicant_sex"] = normalize_sex_value(cleaned.get("applicant_sex"))
    cleaned["rep_sex"] = normalize_sex_value(cleaned.get("rep_sex"))
    cleaned["applicant_civil_status"] = normalize_civil_status_value(cleaned.get("applicant_civil_status"))
    cleaned["rep_civil_status"] = normalize_civil_status_value(cleaned.get("rep_civil_status"))
    cleaned["applicant_educational_attainment"] = clean_education_candidate(
        cleaned.get("applicant_educational_attainment"),
        cleaned.get("applicant_religion"),
    )

    for field_name in [
        "referred_by",
        "approved_by",
        "applicant_citizenship",
        "applicant_language_dialect",
        "spouse_name",
        "spouse_contact",
    ]:
        value = cleaned.get(field_name)
        if isinstance(value, str) and (
            has_mixed_form_labels(value)
            or re.search(PROXIMITY_STOP_LABELS, value, re.IGNORECASE)
            or looks_like_ocr_noise(value)
            or re.search(r"\blawyer\b|\bang\s+aksyon\s+ni\b|\bdpa/rpa/oic\b", value, re.IGNORECASE)
        ):
            cleaned[field_name] = None

    for field_name in ["applicant_address", "spouse_address", "rep_address", "adversary_address"]:
        cleaned[field_name] = clean_address_candidate(cleaned.get(field_name))

    value = cleaned.get("individual_monthly_income")
    if isinstance(value, str) and not re.search(r"[0-9]", value):
        cleaned["individual_monthly_income"] = None

    value = cleaned.get("detained_since")
    if isinstance(value, str) and not re.search(r"(?:19|20)?[0-9]{2}|january|february|march|april|may|june|july|august|september|october|november|december|enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre", value, re.IGNORECASE):
        cleaned["detained_since"] = None

    value = cleaned.get("place_of_detention")
    if isinstance(value, str):
        cleaned["place_of_detention"] = clean_detention_place_candidate(value)

    for field_name in ["applicant_contact", "rep_contact"]:
        value = cleaned.get(field_name)
        if isinstance(value, str) and not re.search(r"\d{5,}|@", value):
            cleaned[field_name] = None

    for field_name in ["case_information", "cause_of_action"]:
        value = cleaned.get(field_name)
        if isinstance(value, str) and has_mixed_form_labels(value):
            cleaned[field_name] = None

    return cleaned

def extract_affidavit_fields(extracted: dict, lines: list[str], compact: str) -> None:
    if not section_visible(compact, r"affidavit\s+of\s+indigency", r"salaysay\s+na\s+pagdarahop"):
        return

    name_value = line_after_label(
        lines,
        r"\bi\b",
        stop_pattern=r"\bof\s+legal\s+age\b|\bhustong\s+gulang\b|\bresiding\b",
    )
    if name_value and not re.search(r"affidavit|republic|philippines", name_value, re.IGNORECASE):
        extracted["affidavit_name"] = clean_ocr_value(name_value)

    income_match = re.search(
        r"(?:monthly\s+net\s+salary/income|kumikita\s+kada\s+buwan).*?P\s*([0-9,.\s]+)",
        compact,
        re.IGNORECASE,
    )
    if income_match:
        extracted["affidavit_income"] = clean_ocr_value(income_match.group(1))

    witness_match = re.search(
        r"signature\s+this\s+(.+?)\s+in\s+(.+?),\s*philippines",
        compact,
        re.IGNORECASE,
    )
    if witness_match:
        extracted["affidavit_date"] = clean_ocr_value(witness_match.group(1))
        extracted["affidavit_location"] = clean_ocr_value(witness_match.group(2))

    attorney = line_after_label(
        lines,
        r"public\s+attorney\s+\(pursuant\s+to\s+r\.a\.\s+no\.\s+9406\)",
        stop_pattern=COMMON_STOP_LABELS,
    )
    if attorney:
        extracted["administering_attorney"] = attorney

def apply_consent_fields(extracted: dict, lines: list[str], compact: str, checkbox_mode: str) -> None:
    if not section_visible(compact, r"representasyon\s+ng\s+public\s+attorney", r"kalabang\s+partido"):
        return

    if checkbox_mode == "strict":
        extracted["consent_other_district"] = is_checked_option(lines, r"\boo\b")
        extracted["consent_appeals_unit"] = is_checked_option(lines, r"special\s+and\s+appealed|regional\s+special")
        extracted["understood_no_complaint"] = is_checked_option(lines, r"oo\s+nang\s+walang\s+kwalipikasyon")
        extracted["trusts_pao_fairness"] = is_checked_option(lines, r"buong\s+pagtitiwala|naniniwala\s+pa\s+rin")
    else:
        extracted["consent_other_district"] = has_visible_option(compact, r"ibang\s+distrito")
        extracted["consent_appeals_unit"] = has_visible_option(compact, r"special\s+and\s+appealed|regional\s+special")
        extracted["understood_no_complaint"] = has_visible_option(compact, r"hindi\s+kayo\s+magre[-\s]?reklamo")
        extracted["trusts_pao_fairness"] = has_visible_option(compact, r"buong\s+pagtitiwala|naniniwala\s+pa\s+rin")

def extract_offline_fields(raw_text: str, empty_schema: dict) -> dict:
    text = normalize_ocr_text(raw_text)
    lines = normalize_lines(raw_text)
    compact = re.sub(r"\s+", " ", text)
    extracted = empty_schema.copy()
    extracted["raw_text"] = raw_text
    extracted["extraction_mode"] = "OFFLINE_RULE_BASED"

    extracted["control_no"] = extract_labeled_control_no(lines, compact)
    extracted["petsa"] = extract_labeled_date(lines, compact)
    extracted["district_office"] = extract_district_office(lines)
    extracted["mananayam"] = extract_interviewer(lines)
    apply_string_field_patterns(extracted, lines)
    apply_applicant_section_fields(extracted, lines)
    apply_representative_section_fields(extracted, lines)
    apply_adversary_section_fields(extracted, lines)

    checkbox_mode = get_str_env("PAO_CHECKBOX_MODE", "strict")
    apply_visible_or_checked_patterns(extracted, lines, compact, ACTION_PATTERNS, checkbox_mode)

    request_section_visible = section_visible(
        compact,
        r"\buri\s+ng\s+inihihingi\s+ng\s+tulong\b",
        r"\blegal\s*documentation\b",
        r"\bsalaysay\b",
        r"\bnotaryo\b",
        r"\badministration\s+of\s+oat?h\b",
        r"\binquest\b",
        r"\bmediation\b",
    )
    if request_section_visible:
        service_patterns = {
            "req_legal_doc": r"legal\s*documentation|salaysay",
            "req_oath": r"administration\s+of\s+oat?h|notaryo|panunumpa",
            "req_court_rep": r"representasyon\s+sa\s+korte|representasyon\s+sa\s+ibang\s+tanggapan|korte",
            "req_inquest": r"\binquest\b",
            "req_mediation": r"mediation|conciliation|pagkakasundo",
        }
        for field_name, pattern in service_patterns.items():
            if checkbox_mode == "strict":
                extracted[field_name] = is_checked_option(lines, pattern)
            else:
                extracted[field_name] = has_visible_option(compact, pattern)
    extracted["req_other_text"] = None

    apply_visible_or_checked_patterns(extracted, lines, compact, CASE_TYPE_PATTERNS, checkbox_mode)
    apply_visible_or_checked_patterns(extracted, lines, compact, PROOF_PATTERNS, checkbox_mode)

    for field_name, pattern in SECTOR_PATTERNS.items():
        extracted[field_name] = is_checked_option(lines, pattern)

    applicant_role = extract_selected_option(
        lines,
        compact,
        {
            "Plaintiff": r"\bplaintiff\b",
            "Defendant": r"\bdefendant\b",
            "Oppositor": r"\boppositor\b",
            "Petitioner": r"\bpetitioner\b",
            "Respondent": r"\brespondent\b",
            "Complainant": r"\bcomplainant\b",
            "Accused": r"\baccused\b",
        },
        checkbox_mode,
    )
    if applicant_role:
        extracted["applicant_role"] = applicant_role

    adversary_role = extract_selected_option(
        lines,
        compact,
        {
            "Plaintiff/Complainant": r"plaintiff/complainant",
            "Defendant/Respondent/Accused": r"defendant/respondent/accused",
            "Oppositor/Iba pa": r"oppositor/iba\s+pa",
        },
        checkbox_mode,
    )
    if adversary_role:
        extracted["adversary_role"] = adversary_role

    extract_affidavit_fields(extracted, lines, compact)
    apply_consent_fields(extracted, lines, compact, checkbox_mode)

    extracted["rehiyon"] = extract_region(lines)
    extracted["is_filed_in_court"] = extract_court_filing_status(compact)

    return apply_quality_filters(remove_printed_template_leaks(extracted))

# ==========================================
# 1. IMAGE PRE-PROCESSING HELPERS
# ==========================================
def compress_image_for_vlm(original_path: str, max_size_mb: int | None = None):
    """Only used for the Cloud Mistral API to save bandwidth."""
    max_size_mb = max_size_mb or get_int_env("VLM_MAX_IMAGE_MB", 4)
    file_size_mb = os.path.getsize(original_path) / (1024 * 1024)
    max_dimension = get_int_env("VLM_MAX_IMAGE_DIMENSION", 2200)
    jpeg_quality = get_int_env("VLM_JPEG_QUALITY", 92)
    
    with Image.open(original_path) as img:
        if max(img.size) > max_dimension or file_size_mb > max_size_mb:
            if img.mode in ("RGBA", "P"): img = img.convert("RGB")
            try: resample_filter = Image.Resampling.LANCZOS
            except AttributeError: resample_filter = Image.LANCZOS 
            
            img.thumbnail((max_dimension, max_dimension), resample_filter)
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_path = temp_file.name
            img.save(temp_path, "JPEG", optimize=True, quality=jpeg_quality)
            return temp_path
    return original_path

def encode_image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def enhance_handwriting_image(image: np.ndarray) -> np.ndarray:
    """
    ENTERPRISE-GRADE preprocessing for handwritten form OCR.
    Improves contrast, reduces noise, handles lighting variations.
    """
    # Step 1: Convert to LAB color space for better contrast handling
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    # Step 2: CLAHE (Contrast Limited Adaptive Histogram Equalization) on L channel
    # This amplifies handwriting contrast while preventing over-enhancement of noise
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    
    # Step 3: Recombine channels
    enhanced_lab = cv2.merge([l, a, b])
    enhanced = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
    
    # Step 4: Bilateral filtering (preserves edges, kills noise)
    enhanced = cv2.bilateralFilter(enhanced, 9, 75, 75)
    
    # Step 5: Convert to grayscale for final contrast boost
    gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
    
    # Step 6: Morphological opening to remove tiny noise specs
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    gray = cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel, iterations=1)
    
    # Step 7: Auto-contrast: stretch histogram to full range
    min_val = np.percentile(gray, 2)
    max_val = np.percentile(gray, 98)
    if max_val > min_val:
        gray = cv2.convertScaleAbs(gray - min_val) * 255 / (max_val - min_val)
        gray = np.uint8(np.clip(gray, 0, 255))
    
    # Convert back to BGR for PaddleOCR (expects 3 channels)
    enhanced = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    
    return enhanced

def fast_prepare_ocr_image(image: np.ndarray) -> np.ndarray:
    """Cheap contrast normalization for faster OCR on mostly readable scans."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

def crop_document_region(image: np.ndarray) -> np.ndarray:
    """Remove obvious camera background so OCR scans fewer pixels."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 70, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image
    h, w = image.shape[:2]
    contour = max(contours, key=cv2.contourArea)
    x, y, cw, ch = cv2.boundingRect(contour)
    if cw * ch < (w * h * 0.45):
        return image
    pad = 12
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(w, x + cw + pad)
    y2 = min(h, y + ch + pad)
    return image[y1:y2, x1:x2]

def group_ocr_lines(ocr_results: list) -> str:
    """
    Group PaddleOCR output into logical lines instead of character-by-character.
    Handles multi-line text fields and improves readability.
    """
    if not ocr_results:
        return ""
    
    result = ocr_results[0]
    text_items = []

    if isinstance(result, dict) and "rec_texts" in result:
        boxes = as_sequence(result.get("rec_polys"))
        if not boxes:
            boxes = as_sequence(result.get("dt_polys"))
        scores = as_sequence(result.get("rec_scores"))
        texts = as_sequence(result.get("rec_texts"))
        for index, text in enumerate(texts):
            if not text:
                continue
            bbox = boxes[index] if index < len(boxes) else [[0, index * 24]]
            confidence = scores[index] if index < len(scores) else 1.0
            points = np.asarray(bbox).reshape(-1, 2)
            text_items.append({
                "x": float(np.min(points[:, 0])),
                "y": float(np.min(points[:, 1])),
                "text": str(text).strip(),
                "confidence": float(confidence),
            })
    else:
        for line in result:
            if len(line) >= 2:
                bbox, (text, confidence) = line[0], line[1]
                points = np.asarray(bbox).reshape(-1, 2)
                text_items.append({
                    "x": float(np.min(points[:, 0])),
                    "y": float(np.min(points[:, 1])),
                    "text": text.strip(),
                    "confidence": confidence
                })

    if not text_items:
        return ""
    
    # Step 2: Filter low-confidence results (< 0.3)
    text_items = [item for item in text_items if item["confidence"] > 0.3]
    
    # Step 3: Sort by Y-coordinate (top-to-bottom), then X (left-to-right)
    text_items = sorted(text_items, key=lambda x: (x["y"], x["x"]))
    
    # Step 4: Group texts into lines based on Y proximity (within 20 pixels = same line)
    grouped_lines = []
    current_line = []
    last_y = None
    
    for item in text_items:
        if last_y is None or abs(item["y"] - last_y) < 20:
            current_line.append(item["text"])
            last_y = item["y"]
        else:
            if current_line:
                grouped_lines.append(" ".join(current_line))
            current_line = [item["text"]]
            last_y = item["y"]
    
    if current_line:
        grouped_lines.append(" ".join(current_line))
    
    # Step 5: Join lines with newlines for readability
    return "\n".join(grouped_lines)

# ==========================================
# 2. THE DUAL-HYBRID ORCHESTRATOR
# ==========================================
class JurisGuardExtractionEngine:
    def __init__(self):
        print("[JurisGuard] Booting up Enterprise Orchestrator...")
        self.mistral_api_key = os.getenv("MISTRAL_API_KEY")
        self.ocr_max_dimension = get_int_env("PADDLEOCR_MAX_DIMENSION", 1280)
        self.ocr_det_limit_side_len = get_int_env("PADDLEOCR_DET_LIMIT_SIDE_LEN", 736)
        self.ocr_det_model_name = os.getenv("PADDLEOCR_DET_MODEL_NAME", "PP-OCRv4_mobile_det")
        self.ocr_rec_model_name = os.getenv("PADDLEOCR_REC_MODEL_NAME", "en_PP-OCRv4_mobile_rec")
        self.ocr_enable_angle_cls = get_bool_env("PADDLEOCR_ENABLE_ANGLE_CLS", False)
        self.ocr_use_enhanced_preprocess = get_bool_env("PADDLEOCR_ENHANCED_PREPROCESS", False)
        self.ocr_cpu_threads = get_int_env("PADDLEOCR_CPU_THREADS", max(2, (os.cpu_count() or 4) - 1))
        self.ocr_enable_mkldnn = get_bool_env("PADDLEOCR_ENABLE_MKLDNN", False)
        self.ocr_use_gpu = get_bool_env("PADDLEOCR_USE_GPU", False)
        self.ocr_device = "gpu" if self.ocr_use_gpu else "cpu"
        self.mistral_connect_timeout = get_int_env("MISTRAL_CONNECT_TIMEOUT_SECONDS", 10)
        self.mistral_read_timeout = get_int_env("MISTRAL_READ_TIMEOUT_SECONDS", 60)
        self.mistral_model = os.getenv("MISTRAL_MODEL", "pixtral-12b-2409")
        
        print("[JurisGuard] Offline Eyes (PaddleOCR) will initialize only when local OCR is needed.")
        import logging
        logging.getLogger('ppocr').setLevel(logging.ERROR)
        self.local_ocr = None
        self.safe_ocr = None
        print(
            "[JurisGuard] PaddleOCR config: "
            f"det={self.ocr_det_model_name}, rec={self.ocr_rec_model_name}, "
            f"mkldnn={self.ocr_enable_mkldnn}, threads={self.ocr_cpu_threads}"
        )

    def _create_ocr_engine(self, enable_mkldnn: bool, engine: str):
        if PaddleOCR is None:
            raise RuntimeError(f"PaddleOCR is not available: {PADDLEOCR_IMPORT_ERROR}")
        if importlib.util.find_spec("paddle") is None:
            raise RuntimeError(
                "Offline OCR dependency is missing: install paddlepaddle in the backend virtual environment."
            )
        return PaddleOCR(
            use_angle_cls=self.ocr_enable_angle_cls,
            text_detection_model_name=self.ocr_det_model_name,
            text_recognition_model_name=self.ocr_rec_model_name,
            device=self.ocr_device,
            engine=engine,
            enable_mkldnn=enable_mkldnn,
            cpu_threads=self.ocr_cpu_threads,
            text_det_limit_side_len=self.ocr_det_limit_side_len,
            text_recognition_batch_size=16,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
        )

    def _run_paddleocr(self, image: np.ndarray):
        try:
            if self.local_ocr is None:
                self.local_ocr = self._create_ocr_engine(
                    enable_mkldnn=self.ocr_enable_mkldnn,
                    engine="paddle_static",
                )
            return self.local_ocr.ocr(image)
        except Exception as exc:
            print(f"[Warning] Fast PaddleOCR engine failed ({exc}). Retrying with safe CPU engine...")
            traceback.print_exc()
            if self.safe_ocr is None:
                self.safe_ocr = self._create_ocr_engine(enable_mkldnn=False, engine="paddle")
            try:
                return self.safe_ocr.ocr(image)
            except Exception as safe_exc:
                print(f"[Error] Safe PaddleOCR engine also failed ({safe_exc}).")
                traceback.print_exc()
                raise

    def _check_network_heartbeat(self) -> bool:
        if not self.mistral_api_key:
            return False
        try:
            socket.create_connection(("api.mistral.ai", 443), timeout=0.75)
            return True
        except OSError:
            return False

    def _get_empty_schema(self) -> dict:
        return {
            "rehiyon": None, "district_office": None, "control_no": None, "petsa": None, "mananayam": None,
            "referred_by": None, "assigned_to": None, "approved_by": None,
            "action_merit_test": False, "action_representation": False, "action_legal_service_text": None, "action_other_text": None,
            "req_legal_doc": False, "req_oath": False, "req_court_rep": False, "req_inquest": False, "req_mediation": False, "req_other_text": None,
            "applicant_name": None, "applicant_age": None, "applicant_sex": None, "applicant_civil_status": None,
            "applicant_religion": None, "applicant_educational_attainment": None, "applicant_citizenship": None,
            "applicant_language_dialect": None, "applicant_address": None, "applicant_email": None, "applicant_contact": None,
            "spouse_name": None, "spouse_address": None, "spouse_contact": None, "individual_monthly_income": None,
            "is_detained": False, "detained_since": None, "place_of_detention": None,
            "rep_name": None, "rep_age": None, "rep_sex": None, "rep_civil_status": None, "rep_address": None, "rep_contact": None, "rep_relation": None, "rep_email": None,
            "case_type_criminal": False, "case_type_civil": False, "case_type_labor": False, "case_type_admin": False, "case_type_appealed": False,
            "sector_foreign_national": None, "sector_urban_poor": None, "sector_rural_poor": None, "sector_indigenous": None, "sector_pwd": None,
            "affidavit_name": None, "affidavit_income": None, "affidavit_date": None, "affidavit_location": None, "administering_attorney": None,
            "consent_other_district": None, "consent_appeals_unit": None, "understood_no_complaint": False, "trusts_pao_fairness": False,
            "has_proof_submit_later": False, "has_proof_itr": False, "has_proof_brgy": False, "has_proof_dswd": False, "has_proof_other": False,
            "proof_submit_date": None, "proof_itr_date": None, "proof_brgy_date": None, "proof_dswd_date": None, "proof_other_text": None,
            "applicant_role": None, "adversary_role": None, "adversary_name": None, "adversary_address": None,
            "case_information": None, "cause_of_action": None, "is_filed_in_court": None, "case_docket_title": None, "court_body": None,
            "extraction_mode": None, "raw_text": None
        }

    def _get_sectioned_schema(self) -> dict:
        return {
            "header": {
                "time_in_service_office": None,
                "region": None,
                "district_office": None,
                "date": None,
                "control_no": None,
                "action_taken": None,
                "assigned_to": None,
                "interviewer": None,
                "referred_by_indorsed_by": None,
                "action_approved_by": None,
                "time_in_lawyer": None,
                "time_out_lawyer": None,
            },
            "nature_of_request": {
                "legal_documentation": False,
                "administration_of_oath": False,
                "representation_in_court_or_quasi_judicial_bodies": False,
                "inquest_legal_assistance": False,
                "mediation_conciliation": False,
                "others": False,
                "others_text": None,
            },
            "applicant_personal_circumstances": {
                "name": None,
                "age": None,
                "sex": None,
                "civil_status": None,
                "religion": None,
                "educational_attainment": None,
                "citizenship": None,
                "language_dialect": None,
                "address": None,
                "contact_no": None,
                "email": None,
                "spouse": None,
                "individual_monthly_income": None,
                "address_of_spouse": None,
                "contact_no_of_spouse": None,
                "detained": False,
                "detained_since": None,
                "place_of_detention": None,
            },
            "representative_personal_circumstances": {
                "name": None,
                "age": None,
                "sex": None,
                "civil_status": None,
                "address": None,
                "contact_no": None,
                "relationship_to_applicant": None,
                "email": None,
            },
            "nature_of_case": {
                "criminal": False,
                "civil": False,
                "labor": False,
                "administrative": False,
                "appealed": False,
            },
            "applicant_classification": {
                "child_in_conflict_with_the_law": False,
                "senior_citizen": False,
                "foreign_national": False,
                "foreign_national_details": None,
                "woman": False,
                "vawc_victim": False,
                "refugee_evacuee": False,
                "urban_poor": False,
                "urban_poor_details": None,
                "law_enforcer": False,
                "drug_related_duty": False,
                "tenant_in_agrarian_case": False,
                "rural_poor": False,
                "rural_poor_details": None,
                "ofw_land_based": False,
                "ofw_sea_based": False,
                "arrested_for_terrorism": False,
                "indigenous_people": False,
                "indigenous_people_details": None,
                "pwd": False,
                "pwd_disability_type": None,
                "victim_of_torture": False,
                "victim_of_trafficking": False,
                "former_rebel_or_fve": False,
                "petitioner_for_voluntary_rehabilitation_drugs": False,
            },
            "affidavit_of_indigency": {
                "affiant_name": None,
                "civil_status_single": False,
                "civil_status_married": False,
                "civil_status_widow_widower": False,
                "spouse_name": None,
                "residing_at": None,
                "monthly_net_salary_income": None,
                "signature_date": None,
                "signature_place": None,
                "subscribed_sworn_date": None,
                "subscribed_sworn_place": None,
                "administering_public_attorney": None,
            },
            "conflict_of_interest_representation": {
                "agree_different_district_office": False,
                "agree_same_pao_department_appeal": False,
                "waives_right_to_complain": False,
                "trusts_assigned_public_attorney": False,
                "party_representative_signature": None,
            },
            "proof_of_indigency": {
                "for_submission": False,
                "submission_deadline": None,
                "income_tax_return": False,
                "income_tax_return_date": None,
                "barangay_certification": False,
                "barangay_certification_date": None,
                "dswd_certification": False,
                "dswd_certification_date": None,
                "others": False,
                "others_text": None,
                "party_representative_signature": None,
            },
            "applicant_case_involvement": {
                "plaintiff": False,
                "defendant": False,
                "oppositor": False,
                "petitioner": False,
                "respondent": False,
                "complainant": False,
                "accused": False,
                "others": False,
                "others_text": None,
            },
            "adverse_party": {
                "plaintiff_complainant": False,
                "oppositor_others": False,
                "defendant_respondent_accused": False,
                "name": None,
                "address": None,
            },
            "case_details": {
                "facts_of_the_case": None,
                "cause_of_action_nature_of_offense": None,
                "pending_in_court": False,
                "title_of_case_and_docket_no": None,
                "court_body_tribunal_where_pending": None,
            },
        }

    def _sectioned_from_flat(self, flat: dict) -> dict:
        sectioned = self._get_sectioned_schema()
        sectioned["header"].update({
            "region": flat.get("rehiyon"),
            "district_office": flat.get("district_office"),
            "date": flat.get("petsa"),
            "control_no": flat.get("control_no"),
            "assigned_to": flat.get("assigned_to"),
            "interviewer": flat.get("mananayam"),
            "referred_by_indorsed_by": flat.get("referred_by"),
            "action_approved_by": flat.get("approved_by"),
        })
        sectioned["nature_of_request"].update({
            "legal_documentation": bool(flat.get("req_legal_doc")),
            "administration_of_oath": bool(flat.get("req_oath")),
            "representation_in_court_or_quasi_judicial_bodies": bool(flat.get("req_court_rep")),
            "inquest_legal_assistance": bool(flat.get("req_inquest")),
            "mediation_conciliation": bool(flat.get("req_mediation")),
            "others": bool(flat.get("req_other_text")),
            "others_text": flat.get("req_other_text"),
        })
        sectioned["applicant_personal_circumstances"].update({
            "name": flat.get("applicant_name"),
            "age": flat.get("applicant_age"),
            "sex": flat.get("applicant_sex"),
            "civil_status": flat.get("applicant_civil_status"),
            "religion": flat.get("applicant_religion"),
            "educational_attainment": flat.get("applicant_educational_attainment"),
            "citizenship": flat.get("applicant_citizenship"),
            "language_dialect": flat.get("applicant_language_dialect"),
            "address": flat.get("applicant_address"),
            "contact_no": flat.get("applicant_contact"),
            "email": flat.get("applicant_email"),
            "spouse": flat.get("spouse_name"),
            "individual_monthly_income": flat.get("individual_monthly_income"),
            "address_of_spouse": flat.get("spouse_address"),
            "contact_no_of_spouse": flat.get("spouse_contact"),
            "detained": bool(flat.get("is_detained")),
            "detained_since": flat.get("detained_since"),
            "place_of_detention": flat.get("place_of_detention"),
        })
        sectioned["representative_personal_circumstances"].update({
            "name": flat.get("rep_name"),
            "age": flat.get("rep_age"),
            "sex": flat.get("rep_sex"),
            "civil_status": flat.get("rep_civil_status"),
            "address": flat.get("rep_address"),
            "contact_no": flat.get("rep_contact"),
            "relationship_to_applicant": flat.get("rep_relation"),
            "email": flat.get("rep_email"),
        })
        sectioned["nature_of_case"].update({
            "criminal": bool(flat.get("case_type_criminal")),
            "civil": bool(flat.get("case_type_civil")),
            "labor": bool(flat.get("case_type_labor")),
            "administrative": bool(flat.get("case_type_admin")),
            "appealed": bool(flat.get("case_type_appealed")),
        })
        sectioned["applicant_classification"].update({
            "foreign_national": bool(flat.get("sector_foreign_national")),
            "urban_poor": bool(flat.get("sector_urban_poor")),
            "rural_poor": bool(flat.get("sector_rural_poor")),
            "indigenous_people": bool(flat.get("sector_indigenous")),
            "pwd": bool(flat.get("sector_pwd")),
        })
        sectioned["affidavit_of_indigency"].update({
            "affiant_name": flat.get("affidavit_name"),
            "monthly_net_salary_income": flat.get("affidavit_income"),
            "signature_date": flat.get("affidavit_date"),
            "signature_place": flat.get("affidavit_location"),
            "administering_public_attorney": flat.get("administering_attorney"),
        })
        sectioned["conflict_of_interest_representation"].update({
            "agree_different_district_office": bool(flat.get("consent_other_district")),
            "agree_same_pao_department_appeal": bool(flat.get("consent_appeals_unit")),
            "waives_right_to_complain": bool(flat.get("understood_no_complaint")),
            "trusts_assigned_public_attorney": bool(flat.get("trusts_pao_fairness")),
        })
        sectioned["proof_of_indigency"].update({
            "for_submission": bool(flat.get("has_proof_submit_later")),
            "submission_deadline": flat.get("proof_submit_date"),
            "income_tax_return": bool(flat.get("has_proof_itr")),
            "income_tax_return_date": flat.get("proof_itr_date"),
            "barangay_certification": bool(flat.get("has_proof_brgy")),
            "barangay_certification_date": flat.get("proof_brgy_date"),
            "dswd_certification": bool(flat.get("has_proof_dswd")),
            "dswd_certification_date": flat.get("proof_dswd_date"),
            "others": bool(flat.get("has_proof_other")),
            "others_text": flat.get("proof_other_text"),
        })
        role = (flat.get("applicant_role") or "").strip().lower()
        if role in {"plaintiff", "defendant", "oppositor", "petitioner", "respondent", "complainant", "accused"}:
            sectioned["applicant_case_involvement"][role] = True
        sectioned["adverse_party"].update({
            "name": flat.get("adversary_name"),
            "address": flat.get("adversary_address"),
        })
        adverse_role = (flat.get("adversary_role") or "").strip().lower()
        if "plaintiff" in adverse_role or "complainant" in adverse_role:
            sectioned["adverse_party"]["plaintiff_complainant"] = True
        if "oppositor" in adverse_role:
            sectioned["adverse_party"]["oppositor_others"] = True
        if "defendant" in adverse_role or "respondent" in adverse_role or "accused" in adverse_role:
            sectioned["adverse_party"]["defendant_respondent_accused"] = True
        sectioned["case_details"].update({
            "facts_of_the_case": flat.get("case_information"),
            "cause_of_action_nature_of_offense": flat.get("cause_of_action"),
            "pending_in_court": bool(flat.get("is_filed_in_court")),
            "title_of_case_and_docket_no": flat.get("case_docket_title"),
            "court_body_tribunal_where_pending": flat.get("court_body"),
        })
        return sectioned

    def _flat_from_sectioned(self, sectioned: dict) -> dict:
        flat = self._get_empty_schema()
        header = sectioned.get("header", {})
        request = sectioned.get("nature_of_request", {})
        applicant = sectioned.get("applicant_personal_circumstances", {})
        representative = sectioned.get("representative_personal_circumstances", {})
        nature = sectioned.get("nature_of_case", {})
        classification = sectioned.get("applicant_classification", {})
        affidavit = sectioned.get("affidavit_of_indigency", {})
        conflict = sectioned.get("conflict_of_interest_representation", {})
        proof = sectioned.get("proof_of_indigency", {})
        involvement = sectioned.get("applicant_case_involvement", {})
        adverse = sectioned.get("adverse_party", {})
        case_details = sectioned.get("case_details", {})

        flat.update({
            "rehiyon": header.get("region"),
            "district_office": header.get("district_office"),
            "petsa": header.get("date"),
            "control_no": header.get("control_no"),
            "assigned_to": header.get("assigned_to"),
            "mananayam": header.get("interviewer"),
            "referred_by": header.get("referred_by_indorsed_by"),
            "approved_by": header.get("action_approved_by"),
            "req_legal_doc": bool(request.get("legal_documentation")),
            "req_oath": bool(request.get("administration_of_oath")),
            "req_court_rep": bool(request.get("representation_in_court_or_quasi_judicial_bodies")),
            "req_inquest": bool(request.get("inquest_legal_assistance")),
            "req_mediation": bool(request.get("mediation_conciliation")),
            "req_other_text": request.get("others_text"),
            "applicant_name": applicant.get("name"),
            "applicant_age": applicant.get("age"),
            "applicant_sex": applicant.get("sex"),
            "applicant_civil_status": applicant.get("civil_status"),
            "applicant_religion": applicant.get("religion"),
            "applicant_educational_attainment": applicant.get("educational_attainment"),
            "applicant_citizenship": applicant.get("citizenship"),
            "applicant_language_dialect": applicant.get("language_dialect"),
            "applicant_address": applicant.get("address"),
            "applicant_contact": applicant.get("contact_no"),
            "applicant_email": applicant.get("email"),
            "spouse_name": applicant.get("spouse"),
            "individual_monthly_income": applicant.get("individual_monthly_income"),
            "spouse_address": applicant.get("address_of_spouse"),
            "spouse_contact": applicant.get("contact_no_of_spouse"),
            "is_detained": bool(applicant.get("detained")),
            "detained_since": applicant.get("detained_since"),
            "place_of_detention": applicant.get("place_of_detention"),
            "rep_name": representative.get("name"),
            "rep_age": representative.get("age"),
            "rep_sex": representative.get("sex"),
            "rep_civil_status": representative.get("civil_status"),
            "rep_address": representative.get("address"),
            "rep_contact": representative.get("contact_no"),
            "rep_relation": representative.get("relationship_to_applicant"),
            "rep_email": representative.get("email"),
            "case_type_criminal": bool(nature.get("criminal")),
            "case_type_civil": bool(nature.get("civil")),
            "case_type_labor": bool(nature.get("labor")),
            "case_type_admin": bool(nature.get("administrative")),
            "case_type_appealed": bool(nature.get("appealed")),
            "sector_foreign_national": bool(classification.get("foreign_national")),
            "sector_urban_poor": bool(classification.get("urban_poor")),
            "sector_rural_poor": bool(classification.get("rural_poor")),
            "sector_indigenous": bool(classification.get("indigenous_people")),
            "sector_pwd": bool(classification.get("pwd")),
            "affidavit_name": affidavit.get("affiant_name"),
            "affidavit_income": affidavit.get("monthly_net_salary_income"),
            "affidavit_date": affidavit.get("signature_date"),
            "affidavit_location": affidavit.get("signature_place"),
            "administering_attorney": affidavit.get("administering_public_attorney"),
            "consent_other_district": bool(conflict.get("agree_different_district_office")),
            "consent_appeals_unit": bool(conflict.get("agree_same_pao_department_appeal")),
            "understood_no_complaint": bool(conflict.get("waives_right_to_complain")),
            "trusts_pao_fairness": bool(conflict.get("trusts_assigned_public_attorney")),
            "has_proof_submit_later": bool(proof.get("for_submission")),
            "proof_submit_date": proof.get("submission_deadline"),
            "has_proof_itr": bool(proof.get("income_tax_return")),
            "proof_itr_date": proof.get("income_tax_return_date"),
            "has_proof_brgy": bool(proof.get("barangay_certification")),
            "proof_brgy_date": proof.get("barangay_certification_date"),
            "has_proof_dswd": bool(proof.get("dswd_certification")),
            "proof_dswd_date": proof.get("dswd_certification_date"),
            "has_proof_other": bool(proof.get("others")),
            "proof_other_text": proof.get("others_text"),
            "adversary_name": adverse.get("name"),
            "adversary_address": adverse.get("address"),
            "case_information": case_details.get("facts_of_the_case"),
            "cause_of_action": case_details.get("cause_of_action_nature_of_offense"),
            "is_filed_in_court": bool(case_details.get("pending_in_court")),
            "case_docket_title": case_details.get("title_of_case_and_docket_no"),
            "court_body": case_details.get("court_body_tribunal_where_pending"),
        })
        selected_roles = [
            role for role in ["plaintiff", "defendant", "oppositor", "petitioner", "respondent", "complainant", "accused"]
            if involvement.get(role)
        ]
        flat["applicant_role"] = selected_roles[0].title() if selected_roles else None
        if adverse.get("plaintiff_complainant"):
            flat["adversary_role"] = "Plaintiff/Complainant"
        elif adverse.get("oppositor_others"):
            flat["adversary_role"] = "Oppositor/Iba pa"
        elif adverse.get("defendant_respondent_accused"):
            flat["adversary_role"] = "Defendant/Respondent/Accused"
        return flat

    def _run_online_pipeline(self, base64_image: str) -> dict:
        """Primary Mode: Mistral Vision AI (Cloud)"""
        if not self.mistral_api_key:
            raise RuntimeError("MISTRAL_API_KEY is not configured")

        print("[System] Network Healthy. Routing to Cloud Pipeline (Mistral)...")
        system_prompt = f"""
    You are JurisGuard's legal-document vision extraction engine for Philippine Public Attorney's Office
    interview sheets. Your behavior must be STRICTLY LITERAL, EVIDENCE-ONLY, and NON-INFERENTIAL.

        TASK:
        Extract only visible user-entered marks/text from the image. Return one minified JSON object matching
        this standardized English section-based schema exactly:
        {json.dumps(self._get_sectioned_schema())}

        LEGAL EVIDENCE STANDARD:
        - This is legal document extraction, not form interpretation.
        - Do not reason about what the user probably meant.
        - Do not complete missing fields.
        - Do not correct user mistakes.
        - Do not infer facts from related fields.
        - Do not use surrounding fields to fill a blank field.
        - Do not copy a value from one labeled line into a different labeled line.
        - Do not infer a checkbox state from nearby handwriting, typed text, labels, or context.
        - If visual evidence is absent, ambiguous, cropped, hidden, blank, or uncertain, output null for strings
        and false for booleans.

        STRICT CHECKBOX RULES:
        - A checkbox field may be true ONLY if there is a distinct physical mark inside the specific box,
        touching the specific box, or directly drawn over that specific box.
        - Valid checkbox marks include visible ink checkmarks, X marks, filled boxes, dots, scribbles, or other
        unmistakable marks physically located in/on the target box.
        - If the box is empty, output false.
        - If text is written on a related line but the checkbox is empty, output false.
        - If "Lugar ng Detention" has text but "Nakakulong: Oo" is unmarked, output "is_detained": false.
        - If only the printed words "Oo", "Hindi", "Criminal", "Civil", "PWD", etc. are visible, output false.
        - Never choose a checkbox based on semantic consistency, surrounding text, field labels, or common sense.
        - For paired choices such as Oo/Hindi, return true only for the option whose own box is visibly marked.

        FIGURE/GROUND SEPARATION:
        - Printed form template text is background, not data.
        - Extract handwriting, typed overlays, stamps, or marks only when they are visibly user-entered.
        - Blank underlines, empty boxes, and unfilled spaces must remain null or false.

        FIELD EXTRACTION RULES:
        - Extract exactly what the client wrote, preserving spelling, capitalization, abbreviations, and apparent errors.
        - Do not translate, summarize, normalize, repair, or autocorrect handwritten values.
        - If a field area contains no visible user-entered text, output null.
        - If multiple possible values exist and the correct one is unclear, output null.
        - For each text field, first locate its printed label, then read only the answer area/underline/box belonging
          to that label. Stop at the next printed label, column boundary, or section divider.
        - Treat left-column and right-column fields as separate zones even when they share the same horizontal row.
        - For dense two-column rows, never read across the page from one label into another label's answer area.
        - If the answer line beside a label is visually blank, output null even if another line nearby has handwriting.
        - If a candidate value appears closer to another label than to the target label, do not use it for the target field.
        - Educational attainment must come only from the "Naabot na pag-aaral" / "Educational Attainment" answer line.
          Never copy religion, citizenship, name, or any neighboring value into educational attainment.
        - Address fields must contain visible handwriting in the address answer line. Do not invent an address from faint
          background bleed-through, printed text, noise, or unrelated representative/case sections.
        - Single unclear OCR-like tokens without address evidence must be null for address fields.
        - Email must contain a visible @ and domain dot; otherwise null.
        - Age must be a visible 1-3 digit number in the age answer area; otherwise null.
        - Sex must be a visible value or mark in the sex answer area only; otherwise null.

        FILIPINO/ENGLISH LABEL MAPPING:
        - "Petsa" -> "petsa"; "Control No." -> "control_no"; "Rehiyon" -> "rehiyon";
          "District Office" -> "district_office"; "Mananayam" -> "mananayam".
        - "Pangalan" / "Name" in applicant section -> "applicant_name".
        - "Relihiyon" / "Religion" -> "applicant_religion".
        - "Naabot na pag-aaral" / "Educational Attainment" -> "applicant_educational_attainment".
        - "Pagkamamamayan" / "Citizenship" -> "applicant_citizenship".
        - "Salita/Dialekto" / "Language/Dialect" -> "applicant_language_dialect".
        - "Tirahan" / "Address" in applicant section -> "applicant_address".
        - "Asawa" / "Spouse" -> "spouse_name".
        - "Tirahan ng asawa" / "Address of Spouse" -> "spouse_address".
        - "Contact No. ng asawa" / "Contact No. of Spouse" -> "spouse_contact".
        - "Petsa ng pagakakulong" / "Detained Since" -> "detained_since".
        - "Lugar ng Detention" / "Place of Detention" -> "place_of_detention".

        OUTPUT RULES:
        - Output only valid minified JSON.
        - Use exactly the section names, field keys, and JSON types shown above.
        - Keep Filipino source labels normalized to the English JSON keys.
        - Do not include markdown, explanations, confidence scores, or extra keys.
        """
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.mistral_api_key}"
        }
        payload = {
            "model": self.mistral_model,
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": system_prompt},
                    {"type": "image_url", "image_url": f"data:image/jpeg;base64,{base64_image}"}
                ]}
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"}
        }

        response = requests.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=(self.mistral_connect_timeout, self.mistral_read_timeout),
        )
        response.raise_for_status()
        
        clean_json_text = response.json()['choices'][0]['message']['content'].strip().replace("```json", "").replace("```", "").strip()
        extracted_data = json.loads(clean_json_text)
        if isinstance(extracted_data, dict) and "header" in extracted_data:
            sectioned_data = extracted_data
            extracted_data = self._flat_from_sectioned(sectioned_data)
            extracted_data = apply_quality_filters(remove_printed_template_leaks(extracted_data))
            extracted_data["sections"] = self._sectioned_from_flat(extracted_data)
        else:
            extracted_data = apply_quality_filters(remove_printed_template_leaks(extracted_data))
            extracted_data["sections"] = self._sectioned_from_flat(extracted_data)
        extracted_data["extraction_mode"] = "ONLINE_MISTRAL"
        extracted_data["raw_text"] = "Processed via Mistral Cloud Vision"
        return extracted_data

    def _run_offline_pipeline(self, image_path: str) -> dict:
        """Failover Mode: PaddleOCR + spaCy NLP extraction."""
        pipeline_started = time.perf_counter()
        print("[System] Routing to Air-Gapped Hybrid Pipeline...")
        
        # 1. Load and preprocess image
        print("[Offline Engine] Loading image...")
        from PIL import Image, ImageOps
        
        # Step A: Respect smartphone rotation
        load_started = time.perf_counter()
        pil_img = Image.open(image_path)
        pil_img = ImageOps.exif_transpose(pil_img) 
        img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR) 
        img = crop_document_region(img)
        print(f"[Timing] Image load: {time.perf_counter() - load_started:.2f}s")
        
        # Step B: Smart Downscaling (balance quality vs speed)
        h, w = img.shape[:2]
        if max(h, w) > self.ocr_max_dimension:
            resize_started = time.perf_counter()
            scale = self.ocr_max_dimension / max(h, w)
            print(f"[Offline Engine] Downscaling {w}x{h} → {int(w*scale)}x{int(h*scale)}...")
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            print(f"[Timing] Resize: {time.perf_counter() - resize_started:.2f}s")
        
        # Step C: Apply OCR preprocessing
        preprocess_started = time.perf_counter()
        if self.ocr_use_enhanced_preprocess:
            print("[Offline Engine] Applying enhanced handwriting preprocessing...")
            ocr_img = enhance_handwriting_image(img)
        else:
            print("[Offline Engine] Applying fast OCR preprocessing...")
            ocr_img = fast_prepare_ocr_image(img)
        print(f"[Timing] Preprocess: {time.perf_counter() - preprocess_started:.2f}s")
        
        # Step D: Feed enhanced image to PaddleOCR
        ocr_started = time.perf_counter()
        print(
            "[Offline Engine] Running PaddleOCR "
            f"(device={self.ocr_device}, angle_cls={self.ocr_enable_angle_cls}, "
            f"det_limit={self.ocr_det_limit_side_len})..."
        )
        try:
            ocr_results = self._run_paddleocr(ocr_img)
        except Exception as exc:
            fallback_data = self._get_empty_schema()
            fallback_data["extraction_mode"] = "OFFLINE_OCR_FAILED"
            fallback_data["raw_text"] = f"PaddleOCR failed: {exc}"
            print(f"[Timing] PaddleOCR failed after: {time.perf_counter() - ocr_started:.2f}s")
            print(f"[Timing] Offline pipeline total: {time.perf_counter() - pipeline_started:.2f}s")
            return fallback_data
        print(f"[Timing] PaddleOCR: {time.perf_counter() - ocr_started:.2f}s")
        
        # Step E: Group OCR results into logical lines
        grouping_started = time.perf_counter()
        print("[Offline Engine] Grouping OCR output into coherent lines...")
        raw_text = group_ocr_lines(ocr_results)
        print(f"[Timing] Grouping: {time.perf_counter() - grouping_started:.2f}s")
        
        if not raw_text:
            print("[Warning] OCR extracted no text. Returning fallback payload.")
            fallback_data = self._get_empty_schema()
            fallback_data["extraction_mode"] = "OFFLINE_OCR_ONLY"
            fallback_data["raw_text"] = ""
            return fallback_data
            
        print(f"[Offline Engine] OCR finished. Extracted {len(raw_text)} characters in {len(raw_text.split(chr(10)))} lines.")

        nlp_started = time.perf_counter()
        extracted_data = spacy_extract_pao_fields(raw_text, self._get_empty_schema())
        print(f"[Timing] spaCy NLP parse: {time.perf_counter() - nlp_started:.2f}s")
        print(f"[Timing] Offline pipeline total: {time.perf_counter() - pipeline_started:.2f}s")
        return extracted_data

    def _cloud_failure_payload(self, exc: Exception) -> dict:
        fallback_data = self._get_empty_schema()
        if isinstance(exc, requests_exceptions.Timeout):
            fallback_data["extraction_mode"] = "ONLINE_MISTRAL_TIMEOUT"
            fallback_data["raw_text"] = (
                "Mistral Cloud Vision timed out. "
                f"Increase MISTRAL_READ_TIMEOUT_SECONDS if the image is large or the connection is slow. Details: {exc}"
            )
        else:
            fallback_data["extraction_mode"] = "ONLINE_MISTRAL_FAILED"
            fallback_data["raw_text"] = f"Mistral Cloud Vision failed: {exc}"
        return fallback_data

    def _run_cloud_then_offline_fallback(self, file_path: str, compressed_file_path: str) -> dict:
        try:
            base64_image = encode_image_to_base64(compressed_file_path)
            return self._run_online_pipeline(base64_image)
        except Exception as exc:
            print(f"[Warning] Cloud extraction failed ({exc}). Executing local failover...")
            try:
                offline_data = self._run_offline_pipeline(file_path)
                offline_data["extraction_mode"] = "CLOUD_FAILED_OFFLINE_FALLBACK"
                offline_raw_text = offline_data.get("raw_text") or ""
                offline_data["raw_text"] = f"Cloud failure: {exc}\n\nOffline OCR raw text:\n{offline_raw_text}"
                return offline_data
            except Exception as offline_exc:
                print(f"[Error] Offline fallback also failed ({offline_exc}).")
                fallback_data = self._cloud_failure_payload(exc)
                fallback_data["fallback_reason"] = f"Offline fallback failed: {offline_exc}"
                return fallback_data

    def execute_extraction(self, file_path: str, extraction_mode: str = "auto") -> dict:
        final_data = self._get_empty_schema()
        mode = (extraction_mode or "auto").strip().lower()

        if mode == "offline":
            final_data.update(self._run_offline_pipeline(file_path))
        elif mode == "cloud":
            compressed_file_path = compress_image_for_vlm(file_path)
            try:
                final_data.update(self._run_cloud_then_offline_fallback(file_path, compressed_file_path))
            finally:
                if compressed_file_path != file_path and os.path.exists(compressed_file_path):
                    os.remove(compressed_file_path)
        elif self._check_network_heartbeat():
            compressed_file_path = compress_image_for_vlm(file_path)
            try:
                final_data.update(self._run_cloud_then_offline_fallback(file_path, compressed_file_path))
            finally:
                if compressed_file_path != file_path and os.path.exists(compressed_file_path):
                    os.remove(compressed_file_path)
        else:
            final_data.update(self._run_offline_pipeline(file_path))

        final_data["sections"] = self._sectioned_from_flat(final_data)
        return final_data

# ==========================================
# 3. FASTAPI COMPATIBILITY WRAPPER
# ==========================================
_engine_instance = None

def process_document(file_path: str, extraction_mode: str = "auto", include_benchmarks: bool = False):
    import time
    start_time = time.perf_counter()
    
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Image not found at {file_path}")

    global _engine_instance
    if _engine_instance is None:
        _engine_instance = JurisGuardExtractionEngine()

    result = _engine_instance.execute_extraction(file_path=file_path, extraction_mode=extraction_mode)
    
    if include_benchmarks:
        latency = time.perf_counter() - start_time
        result["_benchmarks"] = {
            "processing_latency_seconds": latency
        }
        
    return result
