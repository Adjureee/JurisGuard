from __future__ import annotations

from datetime import datetime, timedelta

import models
from database import SessionLocal
from main import hash_password, seed_roles


STAFF_EMAIL = "geo.seed.staff@jurisguard.local"
STAFF_PASSWORD = "SecretPass123"

BARANGAY_COORDINATES = {
    "Gredu": (7.2957, 125.6776),
    "New Pandan": (7.2973, 125.6801),
    "San Francisco": (7.3068, 125.6803),
    "Santo Nino": (7.3082, 125.6867),
    "San Vicente": (7.3088, 125.7003),
    "J. P. Laurel": (7.2759, 125.6700),
    "New Visayas": (7.3081, 125.6682),
    "Cagangohan": (7.2815, 125.6829),
    "Little Panay": (7.2979, 125.6482),
    "San Pedro": (7.2973, 125.7106),
    "Maduao": (7.2796, 125.6433),
    "Tagpore": (7.2743, 125.6250),
    "Upper Licanan": (7.2856, 125.6325),
    "Quezon": (7.3327, 125.6795),
    "Salvacion": (7.3182, 125.6882),
}

URBAN_BARANGAYS = {"Gredu", "New Pandan", "Santo Nino", "San Vicente", "New Visayas"}

CASE_NATURES = [
    "Theft",
    "Robbery",
    "Physical Injury",
    "Estafa",
    "VAWC",
    "Illegal Drugs",
    "Malicious Mischief",
    "Grave Threats",
    "Reckless Imprudence",
    "Child Abuse",
]

COURT_BRANCHES = [
    "MTCC Panabo Branch 1",
    "MTCC Panabo Branch 2",
    "RTC Panabo Branch 4",
    "Prosecutor's Office - Panabo",
]

DEMO_CLIENT_CASES = [
    {
        "name": "Marvin Dela Cruz",
        "age": 34,
        "sex": "Male",
        "civil_status": "Married",
        "barangay": "Gredu",
        "address": "Purok 4, Gredu, Panabo City",
        "contact": "0917-410-2001",
        "nature": "Theft",
        "title": "People vs. Dela Cruz",
        "case_no": "JGV-CRM-2026-001",
        "status": "Active",
        "facts": "Client sought assistance after arraignment for alleged theft in a local market.",
        "last_action": "Interview completed; counter-affidavit and supporting documents reviewed.",
    },
    {
        "name": "Jessa Mae Villanueva",
        "age": 29,
        "sex": "Female",
        "civil_status": "Single",
        "barangay": "New Pandan",
        "address": "Block 2, New Pandan, Panabo City",
        "contact": "0917-410-2002",
        "nature": "Physical Injury",
        "title": "Villanueva vs. Soriano",
        "case_no": "JGV-CRM-2026-002",
        "status": "Pending",
        "facts": "Complainant requested legal assistance after a neighborhood altercation.",
        "last_action": "Scheduled for document completion and witness statement review.",
    },
    {
        "name": "Rolando Manlangit",
        "age": 41,
        "sex": "Male",
        "civil_status": "Separated",
        "barangay": "San Francisco",
        "address": "Purok 7, San Francisco, Panabo City",
        "contact": "0917-410-2003",
        "nature": "Illegal Drugs",
        "title": "People vs. Manlangit",
        "case_no": "JGV-CRM-2026-003",
        "status": "Active",
        "facts": "Accused requested PAO representation for a drug-related criminal complaint.",
        "last_action": "Case file encoded; detention and hearing details verified.",
        "detained": True,
        "place_of_detention": "Panabo City Police Station",
    },
    {
        "name": "Aileen Caballero",
        "age": 36,
        "sex": "Female",
        "civil_status": "Married",
        "barangay": "Santo Nino",
        "address": "Purok 1, Santo Nino, Panabo City",
        "contact": "0917-410-2004",
        "nature": "VAWC",
        "title": "Caballero vs. Caballero",
        "case_no": "JGV-CRM-2026-004",
        "status": "Active",
        "facts": "Client sought assistance involving alleged violence against women and children.",
        "last_action": "Protection order requirements explained and evidence checklist issued.",
    },
    {
        "name": "Dennis Salcedo",
        "age": 27,
        "sex": "Male",
        "civil_status": "Single",
        "barangay": "San Vicente",
        "address": "San Vicente, Panabo City",
        "contact": "0917-410-2005",
        "nature": "Estafa",
        "title": "Salcedo vs. Mercado",
        "case_no": "JGV-CRM-2026-005",
        "status": "Terminated",
        "facts": "Client requested assistance in a small-value estafa complaint.",
        "last_action": "Settlement documents reviewed and archived.",
        "termination_reason": "Settled through mediation.",
    },
    {
        "name": "Lorna Bactol",
        "age": 52,
        "sex": "Female",
        "civil_status": "Widowed",
        "barangay": "J. P. Laurel",
        "address": "J. P. Laurel, Panabo City",
        "contact": "0917-410-2006",
        "nature": "Grave Threats",
        "title": "Bactol vs. Ramos",
        "case_no": "JGV-CRM-2026-006",
        "status": "Pending",
        "facts": "Client reported repeated threats connected to a land boundary dispute.",
        "last_action": "Barangay blotter requested for verification.",
    },
    {
        "name": "Edgar Lumantas",
        "age": 45,
        "sex": "Male",
        "civil_status": "Married",
        "barangay": "New Visayas",
        "address": "Purok 2, New Visayas, Panabo City",
        "contact": "0917-410-2007",
        "nature": "Robbery",
        "title": "People vs. Lumantas",
        "case_no": "JGV-CRM-2026-007",
        "status": "Active",
        "facts": "Accused requested representation for a robbery complaint pending preliminary investigation.",
        "last_action": "Initial legal interview completed; next hearing logged.",
    },
    {
        "name": "Rosalie Dapitan",
        "age": 31,
        "sex": "Female",
        "civil_status": "Single",
        "barangay": "Cagangohan",
        "address": "Cagangohan, Panabo City",
        "contact": "0917-410-2008",
        "nature": "Malicious Mischief",
        "title": "Dapitan vs. Sales",
        "case_no": "JGV-CRM-2026-008",
        "status": "Terminated",
        "facts": "Client asked assistance after property damage allegedly caused by a neighbor.",
        "last_action": "Record closed after barangay settlement.",
        "termination_reason": "Resolved at barangay level.",
    },
    {
        "name": "Carlo Batucan",
        "age": 22,
        "sex": "Male",
        "civil_status": "Single",
        "barangay": "Little Panay",
        "address": "Little Panay, Panabo City",
        "contact": "0917-410-2009",
        "nature": "Illegal Drugs",
        "title": "People vs. Batucan",
        "case_no": "JGV-CRM-2026-009",
        "status": "Active",
        "facts": "Client requested legal representation after inquest proceedings.",
        "last_action": "Inquest referral encoded and detention status verified.",
        "detained": True,
        "place_of_detention": "Davao del Norte Provincial Jail",
    },
    {
        "name": "Michelle Ocampo",
        "age": 38,
        "sex": "Female",
        "civil_status": "Married",
        "barangay": "San Pedro",
        "address": "San Pedro, Panabo City",
        "contact": "0917-410-2010",
        "nature": "VAWC",
        "title": "Ocampo vs. Ocampo",
        "case_no": "JGV-CRM-2026-010",
        "status": "Pending",
        "facts": "Client sought consultation for possible VAWC filing and child support concerns.",
        "last_action": "Client advised to submit supporting documents and affidavits.",
    },
    {
        "name": "Ramon Castillo",
        "age": 47,
        "sex": "Male",
        "civil_status": "Married",
        "barangay": "Maduao",
        "address": "Maduao, Panabo City",
        "contact": "0917-410-2011",
        "nature": "Reckless Imprudence",
        "title": "People vs. Castillo",
        "case_no": "JGV-CRM-2026-011",
        "status": "Active",
        "facts": "Client requested assistance for a traffic-related criminal negligence complaint.",
        "last_action": "Police report and medical certificate reviewed.",
    },
    {
        "name": "Jessa Torres",
        "age": 25,
        "sex": "Female",
        "civil_status": "Single",
        "barangay": "Tagpore",
        "address": "Tagpore, Panabo City",
        "contact": "0917-410-2012",
        "nature": "Child Abuse",
        "title": "Torres vs. Respondent",
        "case_no": "JGV-CRM-2026-012",
        "status": "Pending",
        "facts": "Client requested assistance involving a child protection complaint.",
        "last_action": "Referred for completion of social worker certification.",
    },
    {
        "name": "Henry Malinis",
        "age": 39,
        "sex": "Male",
        "civil_status": "Separated",
        "barangay": "Upper Licanan",
        "address": "Upper Licanan, Panabo City",
        "contact": "0917-410-2013",
        "nature": "Physical Injury",
        "title": "Malinis vs. Ortega",
        "case_no": "JGV-CRM-2026-013",
        "status": "Terminated",
        "facts": "Client requested assistance for a physical injury complaint.",
        "last_action": "Dismissal order received and encoded.",
        "termination_reason": "Case dismissed by court order.",
    },
    {
        "name": "Aileen Paraiso",
        "age": 44,
        "sex": "Female",
        "civil_status": "Widowed",
        "barangay": "Quezon",
        "address": "Quezon, Panabo City",
        "contact": "0917-410-2014",
        "nature": "Theft",
        "title": "People vs. Paraiso",
        "case_no": "JGV-CRM-2026-014",
        "status": "Active",
        "facts": "Client requested representation for alleged theft of farm supplies.",
        "last_action": "Case assigned to handling lawyer.",
    },
    {
        "name": "Dante Requina",
        "age": 50,
        "sex": "Male",
        "civil_status": "Married",
        "barangay": "Salvacion",
        "address": "Salvacion, Panabo City",
        "contact": "0917-410-2015",
        "nature": "Estafa",
        "title": "Requina vs. Buyer",
        "case_no": "JGV-CRM-2026-015",
        "status": "Pending",
        "facts": "Client reported nonpayment after delivery of goods.",
        "last_action": "Demand letter and receipts requested.",
    },
]


def get_role_id(db, role_name: str) -> int:
    role = db.query(models.Role).filter(models.Role.role_name == role_name).first()
    if not role:
        raise RuntimeError(f"Missing role: {role_name}")
    return role.role_id


def get_or_create_seed_staff(db) -> models.User:
    seed_roles()
    staff = db.query(models.User).filter(models.User.email == STAFF_EMAIL).first()
    if staff:
        return staff

    staff = models.User(
        role_id=get_role_id(db, "staff"),
        username="geo-seed-staff",
        email=STAFF_EMAIL,
        full_name="Geo Demo Staff Encoder",
        password_hash=hash_password(STAFF_PASSWORD),
        approval_status="approved",
        is_active=True,
        profile_completed=True,
        first_name="Geo",
        last_name="Encoder",
        mobile_number="0917-000-3000",
        address="PAO Panabo District Office",
        sex="Female",
        birth_date="1990-01-15",
    )
    db.add(staff)
    db.flush()
    return staff


def get_or_create_case_nature(db, name: str) -> models.CaseNature:
    nature = db.query(models.CaseNature).filter(models.CaseNature.nature_name == name).first()
    if nature:
        return nature

    nature = models.CaseNature(nature_name=name)
    db.add(nature)
    db.flush()
    return nature


def get_or_create_court_branch(db, name: str) -> models.CourtBranch:
    branch = db.query(models.CourtBranch).filter(models.CourtBranch.branch_name == name).first()
    if branch:
        return branch

    branch = models.CourtBranch(branch_name=name)
    db.add(branch)
    db.flush()
    return branch


def add_audit(db, user_id: int, action: str, target: str, description: str, entity_id: str, timestamp: datetime) -> None:
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action,
            target_entity=target,
            description=description,
            entity_id=entity_id,
            timestamp=timestamp,
            ip_address="127.0.0.1",
        )
    )


def seed_realistic_criminal_cases() -> None:
    db = SessionLocal()
    try:
        staff = get_or_create_seed_staff(db)
        natures = {name: get_or_create_case_nature(db, name) for name in CASE_NATURES}
        branches = [get_or_create_court_branch(db, name) for name in COURT_BRANCHES]
        now = datetime.now().replace(second=0, microsecond=0)
        inserted = 0
        skipped = 0

        for index, row in enumerate(DEMO_CLIENT_CASES, start=1):
            existing = db.query(models.Case).filter(models.Case.case_no == row["case_no"]).first()
            if existing:
                skipped += 1
                continue

            created_at = now - timedelta(days=index * 5)
            barangay = row["barangay"]
            lat, lng = BARANGAY_COORDINATES[barangay]
            terminated = row["status"] == "Terminated"
            detained = bool(row.get("detained"))

            client = models.Client(
                name=row["name"],
                age=row["age"],
                sex=row["sex"],
                civil_status=row["civil_status"],
                religion="Roman Catholic",
                educational_attainment="High School Graduate",
                citizenship="Filipino",
                language_dialect="Cebuano",
                created_at=created_at,
            )
            db.add(client)
            db.flush()

            db.add(
                models.ClientDetails(
                    client_id=client.client_id,
                    address=row["address"],
                    contact_no=row["contact"],
                    email=f"demo.client.{index:02d}@example.test",
                    individual_monthly_income="Below PHP 15,000",
                    detained=detained,
                    detained_since=created_at if detained else None,
                    place_of_detention=row.get("place_of_detention", "") if detained else "",
                )
            )
            db.add(
                models.ClientClassification(
                    client_id=client.client_id,
                    class_urban=barangay in URBAN_BARANGAYS,
                    class_rural=barangay not in URBAN_BARANGAYS,
                    class_female=row["sex"] == "Female",
                    class_drug_related=row["nature"] == "Illegal Drugs",
                    class_vawc_victim=row["nature"] == "VAWC",
                    classification_notes="Realistic demo client for GeoAnalytics and criminal case workflow testing.",
                )
            )

            is_people_case = row["title"].startswith("People")
            intake = models.IntakeRecord(
                client_id=client.client_id,
                interviewer_id=staff.user_id,
                control_no=f"GEO-PAN-2026-{index:04d}",
                form_date=created_at,
                region="XI",
                district_office="PAO Panabo District Office",
                party_represented="Accused" if is_people_case else "Complainant",
                applicant_role="Accused" if is_people_case else "Complainant",
                nature_of_request="Legal advice and representation",
                nature_of_case=row["nature"],
            )
            db.add(intake)
            db.flush()

            db.add(
                models.AdverseParty(
                    intake_id=intake.intake_id,
                    role_plaintiff_complainant=not is_people_case,
                    role_defendant_respondent_accused=is_people_case,
                    name="Adverse party on record",
                    address="Panabo City",
                )
            )

            branch = branches[index % len(branches)]
            case = models.Case(
                intake_id=intake.intake_id,
                client_id=client.client_id,
                nature_id=natures[row["nature"]].nature_id,
                branch_id=branch.branch_id,
                title_of_case=row["title"],
                case_no=row["case_no"],
                court_body=branch.branch_name,
                status_of_case=row["status"],
                case_status=row["status"],
                incident_barangay=barangay,
                incident_city="Panabo City",
                incident_address=row["address"],
                latitude=f"{lat:.4f}",
                longitude=f"{lng:.4f}",
                last_action_taken=row["last_action"],
                date_of_confinement=created_at if detained else None,
                place_of_detention=row.get("place_of_detention", "") if detained else "",
                location_type="Urban" if barangay in URBAN_BARANGAYS else "Rural",
                cause_of_action=row["nature"],
                facts_of_case=row["facts"],
                pending_in_court=row["status"] in {"Active", "Pending"},
                assigned_pao="Atty. Renato Cruz",
                hearing_schedule=(created_at + timedelta(days=21)).strftime("%Y-%m-%d 09:00 AM"),
                remarks="Inserted by realistic criminal case seed script.",
                is_terminated=terminated,
                terminated_at=created_at + timedelta(days=18) if terminated else None,
                date_of_termination=created_at + timedelta(days=18) if terminated else None,
                termination_reason=row.get("termination_reason"),
                cause_of_termination=row.get("termination_reason"),
                termination_remarks="Closed for realistic demo testing." if terminated else "",
                resolution_type="Closed" if terminated else "",
                handled_by="Atty. Renato Cruz",
                last_updated=created_at + timedelta(days=2),
            )
            db.add(case)
            db.flush()

            db.add(
                models.Document(
                    case_id=case.case_id,
                    intake_id=intake.intake_id,
                    uploaded_by=staff.user_id,
                    document_type="PAO Intake Form",
                    encrypted_file_path=f"uploads/demo/realistic-case-{index:02d}.pdf",
                    ocr_status="COMPLETED",
                    uploaded_at=created_at + timedelta(hours=2),
                )
            )
            db.add(
                models.CaseHistory(
                    case_id=case.case_id,
                    updated_by=staff.user_id,
                    previous_status=None,
                    new_status=row["status"],
                    action_taken=row["last_action"],
                    remarks="Initial seeded case status.",
                    created_at=created_at + timedelta(minutes=15),
                )
            )
            add_audit(
                db,
                staff.user_id,
                "Seed Criminal Case",
                "case",
                f"Inserted realistic demo criminal case {row['case_no']} for {row['name']}",
                str(case.case_id),
                created_at + timedelta(minutes=20),
            )
            inserted += 1

        db.commit()
        print(f"Inserted {inserted} realistic criminal case record(s); skipped {skipped} duplicate(s).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_realistic_criminal_cases()
