import os
import socket
import json
import requests
import base64
import tempfile
import time
import traceback
import re
from pathlib import Path
from requests import exceptions as requests_exceptions
import cv2
import numpy as np
from PIL import Image
from paddleocr import PaddleOCR
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
    r"\be[-\s]?mail\b|\brelasyon\b|\buri\s+ng\s+kaso\b|\bsektor\b|\bproof\s+of\s+indigency\b|"
    r"\bkinalaman\b|\bkatunggali\b|\bimpormasyon\s+sa\s+kaso\b|\bcause\s+of\s+action\b|"
    r"\bpamagat\b|\bcourt\b"
)

STRING_FIELD_PATTERNS = {
    "assigned_to": r"\bini[-\s]?atas\s+kay\b",
    "referred_by": r"\bini[-\s]?refer\s+ni\s*/?\s*inindorso\s+ng\b|\bini[-\s]?refer\s+ni\b|\binindorso\s+ng\b",
    "approved_by": r"\baprobado\s+ang\s+aksyon\s+ni\b",
    "action_legal_service_text": r"\bibinigay\s+na\s+serbisyong[-\s]?legal\b",
    "action_other_text": r"\biba\s+pa\b",
    "rep_name": r"\bii[-\s]?a\b.*\bpangalan\b|\brepresentative\b.*\bpangalan\b",
    "rep_address": r"\btirahan\b",
    "rep_contact": r"\bcontact\s*no\b",
    "rep_relation": r"\brelasyon\s+sa\s+aplikante\b",
    "rep_email": r"\be[-\s]?mail\b",
    "adversary_name": r"\bkatunggali\s+sa\s+kaso\b.*\bpangalan\b|\bpangalan\b",
    "adversary_address": r"\bkatunggali\s+sa\s+kaso\b.*\btirahan\b|\btirahan\b",
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
    extracted = remove_printed_template_leaks(extracted)
    return extracted

def extract_value_by_label(lines: list[str], label_pattern: str) -> str | None:
    value = line_after_label(lines, label_pattern, stop_pattern=COMMON_STOP_LABELS)
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
    r"\bsignature\s+of\s+affiant\b",
    r"\bparty/representative\b",
]

def remove_printed_template_leaks(extracted_data: dict) -> dict:
    cleaned = dict(extracted_data)
    for field_name, value in list(cleaned.items()):
        if not isinstance(value, str):
            continue
        normalized = clean_ocr_value(value).lower()
        normalized = re.sub(r"\s+", " ", normalized)
        if normalized in PRINTED_TEMPLATE_VALUES or any(
            re.search(pattern, normalized, re.IGNORECASE) for pattern in PRINTED_TEMPLATE_PATTERNS
        ):
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
        if has_visible_option(compact, pattern):
            extracted[field_name] = "VISIBLE"

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

    return remove_printed_template_leaks(extracted)

# ==========================================
# 1. IMAGE PRE-PROCESSING HELPERS
# ==========================================
def compress_image_for_vlm(original_path: str, max_size_mb: int = 2):
    """Only used for the Cloud Mistral API to save bandwidth."""
    file_size_mb = os.path.getsize(original_path) / (1024 * 1024)
    max_dimension = 1600 
    
    with Image.open(original_path) as img:
        if max(img.size) > max_dimension or file_size_mb > max_size_mb:
            if img.mode in ("RGBA", "P"): img = img.convert("RGB")
            try: resample_filter = Image.Resampling.LANCZOS
            except AttributeError: resample_filter = Image.LANCZOS 
            
            img.thumbnail((max_dimension, max_dimension), resample_filter)
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp_file:
                temp_path = temp_file.name
            img.save(temp_path, "JPEG", optimize=True, quality=85)
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
        self.ocr_max_dimension = get_int_env("PADDLEOCR_MAX_DIMENSION", 1600)
        self.ocr_det_limit_side_len = get_int_env("PADDLEOCR_DET_LIMIT_SIDE_LEN", 960)
        self.ocr_det_model_name = os.getenv("PADDLEOCR_DET_MODEL_NAME", "PP-OCRv4_mobile_det")
        self.ocr_rec_model_name = os.getenv("PADDLEOCR_REC_MODEL_NAME", "en_PP-OCRv4_mobile_rec")
        self.ocr_enable_angle_cls = get_bool_env("PADDLEOCR_ENABLE_ANGLE_CLS", False)
        self.ocr_use_enhanced_preprocess = get_bool_env("PADDLEOCR_ENHANCED_PREPROCESS", False)
        self.ocr_cpu_threads = get_int_env("PADDLEOCR_CPU_THREADS", max(2, (os.cpu_count() or 4) - 1))
        self.ocr_enable_mkldnn = get_bool_env("PADDLEOCR_ENABLE_MKLDNN", False)
        self.ocr_use_gpu = get_bool_env("PADDLEOCR_USE_GPU", False)
        self.ocr_device = "gpu" if self.ocr_use_gpu else "cpu"
        
        print("[JurisGuard] Booting up Offline Eyes (PaddleOCR)...")
        import logging
        logging.getLogger('ppocr').setLevel(logging.ERROR)
        self.local_ocr = self._create_ocr_engine(
            enable_mkldnn=self.ocr_enable_mkldnn,
            engine="paddle_static",
        )
        self.safe_ocr = None
        print(
            "[JurisGuard] PaddleOCR config: "
            f"det={self.ocr_det_model_name}, rec={self.ocr_rec_model_name}, "
            f"mkldnn={self.ocr_enable_mkldnn}, threads={self.ocr_cpu_threads}"
        )

    def _create_ocr_engine(self, enable_mkldnn: bool, engine: str):
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
        try:
            socket.create_connection(("api.mistral.ai", 443), timeout=3.0)
            return True
        except OSError:
            return False

    def _get_empty_schema(self) -> dict:
        return {
            "rehiyon": None, "district_office": None, "control_no": None, "petsa": None, "mananayam": None,
            "referred_by": None, "assigned_to": None, "approved_by": None,
            "action_merit_test": False, "action_representation": False, "action_legal_service_text": None, "action_other_text": None,
            "req_legal_doc": False, "req_oath": False, "req_court_rep": False, "req_inquest": False, "req_mediation": False, "req_other_text": None,
            "applicant_name": None, "applicant_age": None, "applicant_sex": None, "applicant_civil_status": None, "applicant_contact": None, "is_detained": False,
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

    def _run_online_pipeline(self, base64_image: str) -> dict:
        """Primary Mode: Mistral Vision AI (Cloud)"""
        if not self.mistral_api_key:
            raise RuntimeError("MISTRAL_API_KEY is not configured")

        print("[System] Network Healthy. Routing to Cloud Pipeline (Mistral)...")
        system_prompt = f"""
        You are JurisGuard's PAO interview-sheet extraction engine.

        TASK:
        Extract ONLY user-entered information from a photographed/scanned Philippine Public Attorney's Office
        interview sheet. Return one minified JSON object matching this schema exactly:
        {json.dumps(self._get_empty_schema())}

        FIGURE/GROUND SEPARATION POLICY:
        - Treat the printed form template as background, not data.
        - User-entered data is usually handwriting, typed overlay, checked boxes, or text written on blank lines.
        - Printed labels, captions, section titles, helper text, and parenthetical instructions are NOT field values.
        - If a blank line has no handwriting/typed entry on or near it, return null for string fields.
        - If a checkbox is visibly empty, return false. Return true only when the box has a check, X, filled mark,
          or clear handwritten/typed selection mark.
        - Do not infer a value simply because a printed option label is visible.

        PRINTED TEXT THAT MUST NEVER BE USED AS A VALUE:
        - "(Pangalan at Lagda) Public Attorney"
        - "Pangalan at Lagda ng DPA/RPA/OIC"
        - "Signature of Affiant"
        - "Buong Pangalan at Lagda ng Party/Representative"
        - Section headers such as "I. URI NG INIHIHINGI NG TULONG", "II. IMPORMASYON UKOL SA APLIKANTE",
          "AFFIDAVIT OF INDIGENCY", and "PROOF OF INDIGENCY"

        SPATIAL REASONING RULES:
        - For a label followed by an underline, read the handwritten/typed ink on that underline as the value.
        - For "Petsa", "Control No.", "Mananayam", "Ini-atas kay", "Ini-refer ni/Inindorso ng", and
          "APROBADO ang AKSYON ni", use only the ink immediately to the right of or above the corresponding line.
        - For "Rehiyon", return a value only if there is visible handwriting/typed text on the Rehiyon line itself.
          Do not infer "rehiyon" from the prefix of "control_no".
        - If the only visible text near a field is printed helper text, leave the value null.
        - If only part of the page is visible, extract only visible filled fields and leave all non-visible sections null/false.
        - Do not hallucinate missing applicant, representative, affidavit, court, or adversary details.

        FIELD SEMANTICS:
        - Filipino labels map to English JSON keys.
        - "Petsa" -> "petsa"; "Control No." -> "control_no"; "Rehiyon" -> "rehiyon";
          "District Office" -> "district_office"; "Mananayam" -> "mananayam";
          "Ini-refer ni/Inindorso ng" -> "referred_by"; "Ini-atas kay" -> "assigned_to";
          "APROBADO ang AKSYON ni" -> "approved_by".
        - "Pangalan" in applicant section -> "applicant_name"; in representative section -> "rep_name";
          in adversary section -> "adversary_name".
        - "Tirahan" in representative section -> "rep_address"; in adversary section -> "adversary_address".
        - Printed helper text such as "(Pangalan at Lagda) Public Attorney" is never a party, applicant,
          representative, interviewer, approver, or attorney name.
        - Keep unknown strings as null and unknown booleans as false.

        NORMALIZATION RULES:
        - Preserve Filipino names and addresses as written.
        - Normalize obvious OCR confusions only when context is strong: "X1" at the start of a control number may be "XI";
          "20r4" in a date may be "2024".
        - Do not convert uncertain handwriting into a confident value.

        OUTPUT RULES:
        - Output ONLY valid minified JSON.
        - Use exactly the schema keys and JSON types shown above.
        - Do not include markdown, explanations, confidence scores, or extra keys.
        """
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.mistral_api_key}"
        }
        payload = {
            "model": "pixtral-12b-2409",
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": system_prompt},
                    {"type": "image_url", "image_url": f"data:image/jpeg;base64,{base64_image}"}
                ]}
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"}
        }

        response = requests.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload, timeout=20)
        response.raise_for_status()
        
        clean_json_text = response.json()['choices'][0]['message']['content'].strip().replace("```json", "").replace("```", "").strip()
        extracted_data = json.loads(clean_json_text)
        extracted_data = remove_printed_template_leaks(extracted_data)
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

    def execute_extraction(self, file_path: str) -> dict:
        final_data = self._get_empty_schema()

        if self._check_network_heartbeat():
            try:
                compressed_file_path = compress_image_for_vlm(file_path)
                base64_image = encode_image_to_base64(compressed_file_path)
                final_data.update(self._run_online_pipeline(base64_image))
                if compressed_file_path != file_path and os.path.exists(compressed_file_path):
                    os.remove(compressed_file_path)
            except Exception as e:
                print(f"[Warning] Online extraction failed ({e}). Executing local failover...")
                # Pass the HIGH-RES original image to PaddleOCR!
                final_data.update(self._run_offline_pipeline(file_path)) 
        else:
            final_data.update(self._run_offline_pipeline(file_path))

        return final_data

# ==========================================
# 3. FASTAPI COMPATIBILITY WRAPPER
# ==========================================
_engine_instance = None

def process_document(file_path: str):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Image not found at {file_path}")

    global _engine_instance
    if _engine_instance is None:
        _engine_instance = JurisGuardExtractionEngine()

    return _engine_instance.execute_extraction(file_path=file_path)
