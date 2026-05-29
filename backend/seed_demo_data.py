from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import text

import models
from database import SessionLocal, engine
from main import hash_password, seed_roles


ADMIN_EMAIL = "admin@local.test"
ADMIN_PASSWORD = "SecretPass123"
STAFF_EMAIL = "staff@local.test"
STAFF_PASSWORD = "SecrePass123"

BARANGAY_COORDINATES = {
    "A. O. Floirendo": (7.3977, 125.5802),
    "Buenavista": (7.2756, 125.5907),
    "Cacao": (7.3083, 125.6077),
    "Cagangohan": (7.2815, 125.6829),
    "Consolacion": (7.3169, 125.5538),
    "Dapco": (7.3921, 125.5983),
    "Datu Abdul Dadia": (7.3153, 125.6548),
    "Gredu": (7.2957, 125.6776),
    "J. P. Laurel": (7.2759, 125.6700),
    "Kasilak": (7.3268, 125.5951),
    "Katipunan": (7.3007, 125.6306),
    "Katualan": (7.2301, 125.5543),
    "Kauswagan": (7.3102, 125.5831),
    "Kiotoy": (7.2443, 125.6077),
    "Little Panay": (7.2979, 125.6482),
    "Lower Panaga": (7.4320, 125.5640),
    "Mabunao": (7.2543, 125.5745),
    "Maduao": (7.2796, 125.6433),
    "Malativas": (7.2936, 125.5648),
    "Manay": (7.3456, 125.6022),
    "Nanyo": (7.3329, 125.6361),
    "New Malaga": (7.3442, 125.5725),
    "New Malitbog": (7.3339, 125.6209),
    "New Pandan": (7.2973, 125.6801),
    "New Visayas": (7.3081, 125.6682),
    "Quezon": (7.3327, 125.6795),
    "Salvacion": (7.3182, 125.6882),
    "San Francisco": (7.3068, 125.6803),
    "San Nicolas": (7.2626, 125.6181),
    "San Pedro": (7.2973, 125.7106),
    "San Roque": (7.2552, 125.5533),
    "San Vicente": (7.3088, 125.7003),
    "Santa Cruz": (7.2365, 125.5896),
    "Santo Nino": (7.3082, 125.6867),
    "Sindaton": (7.4396, 125.5842),
    "Southern Davao": (7.3323, 125.6577),
    "Tagpore": (7.2743, 125.6250),
    "Tibungol": (7.3947, 125.5555),
    "Upper Licanan": (7.2856, 125.6325),
    "Waterfall": (7.2886, 125.5834),
}


def reset_operational_data() -> None:
    tables = [
        "extracted_metadata",
        "document",
        "adverse_party",
        "representative",
        '"case"',
        "intake_record",
        "client_details",
        "client_classification",
        "client",
        "audit_log",
        '"user"',
        "case_nature",
        "court_branch",
    ]
    with engine.begin() as connection:
        connection.execute(text(f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE"))


def get_role_id(db, role_name: str) -> int:
    role = db.query(models.Role).filter(models.Role.role_name == role_name).first()
    if not role:
        raise RuntimeError(f"Missing role: {role_name}")
    return role.role_id


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


def seed_demo_data() -> None:
    seed_roles()
    reset_operational_data()
    seed_roles()

    db = SessionLocal()
    try:
        admin_role_id = get_role_id(db, "admin")
        staff_role_id = get_role_id(db, "staff")
        now = datetime.now()

        admin = models.User(
            role_id=admin_role_id,
            username="admin-local",
            email=ADMIN_EMAIL,
            full_name="PAO Panabo Administrator",
            password_hash=hash_password(ADMIN_PASSWORD),
            approval_status="approved",
            is_active=True,
            profile_completed=True,
            first_name="PAO",
            last_name="Administrator",
            mobile_number="0917-000-1000",
            address="Public Attorney's Office, Panabo City",
            sex="Female",
            birth_date="1985-04-12",
        )
        staff = models.User(
            role_id=staff_role_id,
            username="staff-local",
            email=STAFF_EMAIL,
            full_name="Maria Santos - Staff Encoder",
            password_hash=hash_password(STAFF_PASSWORD),
            approval_status="approved",
            is_active=True,
            profile_completed=True,
            first_name="Maria",
            last_name="Santos",
            mobile_number="0917-000-2000",
            address="Gredu, Panabo City",
            sex="Female",
            birth_date="1992-09-18",
        )
        db.add_all([admin, staff])
        db.flush()

        def set_intake_time(value: datetime, seed: int) -> datetime:
            hours = [8, 9, 9, 10, 10, 11, 13, 14, 15, 16]
            return value.replace(
                hour=hours[seed % len(hours)],
                minute=(seed * 7) % 45,
                second=0,
                microsecond=0,
            )

        natures = [
            models.CaseNature(nature_name="Theft"),
            models.CaseNature(nature_name="Physical Injury"),
            models.CaseNature(nature_name="Drug Related"),
            models.CaseNature(nature_name="Estafa"),
            models.CaseNature(nature_name="VAWC"),
        ]
        branches = [
            models.CourtBranch(branch_name="MTCC Panabo Branch 1"),
            models.CourtBranch(branch_name="RTC Panabo Branch 4"),
            models.CourtBranch(branch_name="Prosecutor's Office - Panabo"),
        ]
        db.add_all(natures + branches)
        db.flush()

        demo_rows = [
            {
                "name": "Juan Dela Cruz",
                "age": 34,
                "sex": "Male",
                "civil_status": "Married",
                "barangay": "Gredu",
                "address": "Purok 4, Gredu, Panabo City",
                "contact": "0917-321-1001",
                "category": "Theft",
                "title": "People of the Philippines vs. Juan Dela Cruz",
                "case_no": "CRM-2026-001",
                "status": "Active",
                "date": now - timedelta(days=3),
                "lat": "7.3087",
                "lng": "125.6951",
            },
            {
                "name": "Ana Mae Caballero",
                "age": 29,
                "sex": "Female",
                "civil_status": "Single",
                "barangay": "New Pandan",
                "address": "Block 2, New Pandan, Panabo City",
                "contact": "0917-321-1002",
                "category": "Physical Injury",
                "title": "Caballero vs. Rivera",
                "case_no": "CRM-2026-002",
                "status": "Ongoing",
                "date": now - timedelta(days=8),
                "lat": "7.2973",
                "lng": "125.6731",
            },
            {
                "name": "Roberto Manlangit",
                "age": 41,
                "sex": "Male",
                "civil_status": "Separated",
                "barangay": "San Francisco",
                "address": "Purok 7, San Francisco, Panabo City",
                "contact": "0917-321-1003",
                "category": "Drug Related",
                "title": "People of the Philippines vs. Roberto Manlangit",
                "case_no": "CRM-2026-003",
                "status": "Pending",
                "date": now - timedelta(days=16),
                "lat": "7.2772",
                "lng": "125.7036",
            },
            {
                "name": "Lorna Villanueva",
                "age": 38,
                "sex": "Female",
                "civil_status": "Married",
                "barangay": "Santo Nino",
                "address": "Santo Nino, Panabo City",
                "contact": "0917-321-1004",
                "category": "VAWC",
                "title": "Villanueva vs. Villanueva",
                "case_no": "CRM-2026-004",
                "status": "Active",
                "date": now - timedelta(days=27),
                "lat": "7.3289",
                "lng": "125.6928",
            },
            {
                "name": "Mark Anthony Salcedo",
                "age": 26,
                "sex": "Male",
                "civil_status": "Single",
                "barangay": "New Visayas",
                "address": "Purok 2, New Visayas, Panabo City",
                "contact": "0917-321-1005",
                "category": "Estafa",
                "title": "Salcedo vs. Mercado",
                "case_no": "CRM-2026-005",
                "status": "Terminated",
                "date": now - timedelta(days=42),
                "lat": "7.3184",
                "lng": "125.7042",
                "termination_reason": "Settlement reached after mediation",
            },
            {
                "name": "Nelia Bactol",
                "age": 52,
                "sex": "Female",
                "civil_status": "Widowed",
                "barangay": "Cagangohan",
                "address": "Cagangohan, Panabo City",
                "contact": "0917-321-1006",
                "category": "Theft",
                "title": "People of the Philippines vs. Nelia Bactol",
                "case_no": "CRM-2026-006",
                "status": "Terminated",
                "date": now - timedelta(days=70),
                "lat": "7.2815",
                "lng": "125.6829",
                "termination_reason": "Case dismissed by court order",
            },
            {
                "name": "Edgar Lumantas",
                "age": 45,
                "sex": "Male",
                "civil_status": "Married",
                "barangay": "Little Panay",
                "address": "Little Panay, Panabo City",
                "contact": "0917-321-1007",
                "category": "Physical Injury",
                "title": "Lumantas vs. Soriano",
                "case_no": "CRM-2026-007",
                "status": "Ongoing",
                "date": now - timedelta(days=96),
                "lat": "7.3311",
                "lng": "125.7273",
            },
            {
                "name": "Rosalie Dapitan",
                "age": 31,
                "sex": "Female",
                "civil_status": "Single",
                "barangay": "Lower Panaga",
                "address": "Lower Panaga, Panabo City",
                "contact": "0917-321-1008",
                "category": "Estafa",
                "title": "Dapitan vs. Sales",
                "case_no": "CRM-2026-008",
                "status": "Active",
                "date": now - timedelta(days=123),
                "lat": "7.3174",
                "lng": "125.6748",
            },
        ]
        demo_rows.extend(
            [
                {
                    "name": "Carlo Batucan",
                    "age": 22,
                    "sex": "Male",
                    "civil_status": "Single",
                    "barangay": "San Pedro",
                    "address": "Purok 5, San Pedro, Panabo City",
                    "contact": "0917-321-1009",
                    "category": "Drug Related",
                    "title": "People of the Philippines vs. Carlo Batucan",
                    "case_no": "CRM-2026-009",
                    "status": "Active",
                    "date": now - timedelta(days=5),
                    "lat": "7.3128",
                    "lng": "125.7064",
                },
                {
                    "name": "Michelle Ocampo",
                    "age": 36,
                    "sex": "Female",
                    "civil_status": "Married",
                    "barangay": "Quezon",
                    "address": "Quezon, Panabo City",
                    "contact": "0917-321-1010",
                    "category": "VAWC",
                    "title": "Ocampo vs. Ocampo",
                    "case_no": "CRM-2026-010",
                    "status": "Ongoing",
                    "date": now - timedelta(days=11),
                    "lat": "7.2713",
                    "lng": "125.6547",
                },
                {
                    "name": "Ramon Castillo",
                    "age": 47,
                    "sex": "Male",
                    "civil_status": "Married",
                    "barangay": "Dapco",
                    "address": "Dapco, Panabo City",
                    "contact": "0917-321-1011",
                    "category": "Theft",
                    "title": "People of the Philippines vs. Ramon Castillo",
                    "case_no": "CRM-2026-011",
                    "status": "Pending",
                    "date": now - timedelta(days=19),
                    "lat": "7.3978",
                    "lng": "125.6542",
                },
                {
                    "name": "Jessa Mae Torres",
                    "age": 25,
                    "sex": "Female",
                    "civil_status": "Single",
                    "barangay": "Maduao",
                    "address": "Maduao, Panabo City",
                    "contact": "0917-321-1012",
                    "category": "Estafa",
                    "title": "Torres vs. Apolinario",
                    "case_no": "CRM-2026-012",
                    "status": "Active",
                    "date": now - timedelta(days=31),
                    "lat": "7.2856",
                    "lng": "125.6267",
                },
                {
                    "name": "Henry Malinis",
                    "age": 39,
                    "sex": "Male",
                    "civil_status": "Separated",
                    "barangay": "Malativas",
                    "address": "Malativas, Panabo City",
                    "contact": "0917-321-1013",
                    "category": "Physical Injury",
                    "title": "Malinis vs. Ortega",
                    "case_no": "CRM-2026-013",
                    "status": "Terminated",
                    "date": now - timedelta(days=58),
                    "lat": "7.3536",
                    "lng": "125.6334",
                    "termination_reason": "Complainant executed affidavit of desistance",
                },
                {
                    "name": "Aileen Paraiso",
                    "age": 44,
                    "sex": "Female",
                    "civil_status": "Widowed",
                    "barangay": "Cacao",
                    "address": "Cacao, Panabo City",
                    "contact": "0917-321-1014",
                    "category": "Theft",
                    "title": "People of the Philippines vs. Aileen Paraiso",
                    "case_no": "CRM-2026-014",
                    "status": "Ongoing",
                    "date": now - timedelta(days=77),
                    "lat": "7.2654",
                    "lng": "125.7109",
                },
                {
                    "name": "Dante Requina",
                    "age": 50,
                    "sex": "Male",
                    "civil_status": "Married",
                    "barangay": "Kasilak",
                    "address": "Kasilak, Panabo City",
                    "contact": "0917-321-1015",
                    "category": "Drug Related",
                    "title": "People of the Philippines vs. Dante Requina",
                    "case_no": "CRM-2026-015",
                    "status": "Terminated",
                    "date": now - timedelta(days=101),
                    "lat": "7.3927",
                    "lng": "125.6954",
                    "termination_reason": "Plea bargaining completed",
                },
                {
                    "name": "Grace Nabua",
                    "age": 33,
                    "sex": "Female",
                    "civil_status": "Married",
                    "barangay": "Kiotoy",
                    "address": "Kiotoy, Panabo City",
                    "contact": "0917-321-1016",
                    "category": "VAWC",
                    "title": "Nabua vs. Nabua",
                    "case_no": "CRM-2026-016",
                    "status": "Active",
                    "date": now - timedelta(days=136),
                    "lat": "7.3189",
                    "lng": "125.7147",
                },
                {
                    "name": "Joel Timkang",
                    "age": 28,
                    "sex": "Male",
                    "civil_status": "Single",
                    "barangay": "Mabunao",
                    "address": "Mabunao, Panabo City",
                    "contact": "0917-321-1017",
                    "category": "Physical Injury",
                    "title": "Timkang vs. Aragon",
                    "case_no": "CRM-2026-017",
                    "status": "Pending",
                    "date": now - timedelta(days=156),
                    "lat": "7.3498",
                    "lng": "125.7286",
                },
                {
                    "name": "Patricia Lacuesta",
                    "age": 30,
                    "sex": "Female",
                    "civil_status": "Single",
                    "barangay": "Tagpore",
                    "address": "Tagpore, Panabo City",
                    "contact": "0917-321-1018",
                    "category": "Estafa",
                    "title": "Lacuesta vs. Padillo",
                    "case_no": "CRM-2026-018",
                    "status": "Ongoing",
                    "date": now - timedelta(days=181),
                    "lat": "7.3373",
                    "lng": "125.7462",
                },
                {
                    "name": "Sergio Aninon",
                    "age": 57,
                    "sex": "Male",
                    "civil_status": "Married",
                    "barangay": "Upper Licanan",
                    "address": "Upper Licanan, Panabo City",
                    "contact": "0917-321-1019",
                    "category": "Theft",
                    "title": "People of the Philippines vs. Sergio Aninon",
                    "case_no": "CRM-2026-019",
                    "status": "Active",
                    "date": now - timedelta(days=210),
                    "lat": "7.2894",
                    "lng": "125.7381",
                },
                {
                    "name": "Marites Lumaad",
                    "age": 48,
                    "sex": "Female",
                    "civil_status": "Married",
                    "barangay": "Waterfall",
                    "address": "Waterfall, Panabo City",
                    "contact": "0917-321-1020",
                    "category": "VAWC",
                    "title": "Lumaad vs. Lumaad",
                    "case_no": "CRM-2026-020",
                    "status": "Terminated",
                    "date": now - timedelta(days=245),
                    "lat": "7.3742",
                    "lng": "125.7548",
                    "termination_reason": "Protection order issued and matter archived",
                },
            ]
        )

        nature_by_name = {nature.nature_name: nature for nature in natures}
        seeded_clients: dict[str, models.Client] = {}
        seeded_profiles: dict[str, dict] = {}
        for index, row in enumerate(demo_rows, start=1):
            row["date"] = set_intake_time(row["date"], index)
            lat, lng = BARANGAY_COORDINATES.get(row["barangay"], (float(row["lat"]), float(row["lng"])))
            row["lat"] = f"{lat:.4f}"
            row["lng"] = f"{lng:.4f}"
            client = models.Client(
                name=row["name"],
                age=row["age"],
                sex=row["sex"],
                civil_status=row["civil_status"],
                religion="Roman Catholic",
                educational_attainment="High School Graduate",
                citizenship="Filipino",
                language_dialect="Cebuano",
                created_at=row["date"],
            )
            db.add(client)
            db.flush()
            seeded_clients[row["name"]] = client
            seeded_profiles[row["name"]] = row

            db.add(
                models.ClientDetails(
                    client_id=client.client_id,
                    address=row["address"],
                    contact_no=row["contact"],
                    email=f"client{index}@example.test",
                    individual_monthly_income="Below PHP 15,000",
                    spouse="Encoded spouse" if row["civil_status"] == "Married" else "",
                    representative_name="Legal representative on record",
                    representative_age=40,
                    representative_sex="Male",
                    representative_civil_status="Married",
                    representative_address="Panabo City",
                    representative_contact_no="0917-555-0100",
                    representative_relationship="Relative",
                    representative_email="representative@example.test",
                    detained=index in {3, 6},
                    detained_since=row["date"] if index in {3, 6} else None,
                    place_of_detention="Panabo City Police Station" if index in {3, 6} else "",
                )
            )
            db.add(
                models.ClientClassification(
                    client_id=client.client_id,
                    class_urban=row["barangay"] in {"Gredu", "New Pandan", "Santo Nino"},
                    class_rural=row["barangay"] not in {"Gredu", "New Pandan", "Santo Nino"},
                    class_female=row["sex"] == "Female",
                    class_drug_related=row["category"] == "Drug Related",
                    class_vawc_victim=row["category"] == "VAWC",
                    classification_notes="Demo client classification for PAO eligibility review.",
                )
            )

            intake = models.IntakeRecord(
                client_id=client.client_id,
                interviewer_id=staff.user_id,
                control_no=f"PAO-PAN-2026-{index:04d}",
                form_date=row["date"],
                region="XI",
                district_office="PAO Panabo District Office",
                party_represented="Accused" if "People" in row["title"] else "Complainant",
                applicant_role="Accused" if "People" in row["title"] else "Complainant",
                nature_of_request="Legal advice and representation",
                nature_of_case=row["category"],
            )
            db.add(intake)
            db.flush()

            db.add(
                models.Representative(
                    intake_id=intake.intake_id,
                    rep_name="Legal representative on record",
                    rep_age=40,
                    rep_sex="Male",
                    civil_status="Married",
                    rep_address="Panabo City",
                    rep_contact_no="0917-555-0100",
                    relationship_to_applicant="Relative",
                )
            )
            db.add(
                models.AdverseParty(
                    intake_id=intake.intake_id,
                    role_plaintiff_complainant=not ("People" in row["title"]),
                    role_defendant_respondent_accused="People" in row["title"],
                    name="Adverse party on record",
                    address="Panabo City",
                )
            )
            terminated = row["status"] == "Terminated"
            case = models.Case(
                intake_id=intake.intake_id,
                client_id=client.client_id,
                nature_id=nature_by_name[row["category"]].nature_id,
                branch_id=branches[index % len(branches)].branch_id,
                title_of_case=row["title"],
                case_no=row["case_no"],
                court_body=branches[index % len(branches)].branch_name,
                status_of_case=row["status"],
                case_status=row["status"],
                incident_barangay=row["barangay"],
                incident_city="Panabo City",
                incident_address=row["address"],
                latitude=row["lat"],
                longitude=row["lng"],
                last_action_taken="Initial interview completed and documents reviewed.",
                location_type="Urban" if row["barangay"] in {"Gredu", "New Pandan", "Santo Nino"} else "Rural",
                cause_of_action=row["category"],
                facts_of_case="Demo facts of case encoded for JurisGuard analytics testing.",
                pending_in_court=row["status"] in {"Active", "Ongoing"},
                assigned_pao="Atty. Renato Cruz",
                hearing_schedule=(row["date"] + timedelta(days=28)).strftime("%Y-%m-%d 09:00 AM"),
                remarks="Demo record for legal operations simulation.",
                is_terminated=terminated,
                terminated_at=row["date"] + timedelta(days=20) if terminated else None,
                date_of_termination=row["date"] + timedelta(days=20) if terminated else None,
                termination_reason=row.get("termination_reason"),
                cause_of_termination=row.get("termination_reason"),
                termination_remarks="Closed for demo archive workflow." if terminated else "",
                resolution_type="Closed" if terminated else "",
                terminated_by=admin.user_id if terminated else None,
                handled_by="Atty. Renato Cruz",
                last_updated=row["date"] + timedelta(days=2),
            )
            db.add(case)
            db.flush()

            db.add(
                models.Document(
                    case_id=case.case_id,
                    intake_id=intake.intake_id,
                    uploaded_by=staff.user_id,
                    document_type="PAO Intake Form" if index % 2 else "Barangay Certification",
                    encrypted_file_path=f"uploads/demo/document-{index}.pdf",
                    ocr_status="COMPLETED" if index not in {4, 7} else "FAILED",
                    uploaded_at=row["date"] + timedelta(hours=2),
                )
            )
            add_audit(
                db,
                staff.user_id,
                "Create Client",
                "client",
                f"{staff.full_name} created client {row['name']}",
                str(client.client_id),
                row["date"],
            )
            add_audit(
                db,
                staff.user_id,
                "Create Case",
                "case",
                f"{staff.full_name} created Criminal Case #{case.case_id}",
                str(case.case_id),
                row["date"] + timedelta(minutes=12),
            )
            add_audit(
                db,
                staff.user_id,
                "OCR Scan",
                "ocr",
                f"{staff.full_name} scanned supporting document for Criminal Case #{case.case_id}",
                str(case.case_id),
                row["date"] + timedelta(minutes=25),
            )
            if terminated:
                add_audit(
                    db,
                    admin.user_id,
                    "Terminate Case",
                    "case",
                    f"{admin.full_name} terminated Criminal Case #{case.case_id}",
                    str(case.case_id),
                    row["date"] + timedelta(days=20),
                )

        extra_case_rows = [
            {
                "client_name": "Juan Dela Cruz",
                "category": "Physical Injury",
                "title": "Dela Cruz vs. Barangay Respondent",
                "case_no": "CRM-2026-021",
                "status": "Ongoing",
                "date": now - timedelta(days=1),
            },
            {
                "client_name": "Juan Dela Cruz",
                "category": "Estafa",
                "title": "Dela Cruz vs. Lending Collector",
                "case_no": "CRM-2026-022",
                "status": "Pending",
                "date": now - timedelta(days=34),
            },
            {
                "client_name": "Ana Mae Caballero",
                "category": "VAWC",
                "title": "Caballero vs. Caballero",
                "case_no": "CRM-2026-023",
                "status": "Active",
                "date": now - timedelta(days=4),
            },
            {
                "client_name": "Roberto Manlangit",
                "category": "Theft",
                "title": "People vs. Roberto Manlangit II",
                "case_no": "CRM-2026-024",
                "status": "Terminated",
                "date": now - timedelta(days=88),
                "termination_reason": "Provisional dismissal granted",
            },
            {
                "client_name": "Lorna Villanueva",
                "category": "Physical Injury",
                "title": "Villanueva vs. Neighbor",
                "case_no": "CRM-2026-025",
                "status": "Ongoing",
                "date": now - timedelta(days=12),
            },
            {
                "client_name": "Rosalie Dapitan",
                "category": "Theft",
                "title": "People vs. Rosalie Dapitan",
                "case_no": "CRM-2026-026",
                "status": "Active",
                "date": now - timedelta(days=64),
            },
            {
                "client_name": "Edgar Lumantas",
                "category": "Estafa",
                "title": "Lumantas vs. Equipment Buyer",
                "case_no": "CRM-2026-027",
                "status": "Pending",
                "date": now - timedelta(days=22),
            },
            {
                "client_name": "Michelle Ocampo",
                "category": "Physical Injury",
                "title": "Ocampo vs. Household Member",
                "case_no": "CRM-2026-028",
                "status": "Terminated",
                "date": now - timedelta(days=52),
                "termination_reason": "Referral completed and records archived",
            },
            {
                "client_name": "Carlo Batucan",
                "category": "Drug Related",
                "title": "People vs. Carlo Batucan II",
                "case_no": "CRM-2026-029",
                "status": "Ongoing",
                "date": now - timedelta(days=7),
            },
            {
                "client_name": "Grace Nabua",
                "category": "VAWC",
                "title": "Nabua vs. Partner",
                "case_no": "CRM-2026-030",
                "status": "Active",
                "date": now - timedelta(days=15),
            },
        ]

        for extra_index, row in enumerate(extra_case_rows, start=len(demo_rows) + 1):
            row["date"] = set_intake_time(row["date"], extra_index)
            client = seeded_clients[row["client_name"]]
            profile = seeded_profiles[row["client_name"]]
            intake = models.IntakeRecord(
                client_id=client.client_id,
                interviewer_id=staff.user_id,
                control_no=f"PAO-PAN-2026-{extra_index:04d}",
                form_date=row["date"],
                region="XI",
                district_office="PAO Panabo District Office",
                party_represented="Accused" if row["title"].startswith("People") else "Complainant",
                applicant_role="Accused" if row["title"].startswith("People") else "Complainant",
                nature_of_request="Follow-up legal assistance and representation",
                nature_of_case=row["category"],
            )
            db.add(intake)
            db.flush()
            db.add(
                models.Representative(
                    intake_id=intake.intake_id,
                    rep_name="Same representative on client file",
                    rep_age=40,
                    rep_sex="Male",
                    civil_status="Married",
                    rep_address="Panabo City",
                    rep_contact_no="0917-555-0100",
                    relationship_to_applicant="Relative",
                )
            )
            db.add(
                models.AdverseParty(
                    intake_id=intake.intake_id,
                    role_plaintiff_complainant=not row["title"].startswith("People"),
                    role_defendant_respondent_accused=row["title"].startswith("People"),
                    name="Additional adverse party on record",
                    address="Panabo City",
                )
            )
            terminated = row["status"] == "Terminated"
            case = models.Case(
                intake_id=intake.intake_id,
                client_id=client.client_id,
                nature_id=nature_by_name[row["category"]].nature_id,
                branch_id=branches[extra_index % len(branches)].branch_id,
                title_of_case=row["title"],
                case_no=row["case_no"],
                court_body=branches[extra_index % len(branches)].branch_name,
                status_of_case=row["status"],
                case_status=row["status"],
                incident_barangay=profile["barangay"],
                incident_city="Panabo City",
                incident_address=profile["address"],
                latitude=profile["lat"],
                longitude=profile["lng"],
                last_action_taken="Related case attached to existing client record.",
                location_type="Urban" if profile["barangay"] in {"Gredu", "New Pandan", "Santo Nino"} else "Rural",
                cause_of_action=row["category"],
                facts_of_case="Additional related matter for multi-case client simulation.",
                pending_in_court=row["status"] in {"Active", "Ongoing"},
                assigned_pao="Atty. Renato Cruz",
                hearing_schedule=(row["date"] + timedelta(days=21)).strftime("%Y-%m-%d 10:00 AM"),
                remarks="Related case under the same client profile.",
                is_terminated=terminated,
                terminated_at=row["date"] + timedelta(days=18) if terminated else None,
                date_of_termination=row["date"] + timedelta(days=18) if terminated else None,
                termination_reason=row.get("termination_reason"),
                cause_of_termination=row.get("termination_reason"),
                termination_remarks="Closed related matter for demo archive workflow." if terminated else "",
                resolution_type="Closed" if terminated else "",
                terminated_by=admin.user_id if terminated else None,
                handled_by="Atty. Renato Cruz",
                last_updated=row["date"] + timedelta(days=1),
            )
            db.add(case)
            db.flush()
            db.add(
                models.Document(
                    case_id=case.case_id,
                    intake_id=intake.intake_id,
                    uploaded_by=staff.user_id,
                    document_type="Supplemental Complaint" if extra_index % 2 else "Court Order",
                    encrypted_file_path=f"uploads/demo/document-{extra_index}.pdf",
                    ocr_status="COMPLETED" if extra_index % 4 else "FAILED",
                    uploaded_at=row["date"] + timedelta(hours=3),
                )
            )
            add_audit(
                db,
                staff.user_id,
                "Create Case",
                "case",
                f"{staff.full_name} attached related Criminal Case #{case.case_id} to {client.name}",
                str(case.case_id),
                row["date"] + timedelta(minutes=8),
            )
            add_audit(
                db,
                staff.user_id,
                "Update Client",
                "client",
                f"{staff.full_name} updated client history for {client.name}",
                str(client.client_id),
                row["date"] + timedelta(minutes=12),
            )
            add_audit(
                db,
                staff.user_id,
                "OCR Scan",
                "ocr",
                f"{staff.full_name} scanned related case document for Criminal Case #{case.case_id}",
                str(case.case_id),
                row["date"] + timedelta(minutes=30),
            )
            if terminated:
                add_audit(
                    db,
                    admin.user_id,
                    "Terminate Case",
                    "case",
                    f"{admin.full_name} terminated related Criminal Case #{case.case_id}",
                    str(case.case_id),
                    row["date"] + timedelta(days=18),
                )

        add_audit(db, admin.user_id, "Login", "user", f"{admin.full_name} signed in", str(admin.user_id), now - timedelta(hours=5))
        add_audit(db, admin.user_id, "Approved Registration", "user", f"{admin.full_name} approved staff account", str(staff.user_id), now - timedelta(days=2))
        add_audit(db, admin.user_id, "Export CSV", "export", f"{admin.full_name} exported administrative analytics report", "admin-export-demo", now - timedelta(days=1))
        add_audit(db, staff.user_id, "Login", "user", f"{staff.full_name} signed in", str(staff.user_id), now - timedelta(hours=2))
        add_audit(db, staff.user_id, "Export PDF", "export", f"{staff.full_name} exported personal staff report", "staff-export-demo", now - timedelta(hours=1))

        db.commit()
        print("Demo data reset and seeded successfully.")
        print(f"Admin: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        print(f"Staff: {STAFF_EMAIL} / {STAFF_PASSWORD}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_data()
