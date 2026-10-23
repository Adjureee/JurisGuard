"""Tri-state inventory classifications that require explicit staff review."""

from typing import Any, Mapping


REVIEWED_FLAGS = {
    "flag_female": "class_female",
    "flag_senior": "class_senior_citizen",
    "flag_cicl": "class_cicl",
}


def reviewed_flag_input(data: Mapping[str, Any]) -> dict[str, bool | None] | None:
    """Return reviewed values, or None when this request has not reviewed them."""
    reviewed = data.get("flags_reviewed", False)
    if type(reviewed) is not bool:
        raise ValueError("flags_reviewed must be a boolean")
    if not reviewed:
        return None
    values = {name: data.get(name) for name in REVIEWED_FLAGS}
    for name, value in values.items():
        if value is not None and type(value) is not bool:
            raise ValueError(f"{name} must be true, false, or null")
    return values


def stored_reviewed_flags(classification: Any) -> dict[str, bool | None]:
    """Mask legacy values whose source evidence was never recorded."""
    reviewed = classification is not None and classification.flags_reviewed is True
    return {
        name: getattr(classification, column, None) if reviewed else None
        for name, column in REVIEWED_FLAGS.items()
    }
