"""Opt-in transfer API integration with synthetic rows rolled back afterward.

Set JURISGUARD_LOCAL_INTEGRATION=1 to use the configured local PostgreSQL DB.
No real case is transferred and no message leaves the local application.
"""
import os
import sys
import unittest
from pathlib import Path
from datetime import datetime
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))


@unittest.skipUnless(os.getenv('JURISGUARD_LOCAL_INTEGRATION')=='1','explicit local DB integration only')
class TransferApiTests(unittest.TestCase):
    def test_routes_permissions_and_draft_to_receipt(self):
        from fastapi.testclient import TestClient
        from sqlalchemy.orm import Session
        import main
        connection=main.engine.connect();transaction=connection.begin()
        db=Session(bind=connection,join_transaction_mode='create_savepoint')
        try:
            admin=next(user for user in db.query(main.models.User).all() if main.is_admin(user))
            staff_role=next((role for role in db.query(main.models.Role).all() if role.role_name.lower()=='staff'),None)
            if staff_role is None:
                staff_role=main.models.Role(role_id=-910001,role_name='staff');db.add(staff_role)
            people=[]
            for index,label in enumerate(['Source','Recipient','Unrelated']):
                user_id=-910001-index
                self.assertIsNone(db.get(main.models.User,user_id))
                user=main.models.User(user_id=user_id,username=f'fictional-transfer-{index}',email=f'transfer-{index}@example.invalid',full_name=f'Fictional {label}',password_hash='NOT-A-LOGIN-HASH',role=staff_role,is_active=True,approval_status='approved')
                db.add(user);people.append(user)
            source,recipient,unrelated=people
            client=main.models.Client(client_id=-910001,name='FICTIONAL Transfer Client',created_by_user_id=source.user_id)
            intake=main.models.IntakeRecord(intake_id=-910001,client=client,interviewer_id=source.user_id,control_no='FICTIONAL-TRANSFER',form_date=datetime(2026,1,10))
            case=main.models.Case(case_id=-910001,intake=intake,client=client,case_type='Criminal',title_of_case='FICTIONAL Transfer Case',case_no='SYN-TRANSFER',status_of_case='Pending',is_terminated=False,assigned_pao=source.full_name)
            db.add_all([client,intake,case]);db.flush()
            db.add(main.models.CaseClient(case=case,client=client,applicant_role='Accused'));db.flush()
            actor=[admin]
            main.app.dependency_overrides[main.current_user]=lambda:actor[0]
            main.app.dependency_overrides[main.get_db]=lambda:db
            api=TestClient(main.app)
            response=api.get('/api/case-transfers/attorneys');self.assertEqual(response.status_code,200,response.text)
            self.assertIn(source.user_id,[row['user_id'] for row in response.json()])
            response=api.get('/api/case-transfers/cases',params={'case_type':'Criminal','source_user_id':source.user_id})
            self.assertEqual(response.status_code,200,response.text);self.assertIn(case.case_id,[row['case_id'] for row in response.json()])
            actor[0]=unrelated
            self.assertEqual(api.get('/api/case-transfers/cases',params={'case_type':'Criminal','source_user_id':source.user_id}).status_code,403)
            response=api.get('/api/case-transfers/cases',params={'case_type':'Criminal'})
            self.assertNotIn(case.case_id,[row['case_id'] for row in response.json()])
            payload={'title':'FICTIONAL transfer integration','report_date':'2026-11-07','from_user_id':source.user_id,'to_user_id':recipient.user_id,'case_ids':[case.case_id],'administrative_entries':[]}
            actor[0]=admin
            response=api.post('/api/case-transfers',json=payload);self.assertEqual(response.status_code,200,response.text)
            report=response.json();report_id=report['report_id'];path=f'/api/case-transfers/{report_id}'
            self.assertEqual(report['status'],'Draft');self.assertEqual(intake.interviewer_id,source.user_id)
            listed=next(row for row in api.get('/api/case-transfers').json() if row['report_id']==report_id)
            self.assertEqual(len(listed['items']),1)
            self.assertEqual(api.post(path+'/submit').status_code,403)
            actor[0]=unrelated
            self.assertEqual(api.get(path).status_code,404)
            self.assertNotIn(report_id,[row['report_id'] for row in api.get('/api/case-transfers').json()])
            actor[0]=source
            response=api.post(path+'/submit');self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['status'],'Pending Receipt');self.assertEqual(intake.interviewer_id,source.user_id)
            self.assertEqual(api.post('/api/case-transfers',json=payload).status_code,409)
            self.assertEqual(api.post(path+'/confirm').status_code,404)
            actor[0]=recipient
            response=api.post(path+'/return',json={'remarks':'FICTIONAL: review report details'})
            self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json()['status'],'Returned for Correction')
            actor[0]=source
            payload['remarks']='FICTIONAL corrected draft'
            response=api.patch(path,json=payload);self.assertEqual(response.status_code,200,response.text)
            response=api.post(path+'/submit');self.assertEqual(response.status_code,200,response.text)
            actor[0]=recipient
            case.status_of_case='Terminated';db.flush()
            self.assertEqual(api.post(path+'/confirm').status_code,409)
            case.status_of_case='Pending';db.flush()
            response=api.post(path+'/confirm');self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['status'],'Completed');db.refresh(case);db.refresh(intake)
            self.assertEqual(intake.interviewer_id,recipient.user_id);self.assertEqual(case.assigned_pao,recipient.full_name)
            self.assertEqual(api.get(path).json()['items'][0]['case_id'],case.case_id)
            self.assertEqual(api.post(path+'/confirm').status_code,409)
        finally:
            main.app.dependency_overrides.clear();db.close();transaction.rollback();connection.close()
