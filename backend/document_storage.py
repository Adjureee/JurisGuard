"""Authenticated encryption for archived uploads, with legacy file reads."""
import base64
import binascii
import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def document_cipher() -> AESGCM | None:
    encoded_key = os.getenv("DOCUMENT_ENCRYPTION_KEY", "").strip()
    if not encoded_key:
        return None
    try:
        key = base64.b64decode(encoded_key, altchars=b"-_", validate=True)
        if len(key) != 32:
            raise ValueError("Expected a 32-byte key")
    except (ValueError, binascii.Error) as exc:
        raise RuntimeError("DOCUMENT_ENCRYPTION_KEY must encode 32 random bytes") from exc
    return AESGCM(key)


def encrypt_document(source: Path, destination: Path, cipher: AESGCM) -> None:
    nonce = os.urandom(12)
    ciphertext = cipher.encrypt(nonce, source.read_bytes(), destination.name.encode())
    with destination.open("xb") as archive:
        archive.write(nonce + ciphertext)


def read_document(path: Path) -> bytes:
    content = path.read_bytes()
    if path.suffix != ".enc":
        return content
    cipher = document_cipher()
    if cipher is None:
        raise RuntimeError("The document encryption key is unavailable")
    return cipher.decrypt(content[:12], content[12:], path.name.encode())
