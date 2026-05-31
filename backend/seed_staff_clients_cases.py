from __future__ import annotations

from datetime import datetime, timedelta, timezone

import models
from database import SessionLocal
from main import hash_password, seed_roles, write_audit


STAFF_EMAIL = "legal.staff@jurisguard.local"
STAFF_PASSWORD = "StaffPass123!"

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
}

URBAN_BARANGAYS = {"Gredu", "New Pandan", "Santo Nino", "San Vicente", "New Visayas"}

STAFF_CASES = [
    ("Ramil Estrella", 38, "Male", "Married", "Gredu", "Theft", "People vs. Estrella", "STAFF-CRM-2026-001", "Active"),
    ("Joanna Mae Rivera", 31, "Female", "Single", "New Pandan", "Physical Injury", "Rivera vs. Dacumos", "STAFF-CRM-2026-002", "Pending"),
    ("Edgar Colina", 44, "Male", "Married", "San Francisco", "Illegal Drugs", "People vs. Colina", "STAFF-CRM-2026-003", "Active"),
    ("Mylene Abad", 29, "Female", "Single", "Santo Nino", "VAWC", "Abad vs. Abad", "STAFF-CRM-2026-004", "Active"),
    ("Tomas Banzon", 52, "Male", "Widowed", "San Vicente", "Estafa", "Banzon vs. Mercado", "STAFF-CRM-2026-005", "Terminated"),
    ("Clarissa Dinopol", 35, "Female", "Married", "J. P. Laurel", "Grave Threats", "Dinopol vs. Santos", "STAFF-CRM-2026-006", "Pending"),
    ("Nelson Pableo", 27, "Male", "Single", "New Visayas", "Robbery", "People vs. Pableo", "STAFF-CRM-2026-007", "Active"),
    ("Rowena Lapuz", 40, "Female", "Separated", "Cagangohan", "Malicious Mischief", "Lapuz vs. Flores", "STAFF-CRM-2026-008", "Pending"),
    ("Arnold Quibol", 33, "Male", "Single", "Little Panay", "Reckless Imprudence", "People vs. Quibol", "STAFF-CRM-2026-009", "Active"),
    ("Faith Gonzales", 26, "Female", "Single", "San Pedro", "Child Abuse", "Gonzales vs. De Vera", "STAFF-CRM-2026-010", "Terminated"),
]


def get_role_id(db, role_name: str) -> int:
    role = db.query(models.Role).filter(models.Role.role_name == role_name).first()
    if not role and role_name == "staff":
        role = db.query(models.Role).filter(models.Role.role_name == "user").first()
    if not role:
        role = models.Role(role_name=role_name, permissions="clients,cases,documents")
        db.add(role)
        db.flush()
    return role.role_id


def get_or_create_staff(db) -> models.User:
    seed_roles()
    staff = db.query(models.User).filter(models.User.email == STAFF_EMAIL).first()
    if staff:
        staff.approval_status = "approved"
        staff.is_active = True
        return staff

    staff = models.User(
        role_id=get_role_id(db, "staff"),
        username="legal-staff-demo",
        email=STAFF_EMAIL,
        full_name="Legal Staff Demo",
        password_hash=hash_password(STAFF_PASSWORD),
        approval_status="approved",
        is_active=True,
        profile_completed=True,
        first_name="Legal",
        last_name="Demo",
        mobile_number="0917-555-0198",
        address="PAO Panabo District Office",
        sex="Female",
        birth_date="1992-05-14",
    )
    db.add(staff)
    db.flush()
    return staff


def get_or_create_nature(db, name: str) -> models.CaseNature:
    row = db.query(models.CaseNature).filter(models.CaseNature.nature_name == name).first()
    if row:
        return row
    row = models.CaseNature(nature_name=name)
    db.add(row)
    db.flush()
    return row


def get_or_create_branch(db, name: str) -> models.CourtBranch:
    row = db.query(models.CourtBranch).filter(models.CourtBranch.branch_name == name).first()
    if row:
        return row
    row = models.CourtBranch(branch_name=name)
    db.add(row)
    db.flush()
    return row


def seed_staff_clients_cases() -> None:
    db = SessionLocal()
    try:
        staff = get_or_create_staff(db)
        branch = get_or_create_branch(db, "PAO Panabo Case Intake Desk")
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        inserted = 0
        skipped = 0

        for index, (name, age, sex, civil_status, barangay, nature, title, case_no, status) in enumerate(STAFF_CASES, start=1):
            if db.query(models.Case).filter(models.Case.case_no == case_no).first():
                skipped += 1
                continue

            created_at = now - timedelta(days=index * 4)
            lat, lng = BARANGAY_COORDINATES[barangay]
            is_people_case = title.lower().startswith("people")
            terminated = status == "Terminated"
            case_nature = get_or_create_nature(db, nature)

            client = models.Client(
                name=name,
                age=age,
                sex=sex,
                civil_status=civil_status,
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
                    address=f"Purok {index}, {barangay}, Panabo City",
                    contact_no=f"0917-700-{index:04d}",
                    email=f"staff.client.{index:02d}@example.test",
                    individual_monthly_income="Below PHP 15,000",
                    detained=is_people_case and nature in {"Illegal Drugs", "Robbery"},
                    detained_since=created_at if is_people_case and nature in {"Illegal Drugs", "Robbery"} else None,
                    place_of_detention="Panabo City Police Station" if is_people_case and nature in {"Illegal Drugs", "Robbery"} else "",
                )
            )
            db.add(
                models.ClientClassification(
                    client_id=client.client_id,
                    class_urban=barangay in URBAN_BARANGAYS,
                    class_rural=barangay not in URBAN_BARANGAYS,
                    class_female=sex == "Female",
                    class_woman=sex == "Female",
                    class_drug_related=nature == "Illegal Drugs",
                    class_vawc_victim=nature == "VAWC",
                    classification_notes="Seeded staff demo client for Monday presentation.",
                )
            )

            intake = models.IntakeRecord(
                client_id=client.client_id,
                interviewer_id=staff.user_id,
                control_no=f"STAFF-PAN-2026-{index:04d}",
                form_date=created_at,
                region="XI",
                district_office="PAO Panabo District Office",
                party_represented="Accused" if is_people_case else "Complainant",
                applicant_role="Accused" if is_people_case else "Complainant",
                nature_of_request="Legal advice and representation",
                nature_of_case=nature,
            )
            db.add(intake)
            db.flush()

            db.add(models.Representative(intake_id=intake.intake_id, rep_name="Not applicable"))
            db.add(
                models.AdverseParty(
                    intake_id=intake.intake_id,
                    role_plaintiff_complainant=not is_people_case,
                    role_defendant_respondent_accused=is_people_case,
                    role_oppositor_others=False,
                    name="Adverse party on record",
                    address="Panabo City",
                )
            )

            case = models.Case(
                intake_id=intake.intake_id,
                client_id=client.client_id,
                nature_id=case_nature.nature_id,
                branch_id=branch.branch_id,
                title_of_case=title,
                case_no=case_no,
                court_body=branch.branch_name,
                status_of_case=status,
                case_status=status,
                incident_barangay=barangay,
                incident_city="Panabo City",
                incident_address=f"Purok {index}, {barangay}, Panabo City",
                latitude=f"{lat:.4f}",
                longitude=f"{lng:.4f}",
                last_action_taken="Initial staff intake encoded and ready for review.",
                location_type="Urban" if barangay in URBAN_BARANGAYS else "Rural",
                cause_of_action=nature,
                facts_of_case=f"Demo facts for {nature.lower()} case handled by legal staff.",
                pending_in_court=status != "Terminated",
                assigned_pao="Atty. Staff Demo",
                hearing_schedule=(created_at + timedelta(days=14)).strftime("%Y-%m-%d 09:00 AM"),
                remarks="Seeded staff case for presentation testing.",
                is_terminated=terminated,
                terminated_at=created_at + timedelta(days=10) if terminated else None,
                date_of_termination=created_at + timedelta(days=10) if terminated else None,
                termination_reason="Closed after settlement or completion." if terminated else None,
                cause_of_termination="Closed after settlement or completion." if terminated else None,
                termination_remarks="Seeded terminated case." if terminated else "",
                resolution_type="Closed" if terminated else "",
                handled_by="Atty. Staff Demo",
                last_updated=created_at + timedelta(hours=6),
            )
            db.add(case)
            db.flush()

            db.add(
                models.Document(
                    case_id=case.case_id,
                    intake_id=intake.intake_id,
                    uploaded_by=staff.user_id,
                    document_type="PAO Intake Form",
                    encrypted_file_path=f"uploads/demo/staff-case-{index:02d}.pdf",
                    ocr_status="COMPLETED",
                    uploaded_at=created_at + timedelta(hours=1),
                )
            )
            db.add(
                models.CaseHistory(
                    case_id=case.case_id,
                    updated_by=staff.user_id,
                    previous_status=None,
                    new_status=status,
                    action_taken="Seeded staff case created",
                    remarks="Initial presentation seed.",
                    created_at=created_at + timedelta(minutes=15),
                )
            )
            write_audit(
                db,
                staff.user_id,
                "Seed Staff Case",
                "case",
                f"Seeded staff case {case_no} for {name}",
                str(case.case_id),
            )
            inserted += 1

        db.commit()
        print(f"Staff demo account: {STAFF_EMAIL} / {STAFF_PASSWORD}")
        print(f"Inserted {inserted} staff case record(s); skipped {skipped} duplicate(s).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_staff_clients_cases()
