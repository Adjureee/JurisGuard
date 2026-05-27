from ai_service import JurisGuardExtractionEngine, spacy_extract_pao_fields


def main():
    sample_ocr = """
    Rehiyon XI District Office PAO Panabo
    Petsa: April 11, 2024
    Control No.: XI-PC-2024-01-584
    Ini-atas kay: Atty. Maria Reyes
    Mananayam: Atty. Juan Santos
    Ini-refer ni/Inindorso ng: Barangay Captain
    I. URI NG INIHIHINGI NG TULONG
    ☑ Legal Documentation Salaysay ☑ Administration of Oath Notaryo
    II. IMPORMASYON UKOL SA APLIKANTE
    Pangalan: John Lloyd C. Lozada Edad: 24 Sex: M Civil Status: Single
    III. URI NG KASO
    Criminal Civil
    VII. PROOF OF INDIGENCY
    Income Tax Return Certification from Barangay
    VIII-D. NAKAHAIN NA BA SA HUKUMAN? OO
    Pamagat at Docket No. ng Kaso: CR-12345
    Court/Body/Tribunal kung saan naka-file: RTC Branch 4
    """

    schema = JurisGuardExtractionEngine.__new__(JurisGuardExtractionEngine)._get_empty_schema()
    extracted = spacy_extract_pao_fields(sample_ocr, schema)

    expected = {
        "control_no": "XI-PC-2024-01-584",
        "petsa": "April 11, 2024",
        "assigned_to": "Atty. Maria Reyes",
        "mananayam": "Atty. Juan Santos",
        "referred_by": "Barangay Captain",
        "req_legal_doc": True,
        "req_oath": True,
        "case_type_criminal": True,
        "has_proof_itr": True,
        "has_proof_brgy": True,
        "is_filed_in_court": True,
        "case_docket_title": "CR-12345",
        "court_body": "RTC Branch 4",
        "extraction_mode": "OFFLINE_SPACY_RULES",
    }

    failures = []
    for key, value in expected.items():
        if extracted.get(key) != value:
            failures.append(f"{key}: expected {value!r}, got {extracted.get(key)!r}")

    if failures:
        print("spaCy extractor test failed:")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)

    blank_template_sample = """
    Rehiyon District Office
    Petsa: April 11, 2024
    Control No.: XI-PC-2024-01-584
    Mananayam:
    (Pangalan at Lagda) Public Attorney
    I. URI NG INIHIHINGI NG TULONG
    Legal Documentation Salaysay Administration of Oath Notaryo
    """
    blank_result = spacy_extract_pao_fields(blank_template_sample, schema)
    blank_expected = {
        "rehiyon": None,
        "applicant_name": None,
        "mananayam": None,
        "req_legal_doc": False,
        "req_oath": False,
    }
    blank_failures = []
    for key, value in blank_expected.items():
        if blank_result.get(key) != value:
            blank_failures.append(f"{key}: expected {value!r}, got {blank_result.get(key)!r}")

    if blank_failures:
        print("spaCy blank-template guard test failed:")
        for failure in blank_failures:
            print(f"- {failure}")
        raise SystemExit(1)

    print("spaCy extractor test passed.")


if __name__ == "__main__":
    main()
