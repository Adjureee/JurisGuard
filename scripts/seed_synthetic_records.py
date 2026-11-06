"""Seed 100 visibly synthetic clients/cases; default is a read-only preview.

Run with backend/venv/Scripts/python.exe scripts/seed_synthetic_records.py --apply.
No OCR predictions or real document scans are fabricated. Existing rows are never updated.
"""
import argparse
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from database import SessionLocal, engine
import models
from sqlalchemy import func, select

BATCH = 'SYN100-20261106'
AS_OF = datetime(2026, 11, 6, 9)
LOCATIONS = [
    'Brgy. Central, Mati City', 'Brgy. Aplaya, Digos City',
    'Brgy. Visayan Village, Tagum City', 'Brgy. Gredu, Panabo City',
    'Brgy. Tibungco, Davao City', 'Brgy. New Visayas, Panabo City',
    'Brgy. Poblacion, Carmen, Davao del Norte', 'Brgy. Poblacion, New Corella',
]


def backup_database():
    destination = ROOT / '.local' / 'backups' / f'before-{BATCH}-{datetime.now():%Y%m%d-%H%M%S}.dump'
    destination.parent.mkdir(parents=True, exist_ok=True)
    binary = ROOT / '.local' / 'pgsql' / 'bin' / 'pg_dump.exe'
    url = engine.url
    if url.host not in ('localhost', '127.0.0.1', '::1'):
        raise RuntimeError('This seeder only supports the local database.')
    env = {**os.environ, 'PGPASSWORD': url.password or ''}
    result = subprocess.run([str(binary), '-h', url.host, '-p', str(url.port or 5432),
        '-U', url.username, '-d', url.database, '-Fc', '-f', str(destination)],
        env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Database backup failed; no records inserted.')
    return str(destination.relative_to(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--owner-id', type=int)
    args = parser.parse_args()
    if (ROOT / '.local/synthetic-records/FICTIONAL-XI-20261106-V2/manifest.json').exists():
        raise RuntimeError('This batch has been replaced by the fictional Region XI demo; no old placeholders will be reinserted.')
    with SessionLocal() as db:
        owners = db.scalars(select(models.User).where(models.User.is_active.is_(True),
            models.User.approval_status == 'approved')).all()
        owner_ids = [user.user_id for user in owners]
        owner = args.owner_id or (owner_ids[0] if len(owner_ids) == 1 else None)
        if owner not in owner_ids:
            raise RuntimeError('Specify --owner-id for an existing active approved user.')
        existing = db.scalar(select(func.count()).select_from(models.IntakeRecord)
            .where(models.IntakeRecord.control_no.like(BATCH + '-%')))
        before = {name: db.scalar(select(func.count()).select_from(model))
            for name, model in [('clients', models.Client), ('cases', models.Case)]}
    if existing:
        if existing == 100:
            print(json.dumps({'batch': BATCH, 'already_seeded': True, 'inserted': 0}))
            return
        raise RuntimeError('A partial/colliding batch exists; no rows changed.')
    summary = {'batch': BATCH, 'owner_id': owner, 'new_clients': 100, 'new_cases': 100,
        'criminal': 70, 'civil': 30, 'pending': 80, 'terminated': 20, 'before': before}
    if not args.apply:
        print(json.dumps({'preview_only': True, **summary}, indent=2))
        return
    backup = backup_database()
    manifest = []
    with SessionLocal.begin() as db:
        for i in range(1, 101):
            criminal = i <= 70
            terminated = i % 5 == 0
            uncertain = i % 11 == 0
            representative = i % 4 == 0
            detained = criminal and i % 3 == 0
            age = None if uncertain else [17, 22, 31, 45, 64, 72][i % 6]
            sex = '' if uncertain else ['Male', 'Female'][i % 2]
            date = AS_OF - timedelta(days=(i * 13) % 360)
            closed = min(date + timedelta(days=20), AS_OF) if terminated else None
            address = '' if i % 10 == 0 else f'SYNTHETIC Block {i:03}, {LOCATIONS[i % len(LOCATIONS)]}'
            name = f'SYNTHETIC Test Client {i:03}'
            location = 'Urban' if i % 2 else 'Rural'
            contact = '' if i % 10 == 0 else f'0000000{i:04}'
            client = models.Client(created_by_user_id=owner, name=name, age=age, sex=sex,
                civil_status='Single' if i % 2 else 'Married', religion='SYNTHETIC religion',
                educational_attainment='SYNTHETIC education', citizenship='Filipino',
                language_dialect=['Cebuano', 'Filipino', 'English'][i % 3], created_at=date)
            client.details = models.ClientDetails(address=address, contact_no=contact,
                email=f'client-{i:03}@synthetic.invalid', individual_monthly_income=str(5000 + i * 100),
                representative_name=f'SYNTHETIC Representative {i:03}' if representative else '',
                representative_age=40 if representative else None,
                representative_sex='Female' if representative else '',
                representative_civil_status='Married' if representative else '',
                representative_address=address if representative else '',
                representative_contact_no=f'0000001{i:04}' if representative else '',
                representative_relationship='Sister' if representative else '',
                representative_email=f'representative-{i:03}@synthetic.invalid' if representative else '',
                detained=None if uncertain else detained,
                detained_since=date - timedelta(days=7) if detained else None,
                place_of_detention='SYNTHETIC detention facility' if detained else '')
            client.classification = models.ClientClassification(flags_reviewed=not uncertain,
                class_female=None if uncertain else sex == 'Female',
                class_senior_citizen=None if uncertain else age >= 60,
                class_cicl=None if uncertain else age < 18,
                class_urban=location == 'Urban', class_rural=location == 'Rural',
                class_drug_related=criminal and i % 4 == 0,
                classification_notes=f'SYNTHETIC TEST DATA — {BATCH}; not a real legal record.')
            db.add(client)
            db.flush()
            role = 'Accused' if criminal else 'Plaintiff'
            intake = models.IntakeRecord(client_id=client.client_id, interviewer_id=owner,
                control_no=f'{BATCH}-{i:03}', form_date=date, region='Regional Office No. XI',
                district_office='Panabo City District Office', party_represented=role,
                applicant_role=role, nature_of_case='Criminal' if criminal else 'Civil',
                inv_accused=criminal, inv_plaintiff=not criminal)
            db.add(intake)
            db.flush()
            if representative:
                intake.representatives.append(models.Representative(
                    rep_name=client.details.representative_name,
                    rep_age=client.details.representative_age,
                    rep_sex=client.details.representative_sex,
                    civil_status=client.details.representative_civil_status,
                    rep_address=client.details.representative_address,
                    rep_contact_no=client.details.representative_contact_no,
                    relationship_to_applicant=client.details.representative_relationship))
            record = models.Case(client_id=client.client_id, intake_id=intake.intake_id,
                case_type='Criminal' if criminal else 'Civil', title_of_case=f'SYNTHETIC Case {i:03} — {name}',
                case_no=f'SYN-2026-{i:03}', court_body=['RTC-34', 'RTC-4', 'MTC'][i % 3],
                status_of_case='Terminated' if terminated else 'Pending',
                case_status='Terminated' if terminated else 'Pending',
                is_terminated=terminated, pending_in_court=not terminated,
                cause_of_action=f'SYNTHETIC {"criminal" if criminal else "civil"} category {i % 5 + 1}',
                facts_of_case='SYNTHETIC TEST SCENARIO ONLY. No actual incident or parties.',
                location_type=location, detained=None if uncertain else detained,
                date_of_confinement=date - timedelta(days=7) if detained else None,
                place_of_detention='SYNTHETIC detention facility' if detained else '',
                last_action_taken=['SYNTHETIC review scheduled', 'SYNTHETIC documents requested',
                    'SYNTHETIC hearing preparation'][i % 3], date_of_termination=closed,
                cause_of_termination='SYNTHETIC test disposition' if terminated else '',
                terminated_at=closed, terminated_by=owner if terminated else None,
                termination_reason='SYNTHETIC test disposition' if terminated else None,
                remarks=f'SYNTHETIC TEST DATA — {BATCH}', last_updated=closed or date)
            record.participants.append(models.CaseClient(client=client, party_represented=role,
                applicant_role=role, representative_name=client.details.representative_name,
                representative_age=client.details.representative_age,
                representative_sex=client.details.representative_sex,
                representative_civil_status=client.details.representative_civil_status,
                representative_address=client.details.representative_address,
                representative_contact_no=client.details.representative_contact_no,
                representative_relationship=client.details.representative_relationship,
                representative_email=client.details.representative_email))
            db.add(record)
            db.flush()
            record.history.append(models.CaseHistory(updated_by=owner, new_status=record.status_of_case,
                action_taken=f'SYNTHETIC TEST DATA seeded — {BATCH}', created_at=closed or date))
            manifest.append({'client_id': client.client_id, 'case_id': record.case_id,
                'intake_id': intake.intake_id, 'control_no': intake.control_no})
        assert len(manifest) == 100
    destination = ROOT / '.local' / 'synthetic-records' / f'{BATCH}.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({'backup': backup, **summary, 'records': manifest}, indent=2), encoding='utf-8')
    print(json.dumps({'committed': True, 'backup': backup, 'manifest': str(destination.relative_to(ROOT)), **summary}, indent=2))


if __name__ == '__main__':
    main()
