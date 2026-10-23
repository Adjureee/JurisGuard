"""Synthetic examples only; these are not real PAO or court records."""

import unittest

from backend.inventory_mvp import (
    CLASSIFICATION_FIELDS,
    DATE_FIELDS,
    INVENTORY_FIELDS,
    DocumentRouter,
    empty_inventory,
)


ENGLISH_INTAKE = """INTERVIEW SHEET
Control No.: 0007-24
Name: Maria Santos
Sex: Female
Address: 12 Mabini Street, Manila
Contact No.: 0917-000-1234
Date of Confinement: February 13, 2024
Urban: [x]
Rural: [ ]
SENIOR: [?]
"""

TAGALOG_INTAKE = """INTERV1EW SHEET
Pangalan: Ana Reyes
Edad: 32
Tirahan: Barangay San Jose, Quezon City
Contact No.: 0998 001 2345
Kasarian: Babae
Nakakulong ba? Oo [ ] Hindi [x]
CICL: ☐
"""

RTC_DECISION = """REPUBLIC OF THE PHILIPPINES
REGIONAL TRIAL COURT
Branch 12
PEOPLE OF THE PHILIPPINES, Plaintiff,
-versus-
JUAN DELA CRUZ, Accused.
Criminal Case No. 00045-24
x-------------------x
DECISION
Promulgated on March 7, 2024.
"""

SANDIGANBAYAN_DECISION = """REPUBLIC OF THE PHILIPPINES
Sandiganbayan
Sixth Division
PEOPLE OF THE PHILIPPINES, Plaintiff
-versus-
A SAMPLE ACCUSED, Accused.
Criminal Case No. SB-22-CRM-0042
DECISION
The procedural history mentions the Regional Trial Court.
"""
SYNTHETIC_SANDIGANBAYAN_VARIANTS = (
    SANDIGANBAYAN_DECISION,
    "REPUBLIC OF THE PHILIPPINES\nSand1ganbayan\nPEOPLE OF THE PHILIPPINES\n-versus-\nA SAMPLE ACCUSED, Accused.\nCriminal Case No. SB-22-CRM-0042\nDECISION",
    "REPUBLIC OF THE PHILIPPINES\nPEOPLE OF THE PHILIPPINES\n-versus-\nA SAMPLE ACCUSED, Accused.\nCase No. SB-25-SCA-0007\nDECISION\nA Regional Trial Court was named as a respondent.",
)
OBSERVED_NONPERSONAL_OCR_FAILURE = "REPUBLIC OF THE PHILIPPINES\nSanbiganbapan\nSPECIAL SEVENTH DIVISION\nCase No. SR-23-CRM-0044\nPEOPLE OF THE PHILIPPINES\nAccused:\nDECISION"
SYNTHETIC_NOISY_HEADING_VARIANTS = (
    "REPUBLIC OF THE PHILIPPINES\nSanbiganbapan\nCase No. SR-24-CRM-0012\nPEOPLE OF THE PHILIPPINES\nDECISION\nThe Regional Trial Court was discussed in procedural history.",
    "Sanbiganbayan\nSpecial Fourth Division\nPEOPLE OF THE PHILIPPINES\n-versus-\nSAMPLE ACCUSED\nDECISION",
    "Sandiganbapan\nSixth Division\nCase No. SB-25-SCA-0007\nDECISION",
)
SYNTHETIC_ROUTING_NOISE_VARIANTS = (
    "REPUKLIC OF TIE PHILIFTINES\nSANDIGANBATAN\nPEOPLE OF THE PHILIPPINES_\nCASE No;\nDECISION",
    "REPUBLIC OF THE PHILIPPINES\n‘Sanbiganbapal\nSPECIAL SIXTH DIVISION\nPEOPLE OF THE PHILIPPINES\nDECISION",
    "REPUBLIC OF THE PHILIPPINES\nFOURTH DIVISION\nPEOPLE OF THE PHILIPPINES\nCase No. SB-25-AR-0039\nCebu City Regional Trial Court mentioned as lower court\nDECISION",
)


class DocumentRouterTests(unittest.TestCase):
    def setUp(self):
        self.router = DocumentRouter()

    def assert_schema(self, inventory):
        self.assertEqual(tuple(inventory), INVENTORY_FIELDS)
        self.assertEqual(len(inventory), 21)
        for field, value in inventory.items():
            if field in CLASSIFICATION_FIELDS:
                self.assertTrue(value is None or type(value) is bool, field)
            else:
                self.assertTrue(value is None or type(value) is str, field)
                if field in DATE_FIELDS and value is not None:
                    self.assertRegex(value, r"^\d{4}-\d{2}-\d{2}$")

    def test_sandiganbayan_is_routed_separately_from_rtc(self):
        for text in (OBSERVED_NONPERSONAL_OCR_FAILURE, *SYNTHETIC_SANDIGANBAYAN_VARIANTS, *SYNTHETIC_NOISY_HEADING_VARIANTS, *SYNTHETIC_ROUTING_NOISE_VARIANTS):
            with self.subTest(text=text.splitlines()[1]):
                result = self.router.process(text)
                self.assertEqual(result["document_type"], "sandiganbayan_document")
                self.assertEqual(self.router.extract_rtc_decision(text), empty_inventory())
                self.assertIsNotNone(result["diagnostics"]["out_of_scope_court_signal"])
                self.assertTrue(all(value is None for field, value in result["inventory"].items() if field != "Case No."))

    def test_rtc_heading_precedes_historical_sandiganbayan_reference(self):
        text = RTC_DECISION + "\nThe Sandiganbayan was mentioned in procedural history."
        self.assertEqual(self.router.classify_document(text), "rtc_decision")

    def test_competing_court_headings_require_review(self):
        text = "REPUBLIC OF THE PHILIPPINES\nSandiganbayan\nREGIONAL TRIAL COURT\nPEOPLE OF THE PHILIPPINES\nCase No. SB-25-CRM-0042\nDECISION"
        result = self.router.process(text)
        self.assertEqual(result["document_type"], "ambiguous")
        self.assertEqual(result["inventory"], empty_inventory())

    def test_english_intake(self):
        result = self.router.process(ENGLISH_INTAKE)
        self.assertEqual(result["document_type"], "intake_form")
        inventory = result["inventory"]
        self.assert_schema(inventory)
        self.assertEqual(inventory["Control Number"], "0007-24")
        self.assertEqual(inventory["Party Represented"], "Maria Santos")
        self.assertEqual(inventory["Gender/Sex"], "Female")
        self.assertEqual(inventory["Contact Number"], "0917-000-1234")
        self.assertEqual(inventory["Date of Confinement"], "2024-02-13")
        self.assertIs(inventory["Urban"], True)
        self.assertIs(inventory["Rural"], False)
        self.assertIsNone(inventory["SENIOR"])
        self.assertIsNone(inventory["Female"])
        self.assertTrue(result["needs_review"])
        self.assertIn("Party Represented", result["diagnostics"]["field_evidence"])
        self.assertNotIn("field_evidence", inventory)
        self.assertGreater(result["diagnostics"]["classification_scores"]["intake_form"], 0)

    def test_tagalog_intake_with_contextual_ocr_noise(self):
        result = self.router.process(TAGALOG_INTAKE)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")
        self.assertEqual(result["inventory"]["Contact Number"], "0998 001 2345")
        self.assertEqual(result["inventory"]["Gender/Sex"], "Babae")
        self.assertIs(result["inventory"]["CICL"], False)
        self.assertIsNone(result["inventory"]["Place of Detention"])
        self.assert_schema(result["inventory"])

    def test_multiple_intake_labels_on_one_ocr_line(self):
        raw = "INTERVIEW SHEET\nPangalan: John Lloyd C. Lozada Edad: 24 Sex: M Civil Status: Single\nContact No.: 00123"
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Party Represented"], "John Lloyd C. Lozada")
        self.assertEqual(result["inventory"]["Gender/Sex"], "M")
        self.assertEqual(result["inventory"]["Contact Number"], "00123")

    def test_rtc_decision_does_not_infer_representation_or_termination(self):
        result = self.router.process(RTC_DECISION)
        self.assertEqual(result["document_type"], "rtc_decision")
        inventory = result["inventory"]
        self.assertEqual(inventory["Case No."], "00045-24")
        for field in ("Party Represented", "Title of the Case", "Court/Body", "Status of the Case", "Date of Termination", "Cause of Termination", "Control Number"):
            self.assertIsNone(inventory[field])
        self.assert_schema(inventory)

    def test_court_documents_map_only_explicit_criminal_case_number(self):
        synthetic_variations = (
            ("REPUBLIC OF THE PHILIPPINES\nSANDIGANBAYAN\nSIXTH DIVISION\nCriminal Case No. SB-25-CRM-0001\nDECISION", "SB-25-CRM-0001"),
            ("REPUBLIC OF THE PHILIPPINES\nSand1ganbayan\nPEOPLE OF THE PHILIPPINES\nCase No.: SB - 25 - CRM - 0002\nDECISION", "SB - 25 - CRM - 0002"),
            ("REPUBLIC OF THE PHILIPPINES\nSANDIGANBAYAN\nFOURTH DIVISION\nCriminal Case No.\nDECISION", None),
        )
        for text, expected in synthetic_variations:
            with self.subTest(expected=expected):
                result = self.router.process(text)
                self.assertEqual(result["document_type"], "sandiganbayan_document")
                self.assertEqual(result["inventory"]["Case No."], expected)
                self.assertTrue(all(value is None for field, value in result["inventory"].items() if field != "Case No."))
                self.assertEqual(result["needs_review"], expected is None)

    def test_empty_and_whitespace_input(self):
        for raw in ("", "  \n\t  "):
            with self.subTest(raw=raw):
                result = self.router.process(raw)
                self.assertEqual(result["document_type"], "unknown")
                self.assertEqual(result["inventory"], empty_inventory())
                self.assertTrue(result["needs_review"])
                self.assert_schema(result["inventory"])

    def test_generic_terms_are_insufficient(self):
        for raw in ("Name: Someone\nDECISION", "DECISION", "Name: Someone"):
            with self.subTest(raw=raw):
                self.assertEqual(self.router.classify_document(raw), "unknown")

    def test_ambiguous_competing_signals(self):
        raw = "INTERVIEW SHEET\nName: Ana Reyes\nREPUBLIC OF THE PHILIPPINES\nREGIONAL TRIAL COURT\nDECISION"
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "ambiguous")
        self.assertEqual(result["inventory"], empty_inventory())
        self.assertTrue(result["needs_review"])
        self.assertTrue(result["diagnostics"]["suspected_concatenation"])

    def test_ocr_noise_in_rtc_signals(self):
        raw = RTC_DECISION.replace("TRIAL", "TRlAL").replace("DECISION", "DEC1SION")
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "rtc_decision")
        self.assertEqual(result["inventory"]["Case No."], "00045-24")

    def test_missing_fields_and_ambiguous_date(self):
        raw = "INTERVIEW SHEET\nName:\nContact No.: 00123\nDate of Confinement: 03/04/2024\nUrban: ?"
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertIsNone(result["inventory"]["Party Represented"])
        self.assertEqual(result["inventory"]["Contact Number"], "00123")
        self.assertIsNone(result["inventory"]["Date of Confinement"])
        self.assertIsNone(result["inventory"]["Urban"])
        self.assertTrue(result["needs_review"])

    def test_direct_extractors_return_exact_schema(self):
        self.assert_schema(self.router.extract_intake_form(ENGLISH_INTAKE))
        self.assert_schema(self.router.extract_rtc_decision(RTC_DECISION))
        self.assert_schema(self.router.extract_sandiganbayan_document(SANDIGANBAYAN_DECISION))

    def test_concatenated_same_type_skips_extraction(self):
        raw = ENGLISH_INTAKE + "\nINTERVIEW SHEET\nName: Another Person\n"
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"], empty_inventory())
        self.assertTrue(result["needs_review"])

    def test_conflicting_values_remain_unresolved(self):
        raw = "INTERVIEW SHEET\nName: Maria Santos\nName: Ana Reyes\nName: Maria Santos\nContact No.: 00123"
        result = self.router.process(raw)
        self.assertIsNone(result["inventory"]["Party Represented"])
        self.assertTrue(any("conflicting" in warning for warning in result["diagnostics"]["warnings"]))

    def test_thresholds_are_configurable(self):
        strict = DocumentRouter(min_score=20)
        self.assertEqual(strict.classify_document(ENGLISH_INTAKE), "unknown")

    def test_structured_pao_form_without_interview_heading(self):
        raw = "Rehiyon XI District Office PAO Panabo\nControl No.: XI-001\nI. URI NG INIHIHINGI NG TULONG\nII. IMPORMASYON UKOL SA APLIKANTE\nPangalan: Ana Reyes Edad: 24"
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Control Number"], "XI-001")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")


if __name__ == "__main__":
    unittest.main()
