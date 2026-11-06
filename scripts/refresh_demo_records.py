"""Refresh ONLY the locally manifested synthetic batch. Preview unless --apply.

Preserves client/case/intake IDs; backs up all DB data and exact target rows.
Refuses targets linked to documents, reviewed scans, reports, or other cases.
"""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'scripts')]
from database import SessionLocal, engine
import models
from sqlalchemy import MetaData, select, delete, text
from seed_synthetic_records import backup_database
from region_xi_demo import BATCH, SOURCES, PLACES, fixture, validate

OLD_MANIFEST = ROOT / '.local/synthetic-records/SYN100-20261106.json'
OUTPUT = ROOT / '.local/synthetic-records' / BATCH
TARGETS = {'client': 'client_id', 'client_details': 'client_id', 'client_classification': 'client_id',
    'intake_record': 'intake_id', 'case': 'case_id', 'case_client': 'case_id',
    'case_history': 'case_id', 'representative': 'intake_id', 'adverse_party': 'intake_id'}


def fingerprint(rows):
    encoded = sorted(json.dumps(row, sort_keys=True, default=str, ensure_ascii=False) for row in rows)
    return hashlib.sha256('\n'.join(encoded).encode()).hexdigest()


def snapshots(connection, ids):
    metadata = MetaData()
    metadata.reflect(bind=connection)
    targets, protected = {}, {}
    for name, table in metadata.tables.items():
        records = [dict(row) for row in connection.execute(select(table)).mappings()]
        key = TARGETS.get(name)
        if key:
            scope = set(ids[key])
            targets[name] = [row for row in records if row[key] in scope]
            protected[name] = fingerprint([row for row in records if row[key] not in scope])
        else:
            # Presence/notification delivery may change while a real browser is open.
            # All account, auth configuration and document tables are included.
            if name not in ('user_presence', 'notification'):
                protected[name] = fingerprint(records)
    return targets, protected


def uploads_fingerprint():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for folder in ('uploads', 'backend/uploads') for p in (ROOT / folder).rglob('*') if p.is_file()}


def check_scope(db, manifest, ids):
    for item in manifest['records']:
        record = db.get(models.Case, item['case_id'])
        assert record and record.client_id == item['client_id'] and record.intake_id == item['intake_id']
        assert record.intake.control_no == item['control_no']
        assert record.client.name.startswith('SYNTHETIC Test Client ')
    for table, column in [('document','case_id'), ('document','intake_id'),
        ('reviewed_paper_intake','client_id'), ('case_submission_item','case_id'), ('case_transfer_item','case_id')]:
        count = db.execute(text(f'SELECT count(*) FROM "{table}" WHERE {column} = ANY(:ids)'), {'ids':ids[column]}).scalar()
        assert count == 0, f'Target linked to protected {table}; no replacement performed.'
    extra_cases = db.execute(text('SELECT count(*) FROM "case" WHERE client_id = ANY(:clients) AND NOT (case_id = ANY(:cases))'),
        {'clients':ids['client_id'], 'cases':ids['case_id']}).scalar()
    extra_intakes = db.execute(text('SELECT count(*) FROM intake_record WHERE client_id = ANY(:clients) AND NOT (intake_id = ANY(:intakes))'),
        {'clients':ids['client_id'], 'intakes':ids['intake_id']}).scalar()
    assert extra_cases == extra_intakes == 0


def refresh(db, rows, fixtures):
    case_ids = [row['case_id'] for row in rows]
    intake_ids = [row['intake_id'] for row in rows]
    db.execute(delete(models.CaseHistory).where(models.CaseHistory.case_id.in_(case_ids)))
    db.execute(delete(models.Representative).where(models.Representative.intake_id.in_(intake_ids)))
    db.execute(delete(models.AdverseParty).where(models.AdverseParty.intake_id.in_(intake_ids)))
    for item, f in zip(rows, fixtures):
        c = db.get(models.Client, item['client_id'])
        case = db.get(models.Case, item['case_id'])
        intake = db.get(models.IntakeRecord, item['intake_id'])
        owner = intake.interviewer_id
        for key, value in dict(name=f['name'], age=f['age'], sex=f['sex'], civil_status=f['civil_status'],
            religion=f['religion'], educational_attainment=f['education'], citizenship='Filipino',
            language_dialect=f['language'], created_at=f['interview']).items():
            setattr(c, key, value)
        details = c.details
        rep = f['representative']
        for key, value in dict(address=f['address'], contact_no=f['contact_no'], email=f['email'],
            individual_monthly_income=f['income'], spouse=f['spouse'],
            address_of_spouse=f['address'] if f['civil_status']=='Married' else 'N/A',
            contact_no_of_spouse=f'000-222-{f["index"]:04}' if f['civil_status']=='Married' else 'N/A',
            representative_name=rep['name'] if rep else '', representative_age=rep['age'] if rep else None,
            representative_sex=rep['sex'] if rep else '', representative_civil_status=rep['civil_status'] if rep else '',
            representative_address=rep['address'] if rep else '', representative_contact_no=rep['contact_no'] if rep else '',
            representative_relationship=rep['relationship'] if rep else '', representative_email=rep['email'] if rep else '',
            detained=f['detained'], detained_since=f['confined'], place_of_detention=f['facility']).items():
            setattr(details, key, value)
        flags = c.classification
        for key, value in dict(flags_reviewed=True, class_woman=f['sex']=='Female', class_female=f['sex']=='Female',
            class_senior_citizen=f['age']>=60, class_cicl=False, class_urban=f['location']=='Urban',
            class_rural=f['location']=='Rural', class_drug_related='dangerous drugs' in f['category'],
            class_9165='dangerous drugs' in f['category'], classification_notes=f['note']).items():
            setattr(flags, key, value)
        for key, value in dict(control_no=f['control_no'], form_date=f['received'],
            region='Regional Office No. XI', district_office='Region XI demonstration desk',
            party_represented=f['role'], applicant_role=f['role'], nature_of_case=f['case_type'],
            inv_accused=f['role']=='Accused', inv_plaintiff=f['role']=='Plaintiff', inv_petitioner=f['role']=='Petitioner').items():
            setattr(intake, key, value)
        if rep:
            db.add(models.Representative(intake_id=intake.intake_id, rep_name=rep['name'], rep_age=rep['age'],
                rep_sex=rep['sex'], civil_status=rep['civil_status'], rep_address=rep['address'],
                rep_contact_no=rep['contact_no'], relationship_to_applicant=rep['relationship']))
        for key, value in dict(case_type=f['case_type'], title_of_case=f['title'], case_no=f['case_no'],
            court_body=f['court'], status_of_case=f['status'], case_status=f['status'],
            last_action_taken=f['last_action'], detained=f['detained'], date_of_confinement=f['confined'],
            place_of_detention=f['facility'], location_type=f['location'], cause_of_action=f['category'],
            facts_of_case=f'Fictional {f["category"].lower()} representation scenario; no actual incident or court proceeding. Applicant {"represented by " + rep["relationship"].lower() if rep else "appeared personally"}.',
            pending_in_court=not f['terminated'], date_of_termination=f['closed'], cause_of_termination=f['resolution'],
            remarks=f['note'], terminated_at=f['closed'], termination_reason=f['resolution'],
            termination_remarks=f['note'] if f['terminated'] else '', resolution_type=f['resolution'],
            terminated_by=owner if f['terminated'] else None, is_terminated=f['terminated'], last_updated=f['last_date'],
            incident_barangay=None, incident_city=None, incident_address=None, latitude=None, longitude=None).items():
            setattr(case, key, value)
        assert len(case.participants)==1
        p = case.participants[0]
        p.party_represented = p.applicant_role = f['role']
        p.created_at = f['received']
        for target, source in [('representative_name','name'),('representative_age','age'),('representative_sex','sex'),
            ('representative_civil_status','civil_status'),('representative_address','address'),
            ('representative_contact_no','contact_no'),('representative_relationship','relationship'),('representative_email','email')]:
            setattr(p, target, rep[source] if rep else None if source=='age' else '')
        for date, action in f['events']:
            final = f['terminated'] and date==f['closed']
            db.add(models.CaseHistory(case_id=case.case_id, updated_by=owner,
                previous_status='Pending', new_status='Terminated' if final else 'Pending',
                action_taken=action, remarks=f'Fictional demonstration [{BATCH}]', created_at=date))
    db.flush()


def verify(db, rows, fixtures):
    for item, f in zip(rows, fixtures):
        db.expire_all()
        case = db.get(models.Case, item['case_id'])
        client = case.client
        assert client.name==f['name'] and case.intake.client_id==client.client_id
        assert case.intake.control_no==f['control_no'] and case.intake.form_date==f['received']
        assert client.created_at==f['interview'] and case.last_updated==f['last_date']
        assert case.is_terminated==f['terminated'] and case.pending_in_court!=case.is_terminated
        assert case.status_of_case==case.case_status==f['status']
        assert case.date_of_termination==f['closed'] and case.date_of_confinement==f['confined']
        assert client.details.detained==case.detained==f['detained']
        assert client.details.contact_no==f['contact_no'] and client.details.address==f['address']
        assert client.classification.class_urban==(case.location_type=='Urban')
        assert client.classification.class_rural==(case.location_type=='Rural')
        assert len(case.history)==len(f['events'])
        assert max(h.created_at for h in case.history)==case.last_updated
        assert len(case.participants)==1 and case.participants[0].client_id==client.client_id
        if f['representative']:
            assert len(case.intake.representatives)==1
            assert case.intake.representatives[0].rep_name==client.details.representative_name==case.participants[0].representative_name
            assert case.intake.representatives[0].rep_contact_no==client.details.representative_contact_no==case.participants[0].representative_contact_no
        else:
            assert not case.intake.representatives and not client.details.representative_name and not case.participants[0].representative_name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if (OUTPUT / 'manifest.json').exists():
        print(json.dumps({'already_refreshed':True,'dataset':BATCH,'changed':0}))
        return
    old = json.loads(OLD_MANIFEST.read_text())
    rows = old['records']
    ids = {key: [row[key] for row in rows] for key in ('client_id','case_id','intake_id')}
    fixtures = [fixture(i) for i in range(1,101)]
    validate(fixtures)
    with SessionLocal() as db:
        check_scope(db, old, ids)
    scope = {'dataset':BATCH,'replace_clients':100,'replace_cases':100,'new_additional_clients':0,
        'new_additional_cases':0,'case_types':dict(Counter(f['case_type'] for f in fixtures)),
        'statuses':dict(Counter(f['status'] for f in fixtures)),
        'representatives':sum(bool(f['representative']) for f in fixtures),
        'history_entries':sum(len(f['events']) for f in fixtures),
        'localities':len({f['city'] for f in fixtures}), 'barangays':len(PLACES),
        'geography':dict(Counter(f['location'] for f in fixtures))}
    if not args.apply:
        print(json.dumps({'preview':True,**scope},indent=2))
        return
    OUTPUT.mkdir(parents=True, exist_ok=True)
    backup = backup_database()
    files_before = uploads_fingerprint()
    with SessionLocal.begin() as db:
        check_scope(db, old, ids)
        target_before, protected_before = snapshots(db.connection(), ids)
        (OUTPUT / 'original-target-rows.json').write_text(json.dumps(target_before, default=str, ensure_ascii=False, indent=2),encoding='utf-8')
        refresh(db, rows, fixtures)
        verify(db, rows, fixtures)
        _, protected_after = snapshots(db.connection(), ids)
        assert protected_before==protected_after, 'Protected/unrelated database rows changed; transaction rolled back.'
        assert files_before==uploads_fingerprint(), 'Uploaded files changed; transaction rolled back.'
    with SessionLocal() as db:
        verify(db, rows, fixtures)
    report = {**scope, 'verified':True,'backup':backup,'protected_rows_unchanged':True,
        'uploaded_files_unchanged':True,'sources':SOURCES,'records':[
            {**item,'old_control_no':item['control_no'],'control_no':f['control_no'],
             'interview_date':f['interview'].isoformat(),'received_date':f['received'].isoformat(),
             'psgc_source':f['psgc_url'],'location_type':f['location']}
            for item,f in zip(rows,fixtures)]}
    (OUTPUT / 'manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('records','sources')},indent=2))


if __name__=='__main__':
    main()
