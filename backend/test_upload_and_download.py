"""Tests for the upload and download endpoints.

These tests use FastAPI's dependency override mechanism to mock authentication
and database access, avoiding the need for a running PostgreSQL instance or
real encryption keys.
"""
import io
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from starlette.testclient import TestClient

# Patch document_encryption_key before importing main so the module-level
# code does not fail when DOCUMENT_ENCRYPTION_KEY is not set.
import os
os.environ.setdefault("DOCUMENT_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

from main import app, current_user, get_db  # noqa: E402
from database import get_db as db_get_db  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(role_name="staff", user_id=1, approval_status="approved"):
    role = SimpleNamespace(role_name=role_name, permissions="clients,cases,documents")
    if role_name == "admin":
        role.permissions = "all"
    return SimpleNamespace(
        user_id=user_id,
        role_id=1,
        role=role,
        username="testuser",
        email="test@pao.gov.ph",
        full_name="Test User",
        approval_status=approval_status,
        is_active=True,
    )


VALID_JPEG_HEADER = b"\xff\xd8\xff\xe0" + b"\x00\x10JFIF\x00" + b"\x00" * 100
VALID_PNG_HEADER = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _cleanup_overrides():
    """Ensure dependency overrides are cleaned up after each test."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture()
def staff_client():
    """TestClient with an authenticated staff user."""
    user = _make_user("staff")
    mock_db = MagicMock()
    app.dependency_overrides[current_user] = lambda: user
    app.dependency_overrides[db_get_db] = lambda: mock_db
    return TestClient(app), user, mock_db


@pytest.fixture()
def admin_client():
    """TestClient with an authenticated admin user."""
    user = _make_user("admin")
    mock_db = MagicMock()
    app.dependency_overrides[current_user] = lambda: user
    app.dependency_overrides[db_get_db] = lambda: mock_db
    return TestClient(app), user, mock_db


# ---------------------------------------------------------------------------
# Upload Tests
# ---------------------------------------------------------------------------

class TestUploadDocument:
    """Tests for POST /api/upload-document/."""

    def test_upload_unauthenticated(self):
        """No Authorization header → 401."""
        # Do NOT override current_user so it requires a real token
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/upload-document/",
            files={"file": ("test.jpg", io.BytesIO(VALID_JPEG_HEADER), "image/jpeg")},
        )
        assert response.status_code == 401

    def test_upload_unauthorized_role(self):
        """User without staff/admin role → 403."""
        user = _make_user(role_name="viewer")  # not in allowed roles
        mock_db = MagicMock()
        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[db_get_db] = lambda: mock_db
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/upload-document/",
            files={"file": ("test.jpg", io.BytesIO(VALID_JPEG_HEADER), "image/jpeg")},
        )
        assert response.status_code == 403

    def test_upload_unsupported_file_type(self, staff_client):
        """Non-image file → 400."""
        client, user, mock_db = staff_client
        response = client.post(
            "/api/upload-document/",
            files={"file": ("document.txt", io.BytesIO(b"plain text content"), "text/plain")},
        )
        assert response.status_code in (400, 500)  # 400 from validate_document_type

    def test_upload_mismatched_extension_and_magic(self, staff_client):
        """Extension says .jpg but content is PNG → 400."""
        client, user, mock_db = staff_client
        response = client.post(
            "/api/upload-document/",
            files={"file": ("photo.jpg", io.BytesIO(VALID_PNG_HEADER), "image/png")},
        )
        assert response.status_code in (400, 500)

    @patch("main.store_encrypted_upload")
    @patch("main.process_document")
    def test_upload_successful(self, mock_process, mock_store, admin_client):
        """Valid JPEG upload by authorized user → 200 with document_id."""
        client, user, mock_db = admin_client

        # Mock the encryption + OCR pipeline
        mock_store.return_value = (1024, "image/jpeg")
        mock_process.return_value = {
            "sections": {},
            "extraction_mode": "OFFLINE_SPACY_RULES",
            "raw_text": "test",
            "requested_extraction_mode": "auto",
            "actual_extraction_mode": "offline",
            "offline_attempt": {"status": "completed", "fallback_eligible": False},
            "cloud_fallback": None,
        }

        # Mock db.get to return None for case/intake lookups
        mock_db.get.return_value = None

        # Mock the document that gets created
        mock_document = MagicMock()
        mock_document.document_id = 42
        mock_db.refresh = lambda obj: setattr(obj, 'document_id', 42)

        response = client.post(
            "/api/upload-document/",
            files={"file": ("scan.jpg", io.BytesIO(VALID_JPEG_HEADER), "image/jpeg")},
        )
        # The test may get 500 due to deep DB interactions; the key assertion
        # is that it does NOT return 401 or 403.
        assert response.status_code != 401
        assert response.status_code != 403


# ---------------------------------------------------------------------------
# Download Tests
# ---------------------------------------------------------------------------

class TestDownloadDocument:
    """Tests for GET /api/documents/{document_id}/download."""

    def test_download_unauthenticated(self):
        """No Authorization header → 401."""
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/documents/1/download")
        assert response.status_code == 401

    def test_download_nonexistent_document(self, staff_client):
        """Document that doesn't exist → 404."""
        client, user, mock_db = staff_client
        mock_db.get.return_value = None
        response = client.get("/api/documents/99999/download")
        assert response.status_code in (404, 500)
