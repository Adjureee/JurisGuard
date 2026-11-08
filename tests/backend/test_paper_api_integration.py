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
        from sqlalchemy import text
        from sqlalchemy.exc import DBAPIError
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
            key = base64.urlsafe_b64encode(bytes(range(32))).decode()
            self.enterContext(patch.dict(os.environ, {'DOCUMENT_ENCRYPTION_KEY': key}))
            with patch.object(main, 'extract_document', extract):
                response = api.post('/api/upload-document/?extraction_target=paper_intake&extraction_mode=offline', files={'file': ('fictional.png', photo.getvalue(), 'image/png'), 'ocr_image': ('selected.png', selected, 'image/png')})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            document = db.get(main.models.Document, result['document_id'])
            paths.append(Path(document.encrypted_file_path))
            self.assertEqual(paths[0].suffix, '.enc')
            self.assertNotEqual(paths[0].read_bytes(), photo.getvalue())
            self.assertEqual(api.get(f'/api/pao-intakes/documents/{document.document_id}').content, photo.getvalue())
            from types import SimpleNamespace
            main.app.dependency_overrides[main.current_user] = lambda: SimpleNamespace(user_id=-1, role=None)
            self.assertEqual(api.get(f'/api/pao-intakes/documents/{document.document_id}').status_code, 403)
            main.app.dependency_overrides[main.current_user] = lambda: user
            sections = empty_sections()
            sections[APPLICANT]['name'] = 'FICTIONAL Corrected Applicant'
            sections[APPLICANT]['contact_no'] = '000-000-0001'
            reviewed = {'document_id': document.document_id, 'sections': sections, 'checkbox_states': unknown_boxes(), 'reviewed': True, 'source_draft_id': result['source_draft_id']}
            self.assertEqual(api.post('/api/pao-intakes/', json=dict(reviewed, reviewed=False)).status_code, 422)
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
            selected = photo.getvalue()
            with patch.object(main, 'extract_document', extract):
                reread = api.post(f'/api/pao-intakes/documents/{document.document_id}/extract?extraction_mode=offline')
            self.assertEqual(reread.status_code, 200, reread.text)
            reopened_intake = db.query(main.models.ReviewedPaperIntake).filter_by(document_id=document.document_id).one()
            self.assertEqual(reopened_intake.sections, sections)
            self.assertEqual(api.post('/api/audit-logs/', json={'action': 'Login', 'module': 'Authentication'}).status_code, 403)
            export = api.post('/api/audit-logs/', json={
                'action': 'Export Excel', 'module': 'Export', 'entity_type': 'terminated_case_export',
                'description': 'SYNTHETIC caller-controlled text',
            })
            self.assertEqual(export.status_code, 200)
            last_audit = db.query(main.models.AuditLog).order_by(main.models.AuditLog.log_id.desc()).limit(2).all()
            self.assertEqual(last_audit[0].description, 'Browser reported an export request')
            self.assertEqual(last_audit[0].previous_hash, last_audit[1].current_hash)
            archive = paths[0].read_bytes()
            paths[0].write_bytes(archive[:-1] + bytes([archive[-1] ^ 1]))
            try:
                self.assertEqual(api.get(f'/api/pao-intakes/documents/{document.document_id}').status_code, 503)
            finally:
                paths[0].write_bytes(archive)
            reads = db.query(main.models.AuditLog).filter_by(action="Read Document", entity_id=str(document.document_id)).all()
            self.assertEqual(len(reads), 1)
            self.assertEqual(reads[0].user_id, user.user_id)
            pdf = io.BytesIO()
            Image.new('RGB', (120, 160), 'white').save(pdf, 'PDF')
            selected = pdf.getvalue()
            with patch.object(main, 'extract_document', extract):
                uploaded_pdf = api.post('/api/upload-document/?extraction_target=paper_intake&extraction_mode=offline',
                                        files={'file': ('fictional.pdf', selected, 'application/pdf')})
            self.assertEqual(uploaded_pdf.status_code, 200, uploaded_pdf.text)
            pdf_id = uploaded_pdf.json()['document_id']
            paths.append(Path(db.get(main.models.Document, pdf_id).encrypted_file_path))
            page = api.get(f'/api/pao-intakes/documents/{pdf_id}/pages/1')
            self.assertEqual(page.status_code, 200)
            self.assertEqual(page.headers['content-type'], 'image/png')
            for statement in ('UPDATE audit_log SET description = NULL WHERE false',
                              'DELETE FROM audit_log WHERE false', 'TRUNCATE audit_log'):
                with self.assertRaisesRegex(DBAPIError, 'Audit log is append-only'), db.begin_nested():
                    db.execute(text(statement))
        finally:
            main.app.dependency_overrides.clear()
            db.close()
            transaction.rollback()
            connection.close()
            for path in paths:
                path.unlink(missing_ok=True)
