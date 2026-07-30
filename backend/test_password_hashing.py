"""Tests for the bcrypt-based password hashing with legacy PBKDF2 backward compatibility."""
import hashlib
import hmac
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _legacy_pbkdf2_hash(password: str) -> str:
    """Reproduce the old PBKDF2-SHA256 hash format for backward-compat testing."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def test_hash_password_produces_bcrypt_hash():
    from main import hash_password
    hashed = hash_password("test-password")
    assert hashed.startswith("$2b$12$"), f"Expected bcrypt $2b$12$ prefix, got: {hashed[:10]}"


def test_verify_bcrypt_hash():
    from main import hash_password, verify_password
    hashed = hash_password("correct-horse")
    assert verify_password("correct-horse", hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_verify_legacy_pbkdf2_hash():
    from main import verify_password
    legacy_hash = _legacy_pbkdf2_hash("old-password")
    assert legacy_hash.startswith("pbkdf2_sha256$")
    assert verify_password("old-password", legacy_hash) is True
    assert verify_password("wrong-password", legacy_hash) is False


def test_verify_empty_hash_returns_false():
    from main import verify_password
    assert verify_password("any", "") is False


def test_bcrypt_rounds_are_12():
    from main import hash_password
    hashed = hash_password("rounds-test")
    # bcrypt format: $2b$12$...
    assert "$12$" in hashed, f"Expected 12 rounds in hash, got: {hashed}"
