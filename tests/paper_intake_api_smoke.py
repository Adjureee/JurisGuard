"""Manual API smoke check on a new disposable PostgreSQL database only.

Run from the repository root with backend/venv/Scripts/python.exe.
Uses synthetic records and removes only the randomly named database it creates.
"""
from pathlib import Path
import io
import os
import sys
import uuid
from unittest.mock import AsyncMock, patch

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from fastapi.testclient import TestClient
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
load_dotenv(ROOT / '.env')
configured = make_url(os.environ['DATABASE_URL'])
if configured.host not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Smoke test requires local PostgreSQL.')
database_name = 'jurisguard_intake_test_' + uuid.uuid4().hex
admin = create_engine(configured.set(database='postgres'), isolation_level='AUTOCOMMIT')
with admin.connect() as connection:
    connection.execute(text(f'CREATE DATABASE "{database_name}"'))
os.environ['DATABASE_URL'] = configured.set(database=database_name).render_as_string(hide_password=False)
try:
    import main
    import models
    from database import SessionLocal
    from paper_intake import APPLICANT as A, REPRESENTATIVE as R, extract_paper_intake
    with SessionLocal() as db:
        role = db.query(models.Role).filter_by(role_name='staff').one()
        owner = models.User(username='synthetic-owner', email='owner@example.com', password_hash='unused', role_id=role.role_id, is_active=True, approval_status='approved')
        outsider = models.User(username='synthetic-other', email='other@example.com', password_hash='unused', role_id=role.role_id, is_active=True, approval_status='approved')
        legacy = models.Client(name='SYNTHETIC legacy', citizenship='Existing unchanged')
        db.add_all([owner, outsider, legacy]); db.commit()
        owner_id, outsider_id, legacy_id = owner.user_id, outsider.user_id, legacy.client_id
    def user_by_id(identifier):
        with SessionLocal() as db:
            user = db.get(models.User, identifier)
            user.role  # Keep role available after detaching.
            db.expunge(user)
            return user
    main.app.dependency_overrides[main.current_user] = lambda: user_by_id(owner_id)
    result = extract_paper_intake('II. IMPORMASYON UKOL SA APLIKANTE\nPangalan: SYNTHETIC Applicant\nIndividual Monthly Income: 01,234.50\nII-A. IMPORMASYON UKOL SA REPRESENTATIVE\nPangalan: SYNTHETIC Representative\nIII. URI NG KASO\nPangalan: OUTSIDE')
    result['extraction_mode'] = 'OFFLINE_PAPER_INTAKE'
    image = io.BytesIO(); Image.new('RGB', (80, 80), 'white').save(image, 'PNG')
    with TestClient(main.app) as client, patch.object(main, 'extract_document', AsyncMock(return_value=result)):
        upload = client.post('/api/upload-document/?extraction_mode=offline&extraction_target=paper_intake', files={'file': ('synthetic.png', image.getvalue(), 'image/png')})
        assert upload.status_code == 200, upload.status_code
        body = upload.json(); document_id = body['document_id']
        assert set(body['extracted_data']['sections']) == {A, R}
        assert 'OUTSIDE' not in str(body)
        assert client.get(f'/api/pao-intakes/documents/{document_id}').content == image.getvalue()
        assert client.get(f'/api/pao-intakes/documents/{document_id}/pages/1').status_code == 400
        assert client.get(f'/api/pao-intakes/documents/{document_id}/pages/0').status_code == 404
        reread = client.post(f'/api/pao-intakes/documents/{document_id}/extract?extraction_mode=offline')
        assert reread.status_code == 200
        assert reread.json()['document_id'] == document_id
        sections = body['extracted_data']['sections']
        sections[A]['name'] = 'SYNTHETIC corrected applicant'
        sections[A]['age'] = ''
        payload = {'document_id': document_id, 'source_draft_id': body['source_draft_id'], 'sections': sections, 'unreadable_fields': [f'{A}.detained_since'], 'reviewed': True}
        reviews = {f'{s}.{key}': 'confirmed' if value else 'blank' for s, fields in sections.items() for key, value in fields.items()}
        reviews[f'{A}.detained'] = 'unmarked'
        reviews[f'{A}.detained_since'] = 'unreadable'
        payload['field_reviews'] = reviews
        main.app.dependency_overrides[main.current_user] = lambda: user_by_id(outsider_id)
        assert client.post('/api/pao-intakes/', json=payload).status_code == 403
        assert client.get(f'/api/pao-intakes/documents/{document_id}').status_code == 403
        assert client.post(f'/api/pao-intakes/documents/{document_id}/extract').status_code == 403
        main.app.dependency_overrides[main.current_user] = lambda: user_by_id(owner_id)
        forbidden = {**payload, 'sections': {**sections, 'classification': {}}}
        assert client.post('/api/pao-intakes/', json=forbidden).status_code == 422
        assert client.post('/api/pao-intakes/', json={**payload, 'reviewed': False}).status_code == 422
        simplified_payload = {key: value for key, value in payload.items() if key not in ('field_reviews', 'unreadable_fields')}
        saved = client.post('/api/pao-intakes/', json=simplified_payload)
        assert saved.status_code == 200, saved.status_code
        record = saved.json(); client_id = record['client_id']
        assert record['paper_intake']['field_reviews'] is None
        # Simulate existing status metadata from the prior workflow.
        legacy_review = client.patch(f'/api/pao-intakes/{client_id}', json=payload)
        assert legacy_review.status_code == 200
        record = legacy_review.json()
        assert record['paper_intake']['sections'][A]['name'] == 'SYNTHETIC corrected applicant'
        assert record['paper_intake']['sections'][R]['name'] == 'SYNTHETIC Representative'
        assert record['paper_intake']['sections'][A]['individual_monthly_income'] == '01,234.50'
        assert record['paper_intake']['sections'][A]['age'] == ''
        assert record['paper_intake']['field_reviews'][f'{A}.detained'] == 'unmarked'
        assert client.post('/api/pao-intakes/', json=payload).status_code == 409
        assert client.get(f'/api/clients/{client_id}').json()['paper_intake']['sections'] == sections
        sections[R]['name'] = ''
        reviews[f'{R}.name'] = 'blank'
        edited = client.patch(f'/api/pao-intakes/{client_id}', json=payload)
        assert edited.status_code == 200, edited.status_code
        assert edited.json()['paper_intake']['sections'][R]['name'] == ''
        reviews[f'{A}.detained'] = 'confirmed'
        assert client.patch(f'/api/pao-intakes/{client_id}', json=payload).status_code == 200
        reviews[f'{A}.detained'] = 'unclear'
        assert client.patch(f'/api/pao-intakes/{client_id}', json=payload).status_code == 200
        historical_statuses = dict(reviews)
        simplified_edit = {'document_id': document_id, 'sections': sections, 'reviewed': True}
        no_status_edit = client.patch(f'/api/pao-intakes/{client_id}', json=simplified_edit)
        assert no_status_edit.status_code == 200
        assert no_status_edit.json()['paper_intake']['field_reviews'] == historical_statuses
        assert no_status_edit.json()['paper_intake']['unreadable_fields'] == payload['unreadable_fields']
        assert no_status_edit.json()['paper_intake']['candidate_snapshot']['sections'][A]['name'] == 'SYNTHETIC Applicant'
        assert no_status_edit.json()['paper_intake']['source_draft_id'] == body['source_draft_id']
        from paper_checkboxes import PREFIX, answer_from_boxes
        for oo, hindi, projected in [('checked', 'unchecked', True), ('unchecked', 'checked', False),
                                     ('unchecked', 'unchecked', None), ('unknown', 'unchecked', None),
                                     ('checked', 'checked', None), ('unknown', 'unknown', None)]:
            boxes = {PREFIX+'oo': oo, PREFIX+'hindi': hindi}
            sections[A]['detained'] = answer_from_boxes(boxes)
            reviewed = {**simplified_edit, 'checkbox_states': boxes}
            edited = client.patch(f'/api/pao-intakes/{client_id}', json=reviewed)
            assert edited.status_code == 200, edited.text
            reopened = next(row for row in client.get('/api/clients/').json() if row['client_id'] == client_id)
            assert reopened['paper_intake']['checkbox_states'] == boxes
            assert reopened['client_details']['detained'] is projected
            # Text-only legacy edits may not silently contradict stored marks.
            unchanged = client.patch(f'/api/pao-intakes/{client_id}', json=simplified_edit)
            assert unchanged.status_code == 200
            assert unchanged.json()['paper_intake']['checkbox_states'] == boxes
        bad = {**simplified_edit, 'checkbox_states': {PREFIX+'oo': False, PREFIX+'hindi': 'unchecked'}}
        assert client.patch(f'/api/pao-intakes/{client_id}', json=bad).status_code == 422
        bad_draft = {**simplified_edit, 'source_draft_id': '0'*64}
        assert client.patch(f'/api/pao-intakes/{client_id}', json=bad_draft).status_code == 422
        from copy import deepcopy
        later = deepcopy(result); later['sections'][A]['name'] = 'SYNTHETIC second extraction'
        with patch.object(main, 'extract_document', AsyncMock(return_value=later)):
            later_draft = client.post(f'/api/pao-intakes/documents/{document_id}/extract?extraction_mode=offline').json()
        assert later_draft['source_draft_id'] != body['source_draft_id']
        before_review = next(row for row in client.get('/api/clients/').json() if row['client_id'] == client_id)
        assert before_review['paper_intake']['candidate_snapshot']['sections'][A]['name'] == 'SYNTHETIC Applicant'
        reviewed_later = {**simplified_edit, 'source_draft_id': later_draft['source_draft_id']}
        after_review = client.patch(f'/api/pao-intakes/{client_id}', json=reviewed_later)
        assert after_review.status_code == 200
        assert after_review.json()['paper_intake']['candidate_snapshot']['sections'][A]['name'] == 'SYNTHETIC second extraction'
        assert after_review.json()['paper_intake']['sections'][A]['name'] == sections[A]['name']
        manual = client.post('/api/clients/', json={
            'client': {'name': 'SYNTHETIC manual client', 'age': 0, 'citizenship': ''},
            'client_details': {'representative_name': '', 'representative_age': 0},
            'client_classification': {'flags_reviewed': False},
        })
        assert manual.status_code == 200, manual.status_code
        assert manual.json()['paper_intake'] is None
        main.app.dependency_overrides[main.current_user] = lambda: user_by_id(outsider_id)
        assert client.patch(f'/api/pao-intakes/{client_id}', json=payload).status_code == 403
        assert client.get(f'/api/pao-intakes/documents/{document_id}').status_code == 403
        assert client.get(f'/api/pao-intakes/documents/{document_id}/pages/1').status_code == 403
        main.app.dependency_overrides.clear()
        assert client.get(f'/api/pao-intakes/documents/{document_id}').status_code == 401
        assert client.get(f'/api/pao-intakes/documents/{document_id}/pages/1').status_code == 401
    with SessionLocal() as db:
        assert db.get(models.Client, legacy_id).citizenship == 'Existing unchanged'
        assert db.query(models.IntakeRecord).count() == 0
        assert db.query(models.ClientClassification).count() == 1  # Existing manual API retains its classification row.
        assert db.query(models.Document).count() == 1  # Manual creation required no scan.
        manual_client = db.get(models.Client, int(manual.json()['client_id']))
        assert manual_client.age is None
        assert manual_client.citizenship == ''
        assert manual_client.details.representative_name is None
        assert db.get(models.Client, int(client_id)).age is None
        assert db.get(models.Client, int(client_id)).details.detained is None
        assert db.query(models.ExtractedMetadata).one().extracted_json['sections'][R]['name'] == 'SYNTHETIC Representative'
        source = Path(db.get(models.Document, document_id).encrypted_file_path)
        source.unlink()  # Only the synthetic upload created by this run.
    # Synthetic two-page PDF: page geometry must match OCR's scale=2 coordinates.
    import tempfile
    from fastapi.responses import FileResponse
    from fastapi import HTTPException
    with tempfile.TemporaryDirectory() as temporary:
        pdf = Path(temporary) / 'synthetic.pdf'
        Image.new('RGB', (400, 600), 'white').save(pdf, 'PDF', save_all=True, append_images=[Image.new('RGB', (400, 600), 'white')], resolution=72)
        with patch.object(main, 'paper_intake_scan', return_value=FileResponse(pdf, media_type='application/pdf')):
            preview = main.paper_intake_page(1, 2, None, None)
            rendered = Image.open(io.BytesIO(preview.body))
            assert rendered.size == (800, 1200)
            assert preview.headers['x-page-count'] == '2'
            assert preview.headers['cache-control'] == 'private, no-store'
            for page in (0, 3):
                try:
                    main.paper_intake_page(1, page, None, None)
                    raise AssertionError('Invalid page accepted')
                except HTTPException as error:
                    assert error.status_code == 404
    print('PASS: upload, scan, reviewed field states/correction, manual creation without a document, ownership, duplicate save, and unchanged legacy record.')
finally:
    if 'main' in sys.modules:
        main.engine.dispose()
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE "{database_name}" WITH (FORCE)'))
    admin.dispose()
