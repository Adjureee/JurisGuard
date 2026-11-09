"""Synthetic live API smoke test; requires explicitly configured isolated test API.

Run only against the disposable PostgreSQL cluster on port 55439. No teardown or
production connection is attempted by this script.
"""

import io
import os
from pathlib import Path
from uuid import uuid4

import requests
from PIL import Image

BASE = os.environ.get("E2E_API_URL", "")
if BASE not in ("http://127.0.0.1:58080", "http://127.0.0.1:58082", "http://127.0.0.1:58083", "http://127.0.0.1:58084", "http://127.0.0.1:58085", "http://127.0.0.1:58086") or os.environ.get("E2E_ISOLATED_DB") != "jurisguard_synthetic:55439":
    raise SystemExit("Refusing to run outside the isolated local test API/database")


def call(method, path, expected, token=None, **kwargs):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = requests.request(method, BASE + path, headers=headers, timeout=180, **kwargs)
    print(method, path.split("?")[0], response.status_code, "expected", expected, flush=True)
    assert response.status_code == expected, response.text[:500]
    return response.json() if "application/json" in response.headers.get("content-type", "") else response


def credentials(email, password):
    return call("POST", "/api/auth/token", 200, data={"username": email, "password": password})["access_token"]


call("GET", "/health", 200)
call("GET", "/api/clients/", 401)
# First registration is only a bootstrap on an empty database; re-runs use it.
if call("GET", "/health", 200)["total users"] == 0:
    admin_payload = {"full_name": "Synthetic Admin", "email": "admin@synthetic.invalid", "password": "test-only-A!23456789", "employee_id_path": "synthetic"}
    call("POST", "/api/auth/register", 403, json=admin_payload)
    call("POST", "/api/auth/register", 403, json={**admin_payload, "bootstrap_key": "wrong"})
    call("POST", "/api/auth/register", 200, json={**admin_payload, "bootstrap_key": os.environ["E2E_BOOTSTRAP_KEY"]})
admin = credentials("admin@synthetic.invalid", "test-only-A!23456789")
suffix = uuid4().hex[:8]
email_a, email_b = f"a-{suffix}@synthetic.invalid", f"b-{suffix}@synthetic.invalid"
assert call("GET", "/api/auth/me", 200, admin)["role"] == "admin"
call("POST", "/api/auth/register", 200, json={"full_name": "Synthetic Staff A", "email": email_a, "password": "test-only-B!23456789", "employee_id_path": "synthetic"})
call("POST", "/api/auth/register", 200, json={"full_name": "Synthetic Staff B", "email": email_b, "password": "test-only-C!23456789", "employee_id_path": "synthetic"})
call("POST", "/api/auth/token", 401, data={"username": email_a, "password": "test-only-B!23456789"})
users = call("GET", "/api/admin/verification", 200, admin)
for email in (email_a, email_b):
    uid = next(u["user_id"] for u in users if u["email"] == email)
    call("PATCH", f"/api/admin/users/{uid}/approval", 200, admin, json={"approval_status": "approved"})
a = credentials(email_a, "test-only-B!23456789")
b = credentials(email_b, "test-only-C!23456789")
call("GET", "/api/admin/verification", 403, a)
call("PATCH", f"/api/admin/users/{uid}/approval", 403, a, json={"approval_status": "approved"})
call("GET", "/api/clients/", 401, "invalid-token")

client_payload = {"client": {"name": "Synthetic Client", "age": 32, "sex": "Female"}, "client_details": {"address": "Synthetic address"}, "client_classification": {}}
client = call("POST", "/api/clients/", 200, a, json=client_payload)
print("CLIENT_KEYS", sorted(client), flush=True)
client_id = int(client["client_id"])
assert int(call("GET", f"/api/clients/{client_id}", 200, a)["client_id"]) == client_id
call("GET", f"/api/clients/{client_id}", 403, b)
call("POST", "/api/audit-logs/", 403, b, json={"action": "Create Client", "entity_type": "client", "entity_id": str(client_id)})
call("GET", f"/api/clients/{client_id}", 403, b)
call("PATCH", f"/api/clients/{client_id}", 403, b, json=client_payload)
assert not any(int(c["client_id"]) == client_id for c in call("GET", "/api/clients/", 200, b))
case_payload = {"client_id": client_id, "case_type": "Criminal", "intake_record": {"control_no": f"E2E-{suffix}", "form_date": "2026-10-11", "applicant_role": "Accused"}, "representative": {}, "adverse_party": {}, "cases": {"status_of_case": "Pending", "facts_of_case": "Synthetic facts only", "incident_barangay": "Gredu"}}
case = call("POST", "/api/cases/", 200, a, json=case_payload)
print("CASE_KEYS", sorted(case), flush=True)
case_id = int(case["case_id"])
assert any(int(c["case_id"]) == case_id for c in call("GET", "/api/cases/?case_type=All", 200, a))
assert not any(int(c["case_id"]) == case_id for c in call("GET", "/api/cases/?case_type=All", 200, b))
call("PATCH", f"/api/cases/{case_id}", 403, b, json=case_payload)
call("GET", f"/api/printable-intake/{case_id}", 403, b)

image = io.BytesIO()
Image.new("RGB", (100, 100), "white").save(image, "PNG")
call("POST", "/api/auth/me/profile-image", 400, a, files={"file": ("bad.png", b"<svg>not png</svg>", "image/png")})
call("POST", "/api/auth/me/profile-image", 413, a, files={"file": ("big.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")})
profile = call("POST", "/api/auth/me/profile-image", 200, a, files={"file": ("profile.png", image.getvalue(), "image/png")})
profile_path = profile["profile_image_path"]
call("GET", profile_path, 401)
call("GET", profile_path, 200, a)
call("GET", profile_path, 403, b)
call("GET", profile_path, 200, admin)
replaced = call("POST", "/api/auth/me/profile-image", 200, a, files={"file": ("profile.png", image.getvalue(), "image/png")})
new_profile_path = replaced["profile_image_path"]
call("GET", profile_path, 404, a)
call("GET", new_profile_path, 200, a)
call("DELETE", "/api/auth/me/profile-image", 200, a)
call("GET", new_profile_path, 404, a)
call("POST", "/api/upload-document/?extraction_mode=offline", 400, a, files={"file": ("bad.png", b"not png", "image/png")})
call("POST", "/api/upload-document/?extraction_mode=offline", 413, a, files={"file": ("big.png", b"x" * (25 * 1024 * 1024 + 1), "image/png")})
fixture = Path(__file__).resolve().parent.parent / "jurisguard-extraction-lab/data/synthetic/synthetic_intake.png"
result = call("POST", f"/api/upload-document/?case_id={case_id}&extraction_mode=offline", 200, a, files={"file": ("intake.png", fixture.read_bytes(), "image/png")})
assert result["extracted_data"]["document_type"] == "intake_form"
assert len(result["extracted_data"]["inventory"]) == 21
assert all(key in result["extracted_data"] for key in ("document_type", "needs_review", "diagnostics"))
# The stored intake/case should be represented once in the year-end submission snapshot.
coverage = {"title": f"Synthetic Year-End {suffix}", "date_from": "2026-01-01", "date_to": "2026-12-31", "notes": "Synthetic only"}
preview = call("POST", "/api/case-submissions/preview", 200, a, json=coverage)
assert any(str(item["record"]["case_id"]) == str(case_id) for item in preview["items"]), preview
call("POST", "/api/case-submissions/preview", 403, admin, json=coverage)
submission = call("POST", "/api/case-submissions", 200, a, json=coverage)
submission_id = submission["submission_id"]
assert submission["case_count"] >= 1 and submission["status"] == "Draft"
assert call("GET", f"/api/case-submissions/{submission_id}", 200, a)["status"] == "Draft"
call("GET", f"/api/case-submissions/{submission_id}", 403, b)
call("PATCH", f"/api/case-submissions/{submission_id}", 403, b, json=coverage)
call("POST", f"/api/case-submissions/{submission_id}/submit", 403, b)
call("POST", f"/api/case-submissions/{submission_id}/approve", 403, a)
call("POST", f"/api/case-submissions/{submission_id}/approve", 400, admin)
assert call("POST", f"/api/case-submissions/{submission_id}/submit", 200, a)["status"] == "Submitted"
assert call("POST", f"/api/case-submissions/{submission_id}/review", 200, admin)["status"] == "Under Review"
corrected = call("POST", f"/api/case-submissions/{submission_id}/request-correction", 200, admin, json={"comments": "Synthetic correction"})
assert corrected["status"] == "Correction Required"
resubmitted = call("POST", f"/api/case-submissions/{submission_id}/resubmit", 200, a, json=coverage)
assert resubmitted["version"] == 2 and resubmitted["status"] == "Resubmitted"
call("POST", f"/api/case-submissions/{submission_id}/approve", 409, admin)
assert call("POST", f'/api/case-submissions/{resubmitted["submission_id"]}/approve', 200, admin)["status"] == "Approved"
assert len(call("GET", f"/api/case-submissions/{submission_id}/history", 200, a)) == 2
call("POST", f"/api/upload-document/?case_id={case_id}&extraction_mode=offline", 403, b, files={"file": ("intake.png", fixture.read_bytes(), "image/png")})
# Document blobs must not be accessible through the public uploads route.
call("GET", f'/uploads/{result["document_id"]}', 404)
print("DOCUMENT", result["document_id"], "review", result["extracted_data"]["needs_review"], flush=True)
# Revocation persists server-side; other sessions remain valid.
call("GET", "/api/auth/me", 200, b)
call("POST", "/api/auth/logout", 200, a)
call("GET", "/api/auth/me", 401, a)
call("GET", "/api/clients/", 401, a)
call("POST", "/api/auth/logout", 401, a)
call("GET", "/api/auth/me", 200, b)
print("LIVE API SMOKE PASSED", flush=True)
