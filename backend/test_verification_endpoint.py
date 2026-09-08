"""Tests for the document extraction verification endpoint.

Covers the PENDING → VERIFIED / PENDING → REJECTED state machine, RBAC
enforcement, and conflict detection for already-processed extractions.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import os
os.environ.setdefault("DOCUMENT_ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

from starlette.testclient import TestClient  # noqa: E402

from main import app, current_user  # noqa: E402
from database import get_db  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(role_name="staff", user_id=1):
    role = SimpleNamespace(role_name=role_name, permissions="clients,cases,documents")
    if role_name == "admin":
        role.permissions = "all"
    return SimpleNamespace(
        user_id=user_id,
        role_id=1,
        role=role,
        username="teststaff",
        email="staff@pao.gov.ph",
        full_name="Test Staff",
        approval_status="approved",
        is_active=True,
    )


def _make_document(document_id=1, case_id=None, intake_id=None, uploaded_by=1):
    return SimpleNamespace(
        document_id=document_id,
        case_id=case_id,
        intake_id=intake_id,
        uploaded_by=uploaded_by,
    )


def _make_metadata(meta_id=1, document_id=1, verification_status="PENDING"):
    return SimpleNamespace(
        meta_id=meta_id,
        document_id=document_id,
        extracted_json={"sections": {}, "extraction_mode": "OFFLINE_SPACY_RULES"},
        verification_status=verification_status,
        verified_by=None,
        verified_at=None,
        verification_notes=None,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _cleanup():
    yield
    app.dependency_overrides.clear()


def _setup_db_with_document_and_metadata(verification_status="PENDING"):
    """Return a mock db that has a document and extraction metadata."""
    mock_db = MagicMock()
    doc = _make_document(document_id=1, uploaded_by=1)
    metadata = _make_metadata(meta_id=1, document_id=1, verification_status=verification_status)

    mock_db.get.return_value = doc

    # Mock the query chain: db.query(...).filter(...).order_by(...).first()
    mock_query = MagicMock()
    mock_query.filter.return_value = mock_query
    mock_query.order_by.return_value = mock_query
    mock_query.first.return_value = metadata
    mock_db.query.return_value = mock_query

    return mock_db, doc, metadata


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestVerifyDocumentExtraction:
    """Tests for POST /api/documents/{document_id}/verification."""

    @patch("main.write_audit")
    def test_verify_pending_to_verified(self, mock_write_audit):
        """PENDING → VERIFIED with corrections → 200."""
        user = _make_user("staff")
        mock_db, doc, metadata = _setup_db_with_document_and_metadata("PENDING")

        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/documents/1/verification",
            json={
                "verification_status": "VERIFIED",
                "corrected_metadata": {"applicant_name": "Juan Dela Cruz"},
                "notes": "Corrected applicant name spelling",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["verification_status"] == "VERIFIED"
        assert data["verified_by"] == user.user_id

    @patch("main.write_audit")
    def test_verify_pending_to_rejected(self, mock_write_audit):
        """PENDING → REJECTED with notes → 200."""
        user = _make_user("staff")
        mock_db, doc, metadata = _setup_db_with_document_and_metadata("PENDING")

        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/documents/1/verification",
            json={
                "verification_status": "REJECTED",
                "notes": "Image too blurry to verify",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["verification_status"] == "REJECTED"

    def test_verify_already_verified_returns_conflict(self):
        """Attempting to verify an already-VERIFIED extraction → 409."""
        user = _make_user("staff")
        mock_db, doc, metadata = _setup_db_with_document_and_metadata("VERIFIED")

        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/documents/1/verification",
            json={"verification_status": "VERIFIED"},
        )
        assert response.status_code == 409

    def test_verify_unauthorized_role(self):
        """User without staff/admin role → 403."""
        user = _make_user("viewer")  # not in allowed workspace roles
        mock_db, doc, metadata = _setup_db_with_document_and_metadata("PENDING")

        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/documents/1/verification",
            json={"verification_status": "VERIFIED"},
        )
        assert response.status_code == 403

    def test_verify_nonexistent_document(self):
        """Bad document_id → 404."""
        user = _make_user("staff")
        mock_db = MagicMock()
        mock_db.get.return_value = None  # Document not found

        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/documents/99999/verification",
            json={"verification_status": "VERIFIED"},
        )
        assert response.status_code == 404

    def test_verify_no_extraction_metadata(self):
        """Document exists but has no extraction metadata → 404."""
        user = _make_user("staff")
        mock_db = MagicMock()
        doc = _make_document(document_id=1, uploaded_by=1)
        mock_db.get.return_value = doc

        mock_query = MagicMock()
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.first.return_value = None  # No metadata
        mock_db.query.return_value = mock_query

        app.dependency_overrides[current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/api/documents/1/verification",
            json={"verification_status": "VERIFIED"},
        )
        assert response.status_code == 404
