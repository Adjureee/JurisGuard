"""Opt-in local database integration; fictional upload, rollback all test rows.

JURISGUARD_LOCAL_INTEGRATION=1 python -m unittest tests.backend.test_paper_api_integration -v
OCR is stubbed; no cloud calls or real documents are used.
"""
import io
import base64
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))


@unittest.skipUnless(os.getenv('JURISGUARD_LOCAL_INTEGRATION') == '1', 'explicit local database integration only')
class PaperApiIntegration(unittest.TestCase):
    def test_schema_upload_review_save_reopen(self):
        from fastapi.testclient import TestClient
        from sqlalchemy.orm import Session
        from PIL import Image
        import main
        from paper_intake import empty_sections, extract_paper_intake, APPLICANT, REPRESENTATIVE
        from paper_checkboxes import unknown_boxes

        connection = main.engine.connect()
        transaction = connection.begin()
        db = Session(bind=connection, join_transaction_mode='create_savepoint')
        paths = []
        try:
            user = next((item for item in db.query(main.models.User).all() if main.is_admin(item)), None)
            self.assertIsNotNone(user, 'local admin fixture required')
            main.app.dependency_overrides[main.get_db] = lambda: db
            main.app.dependency_overrides[main.current_user] = lambda: user
            api = TestClient(main.app)
            schema = api.get('/api/pao-intakes/schema')
            self.assertEqual(schema.status_code, 200, schema.text)
            self.assertEqual(len(schema.json()), 2)
            candidate = extract_paper_intake('')
            candidate['sections'][APPLICANT]['name'] = 'FICTIONAL Integration Attorney Review'
            candidate['extraction_mode'] = 'OFFLINE_PAPER_INTAKE'
            candidate['checkbox_states'] = unknown_boxes()
            async def extract(*args, **kwargs):
                self.assertEqual(args[2], 'paper_intake')
                self.assertEqual(Path(args[0]).read_bytes(), selected)
                return candidate
            photo = io.BytesIO()
            Image.new('RGB', (800, 1000), 'white').save(photo, 'PNG')
            prepared = api.post('/api/pao-intakes/prepare-camera', files={'file': ('fictional.png', photo.getvalue(), 'image/png')})
            self.assertEqual(prepared.status_code, 200, prepared.text[:200])
            selected = base64.b64decode(prepared.json()['image_base64'])
            with patch.object(main, 'extract_document', extract):
                response = api.post('/api/upload-document/?extraction_target=paper_intake&extraction_mode=offline', files={'file': ('fictional.png', photo.getvalue(), 'image/png'), 'ocr_image': ('selected.png', selected, 'image/png')})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            document = db.get(main.models.Document, result['document_id'])
            paths.append(Path(document.encrypted_file_path))
            self.assertEqual(api.get(f'/api/pao-intakes/documents/{document.document_id}').content, photo.getvalue())
            sections = empty_sections()
            sections[APPLICANT]['name'] = 'FICTIONAL Corrected Applicant'
            sections[APPLICANT]['contact_no'] = '000-000-0001'
            reviewed = {'document_id': document.document_id, 'sections': sections, 'checkbox_states': unknown_boxes(), 'reviewed': True, 'source_draft_id': result['source_draft_id']}
            response = api.post('/api/pao-intakes/', json=reviewed)
            self.assertEqual(response.status_code, 200, response.text)
            saved = response.json()
            reopened = api.get('/api/clients/' + saved['client_id'])
            self.assertEqual(reopened.status_code, 200, reopened.text)
            intake = reopened.json()['paper_intake']
            self.assertEqual(intake['sections'], sections)
            self.assertEqual(intake['checkbox_states'], unknown_boxes())
            self.assertTrue(all(not value for value in intake['sections'][REPRESENTATIVE].values()))
            self.assertEqual(intake['candidate_snapshot']['sections'][APPLICANT]['name'], candidate['sections'][APPLICANT]['name'])
        finally:
            main.app.dependency_overrides.clear()
            db.close()
            transaction.rollback()
            connection.close()
            for path in paths:
                path.unlink(missing_ok=True)
