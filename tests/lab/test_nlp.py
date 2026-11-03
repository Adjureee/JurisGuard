"""Saved synthetic OCR text tests; no OCR engine is loaded."""

import unittest

from src.document_router import DocumentRouter
from src.schema import CLASSIFICATION_FIELDS, INVENTORY_FIELDS, empty_inventory, validate_inventory


ENGLISH = """INTERVIEW SHEET
Control No.: 0007-24
Name: Maria Santos
Contact No.: 0917-000-1234
Date of Confinement: February 13, 2024
Urban: [x]
Rural: [ ]
SENIOR: [?]
"""
TAGALOG = """INTERV1EW SHEET
Pangalan: Ana Reyes Edad: 32 Sex: F
Tirahan: Barangay San Jose
Contact No.: 0998 001 2345
CICL: ☐
"""
RTC = """REPUBLIC OF THE PHILIPPINES
REGIONAL TRIAL COURT
Branch 12
PEOPLE OF THE PHILIPPINES, Plaintiff
-versus-
JUAN DELA CRUZ, Accused.
Criminal Case No. 00045-24
x-------------------x
DECISION
Promulgated March 7, 2024.
"""
SANDIGANBAYAN = """REPUBLIC OF THE PHILIPPINES
SANDIGANBAYAN
Sixth Division
PEOPLE OF THE PHILIPPINES
-versus-
A SAMPLE ACCUSED, Accused.
Criminal Case No. SB-22-CRM-0042
DECISION
The Regional Trial Court was mentioned in an earlier proceeding.
"""
SYNTHETIC_SANDIGANBAYAN_VARIANTS = (
    SANDIGANBAYAN,
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


class NLPTests(unittest.TestCase):
    def setUp(self):
        self.router = DocumentRouter()

    def test_sandiganbayan_routes_separately_and_cannot_use_rtc_extractor(self):
        for text in (OBSERVED_NONPERSONAL_OCR_FAILURE, *SYNTHETIC_SANDIGANBAYAN_VARIANTS, *SYNTHETIC_NOISY_HEADING_VARIANTS, *SYNTHETIC_ROUTING_NOISE_VARIANTS):
            with self.subTest(text=text.splitlines()[1]):
                result = self.router.process(text)
                self.assertEqual(result["document_type"], "sandiganbayan_document")
                self.assertEqual(self.router.extract_rtc_decision(text), empty_inventory())
                self.assertIsNotNone(result["diagnostics"]["out_of_scope_court_signal"])
                self.assertTrue(all(value is None for field, value in result["inventory"].items() if field != "Case No."))

    def test_rtc_heading_precedes_historical_sandiganbayan_reference(self):
        text = RTC + "\nThe Sandiganbayan was mentioned in procedural history."
        self.assertEqual(self.router.classify_document(text), "rtc_decision")

    def test_competing_court_headings_require_review(self):
        text = "REPUBLIC OF THE PHILIPPINES\nSandiganbayan\nREGIONAL TRIAL COURT\nPEOPLE OF THE PHILIPPINES\nCase No. SB-25-CRM-0042\nDECISION"
        result = self.router.process(text)
        self.assertEqual(result["document_type"], "ambiguous")
        self.assertEqual(result["inventory"], empty_inventory())

    def test_english_intake_and_schema(self):
        result = self.router.process(ENGLISH)
        self.assertEqual(result["document_type"], "intake_form")
        inventory = result["inventory"]
        self.assertEqual(tuple(inventory), INVENTORY_FIELDS)
        validate_inventory(inventory)
        self.assertEqual(inventory["Control Number"], "0007-24")
        self.assertEqual(inventory["Contact Number"], "0917-000-1234")
        self.assertEqual(inventory["Date of Confinement"], "2024-02-13")
        self.assertIs(inventory["Urban"], True)
        self.assertIs(inventory["Rural"], False)
        self.assertIsNone(inventory["SENIOR"])
        self.assertTrue(result["needs_review"])
        self.assertNotIn("field_evidence", inventory)

    def test_tagalog_intake_and_inline_labels(self):
        result = self.router.process(TAGALOG)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")
        self.assertEqual(result["inventory"]["Gender/Sex"], "F")
        self.assertIsNone(result["inventory"]["Female"])
        self.assertIs(result["inventory"]["CICL"], False)
        validate_inventory(result["inventory"])

    def test_rtc_decision_keeps_legal_inferences_unresolved(self):
        result = self.router.process(RTC)
        self.assertEqual(result["document_type"], "rtc_decision")
        self.assertEqual(result["inventory"]["Case No."], "00045-24")
        for name in ("Party Represented", "Title of the Case", "Court/Body", "Control Number", "Status of the Case", "Date of Termination"):
            self.assertIsNone(result["inventory"][name])
        validate_inventory(result["inventory"])

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

    def test_unknown_and_ambiguous(self):
        self.assertEqual(self.router.classify_document("Name: Someone\nDECISION"), "unknown")
        for raw in ("", "  \n "):
            result = self.router.process(raw)
            self.assertEqual(result["inventory"], empty_inventory())
            self.assertTrue(result["needs_review"])
        mixed = "INTERVIEW SHEET\nName: Ana\nREPUBLIC OF THE PHILIPPINES\nREGIONAL TRIAL COURT\nDECISION"
        result = self.router.process(mixed)
        self.assertEqual(result["document_type"], "ambiguous")
        self.assertEqual(result["inventory"], empty_inventory())
        self.assertTrue(result["diagnostics"]["suspected_concatenation"])
        self.assertIn("review_question", result["diagnostics"])

    def test_missing_ambiguous_and_conflicting_fields(self):
        raw = "INTERVIEW SHEET\nName:\nContact No.: 00123\nDate of Confinement: 03/04/2024\nUrban: ?\nContact No.: 00999"
        result = self.router.process(raw)
        self.assertIsNone(result["inventory"]["Party Represented"])
        self.assertIsNone(result["inventory"]["Contact Number"])
        self.assertIsNone(result["inventory"]["Date of Confinement"])
        self.assertIsNone(result["inventory"]["Urban"])
        self.assertTrue(result["needs_review"])

    def test_direct_extraction_contracts(self):
        for inventory in (self.router.extract_intake_form(ENGLISH), self.router.extract_rtc_decision(RTC), self.router.extract_sandiganbayan_document(SANDIGANBAYAN)):
            validate_inventory(inventory)
            self.assertEqual(set(inventory), set(INVENTORY_FIELDS))
            for name in CLASSIFICATION_FIELDS:
                self.assertTrue(inventory[name] is None or type(inventory[name]) is bool)

    def test_structured_pao_sections_without_interview_heading(self):
        raw = "Rehiyon XI District Office PAO Panabo\nControl No.: XI-001\nI. URI NG INIHIHINGI NG TULONG\nII. IMPORMASYON UKOL SA APLIKANTE\nPangalan: Ana Reyes Edad: 24"
        result = self.router.process(raw)
        self.assertEqual(result["document_type"], "intake_form")
        self.assertEqual(result["inventory"]["Party Represented"], "Ana Reyes")

    def test_repeated_document_heading_is_not_merged(self):
        result = self.router.process(ENGLISH + "\nINTERVIEW SHEET\nName: Another Person")
        self.assertEqual(result["inventory"], empty_inventory())
        self.assertTrue(result["needs_review"])

    def test_unapproved_demographic_mapping_and_lost_checkbox_layout(self):
        raw = "INTERVIEW SHEET\nName: Ana Reyes\nContact No.: 09170001234\nSenior Citizen: [x]\nUrban [x] Rural [ ]"
        result = self.router.process(raw)
        self.assertIsNone(result["inventory"]["SENIOR"])
        self.assertIsNone(result["inventory"]["Urban"])
        self.assertIsNone(result["inventory"]["Rural"])
        self.assertTrue(result["needs_review"])
        self.assertTrue(any("approved inventory mapping" in warning for warning in result["diagnostics"]["warnings"]))
        self.assertTrue(any("checkbox association" in warning for warning in result["diagnostics"]["warnings"]))


if __name__ == "__main__":
    unittest.main()
