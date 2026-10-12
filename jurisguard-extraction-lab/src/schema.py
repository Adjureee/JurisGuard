"""Exact inventory schema and ground-truth validation."""

from __future__ import annotations

from datetime import date

INVENTORY_FIELDS = (
    "Control Number", "Party Represented", "Gender/Sex", "Title of the Case",
    "Court/Body", "Case No.", "Cause of Action", "Status of the Case",
    "Last Action Taken", "Cause of Termination", "Date of Termination",
    "Place of Detention", "Address", "Contact Number", "Date of Confinement",
    "Urban", "Rural", "Drugs", "Female", "SENIOR", "CICL",
)
DATE_FIELDS = frozenset({"Date of Termination", "Date of Confinement"})
CLASSIFICATION_FIELDS = frozenset({"Urban", "Rural", "Drugs", "Female", "SENIOR", "CICL"})
DOCUMENT_TYPES = frozenset({"intake_form", "rtc_decision", "sandiganbayan_document", "unknown", "ambiguous"})


def empty_inventory() -> dict[str, str | bool | None]:
    return dict.fromkeys(INVENTORY_FIELDS)


def validate_inventory(inventory: object) -> None:
    if not isinstance(inventory, dict) or set(inventory) != set(INVENTORY_FIELDS):
        raise ValueError("inventory must contain exactly the 21 PAO fields")
    for field, value in inventory.items():
        if value is None:
            continue
        if field in CLASSIFICATION_FIELDS:
            if type(value) is not bool:
                raise ValueError(f"{field} must be true, false, or null")
        elif type(value) is not str:
            raise ValueError(f"{field} must be a string or null")
        elif field in DATE_FIELDS:
            try:
                if date.fromisoformat(value).isoformat() != value:
                    raise ValueError
            except ValueError as exc:
                raise ValueError(f"{field} must be an ISO YYYY-MM-DD date") from exc
