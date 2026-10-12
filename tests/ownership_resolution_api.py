"""Isolated PostgreSQL/API only; leaves synthetic audit evidence in the disposable DB."""
import json
import os
import sys
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import Request

import requests

URL = os.environ.get("E2E_API_URL")
DB_URL = "postgresql://jurisguard_test@127.0.0.1:55439/jurisguard_synthetic"
if URL != "http://127.0.0.1:58087" or os.environ.get("E2E_ISOLATED_DB") != "jurisguard_synthetic:55439" or os.environ.get("DATABASE_URL") != DB_URL:
    raise SystemExit("Refusing to test outside the isolated local database/API")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import models  # noqa: E402
import main  # noqa: E402
from database import SessionLocal  # noqa: E402


def call(method, path, status, token=None, **kwargs):
    response = requests.request(method, URL + path, headers={"Authorization": f"Bearer {token}"} if token else {}, timeout=20, **kwargs)
    assert response.status_code == status, (method, path, response.status_code, response.text[:300])
    return response.json() if response.headers.get("content-type", "").startswith("application/json") else response


def login(email, password):
    return call("POST", "/api/auth/token", 200, data={"username": email, "password": password})["access_token"]


admin = login("admin@synthetic.invalid", "test-only-A!23456789")
suffix = uuid4().hex[:10]
credentials = [(f"owner-{suffix}@synthetic.invalid", "test-only-B!23456789"), (f"other-{suffix}@synthetic.invalid", "test-only-C!23456789")]
for email, password in credentials:
    call("POST", "/api/auth/register", 200, json={"full_name": "Synthetic Ownership Staff", "email": email, "password": password, "employee_id_path": "synthetic"})
users = call("GET", "/api/admin/verification", 200, admin)
ids = [next(row["user_id"] for row in users if row["email"] == email) for email, _ in credentials]
for uid in ids:
    call("PATCH", f"/api/admin/users/{uid}/approval", 200, admin, json={"approval_status": "approved"})
owner, other = [login(email, password) for email, password in credentials]
with SessionLocal() as db:
    client = models.Client(name=f"Synthetic unresolved {suffix}")
    db.add(client)
    db.commit()
    client_id = client.client_id
path = f"/api/admin/clients/{client_id}/resolve-owner"
list_path = "/api/admin/clients/unresolved-owners"
candidates_path = "/api/admin/clients/owner-candidates"
payload = {"owner_user_id": ids[0], "reason": "Independent enrollment sheet confirms creator", "evidence_reference": f"TEST-SHEET-{suffix}"}

call("GET", list_path, 401)
call("GET", candidates_path, 401)
call("GET", list_path, 403, owner)
call("GET", candidates_path, 403, owner)
call("POST", path, 401, json=payload)
call("POST", path, 403, owner, json=payload)
call("GET", f"/api/clients/{client_id}", 403, owner)
call("GET", f"/api/clients/{client_id}", 403, other)
items = call("GET", list_path, 200, admin)
assert any(row["client_id"] == client_id and row["name"].startswith("Synthetic unresolved") for row in items)
assert ids[0] in {row["user_id"] for row in call("GET", candidates_path, 200, admin)}
call("POST", path, 422, admin, json={**payload, "owner_user_id": ids[1], "reason": " ", "evidence_reference": " "})
call("POST", path, 422, admin, json={**payload, "owner_user_id": 9999999})
call("POST", path, 422, admin, json={**payload, "owner_user_id": call("GET", "/api/auth/me", 200, admin)["user_id"]})
for actor in (owner, admin):
    call("POST", "/api/audit-logs/", 403, actor, json={"action": "Resolve Client Owner", "entity_type": "client", "entity_id": str(client_id)})
with SessionLocal() as db:
    assert db.get(models.Client, client_id).created_by_user_id is None
    assert db.query(models.AuditLog).filter_by(action="Resolve Client Owner", entity_id=str(client_id)).count() == 0

assert call("POST", path, 200, admin, json=payload) == {"client_id": client_id, "previous_owner_user_id": None, "owner_user_id": ids[0]}
call("POST", path, 409, admin, json={**payload, "owner_user_id": ids[1]})
call("GET", f"/api/clients/{client_id}", 200, owner)
call("GET", f"/api/clients/{client_id}", 403, other)
assert client_id in {int(row["client_id"]) for row in call("GET", "/api/clients/", 200, owner)}
assert client_id not in {int(row["client_id"]) for row in call("GET", "/api/clients/", 200, other)}
assert not any(row["client_id"] == client_id for row in call("GET", list_path, 200, admin))
with SessionLocal() as db:
    audit = db.query(models.AuditLog).filter_by(action="Resolve Client Owner", entity_id=str(client_id)).all()
    assert len(audit) == 1
    details = json.loads(audit[0].description)
    assert details == {"previous_owner_user_id": None, "new_owner_user_id": ids[0], "reason": payload["reason"], "evidence_reference": payload["evidence_reference"]}
    assert audit[0].user_id == call("GET", "/api/auth/me", 200, admin)["user_id"] and audit[0].timestamp is not None
# Force audit creation to fail after the owner is changed in the transaction.
# The change must not survive the exception or produce a partial audit entry.
with SessionLocal() as db:
    rollback_client = models.Client(name=f"Synthetic rollback {suffix}")
    db.add(rollback_client)
    db.commit()
    rollback_id = rollback_client.client_id
with SessionLocal() as db:
    admin_user = db.get(models.User, call("GET", "/api/auth/me", 200, admin)["user_id"])
    request = Request({"type": "http", "method": "POST", "path": path, "headers": [], "client": ("127.0.0.1", 1)})
    try:
        with patch.object(main, "write_audit", side_effect=RuntimeError("synthetic audit failure")):
            main.resolve_client_owner(rollback_id, main.ResolveClientOwnerPayload(**payload), request, admin_user, db)
    except RuntimeError as exc:
        assert str(exc) == "synthetic audit failure"
    else:
        raise AssertionError("Audit failure did not abort resolution")
with SessionLocal() as db:
    assert db.get(models.Client, rollback_id).created_by_user_id is None
    assert db.query(models.AuditLog).filter_by(action="Resolve Client Owner", entity_id=str(rollback_id)).count() == 0

# Concurrent requests for a second synthetic unresolved client must serialize:
# exactly one resolution and one server audit entry, never an overwrite.
with SessionLocal() as db:
    concurrent = models.Client(name=f"Synthetic concurrent {suffix}")
    db.add(concurrent)
    db.commit()
    concurrent_id = concurrent.client_id
with ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(lambda uid: requests.post(
        URL + f"/api/admin/clients/{concurrent_id}/resolve-owner",
        headers={"Authorization": f"Bearer {admin}"},
        json={**payload, "owner_user_id": uid}, timeout=20,
    ).status_code, ids))
assert sorted(results) == [200, 409], results
with SessionLocal() as db:
    audits = db.query(models.AuditLog).filter_by(action="Resolve Client Owner", entity_id=str(concurrent_id)).all()
    assert len(audits) == 1
    assert db.get(models.Client, concurrent_id).created_by_user_id == json.loads(audits[0].description)["new_owner_user_id"]
print("PASS: admin-only view/candidates, validation, audit-failure rollback, single server audit, 409 conflict/concurrency and staff isolation")
