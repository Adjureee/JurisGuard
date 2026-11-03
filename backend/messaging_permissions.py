from typing import Literal


MessagingDesignation = Literal["Administrator", "Attorney"]


def can_message_designations(sender: str | None, recipient: str | None) -> bool:
    return (
        sender == "Attorney" and recipient in {"Attorney", "Administrator"}
    ) or (
        sender == "Administrator" and recipient == "Attorney"
    )


def normalize_message_content(content: str) -> str:
    normalized = content.strip()
    if not normalized:
        raise ValueError("Message cannot be empty")
    if len(normalized) > 2000:
        raise ValueError("Message cannot exceed 2000 characters")
    return normalized
