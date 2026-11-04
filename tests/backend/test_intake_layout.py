"""Positional intake regressions using invented text and coordinates only."""
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from ai_service import JurisGuardExtractionEngine
from local_ocr import LocalOCR
from intake_layout import applicant_bounds, read_applicant


def box(text, x, y, width=100, page=1):
    return dict(text=text, bbox=[x, y, x+width, y+20], page=page, engine_score=.9)


class IntakeLayoutTests(unittest.TestCase):
    def test_refinement_preserves_first_pass_and_original_coordinates(self):
        first = [box('II. IMPORMASYON', 10, 80), box('Pangalan:', 20, 130),
                 box('Naabot na pag-aaral:', 400, 150), box('II-A. IMPORMASYON', 10, 300)]
        image = Image.fromarray(np.tile(np.arange(800, dtype=np.uint8), (400, 1))).convert('RGB')
        reader = LocalOCR()
        with patch.object(reader, '_pages', return_value=iter([(1, image)])), \
             patch.object(reader, '_paddle_page', side_effect=[first, [box('Synthetic', 20, 40)], []]):
            result = reader.extract('synthetic.png')
        self.assertNotIn('Synthetic', result.raw_text)
        self.assertEqual(result.refinements[0]['bbox'], [18, 120, 68, 130])
        self.assertEqual(result.refinements[0]['region'], 'applicant_refinement')

    def test_unverified_checkbox_is_unknown_not_unchecked(self):
        engine = JurisGuardExtractionEngine.__new__(JurisGuardExtractionEngine)
        result = engine._sectioned_from_flat({'_checkboxes_unverified': True, 'case_type_criminal': False})
        self.assertIsNone(result['nature_of_case']['criminal'])
        self.assertIsNone(result['applicant_personal_circumstances']['detained'])

    def test_separates_columns_and_representative(self):
        entries = [box('Pangalan:', 0, 110), box('Synthetic Person', 120, 110),
                   box('Edad: 32 Sex: F', 400, 110),
                   box('Pangalan: Different Person', 0, 350)]
        values, evidence = read_applicant(entries, (1, 100, 300))
        self.assertEqual(values['applicant_name'], 'Synthetic Person')
        self.assertEqual(values['applicant_age'], '32')
        self.assertEqual(values['applicant_sex'], 'F')
        self.assertTrue(evidence['applicant_name']['requires_review'])

    def test_blank_field_cannot_steal_next_column_or_row(self):
        entries = [box('Tirahan:', 0, 110), box('Contact No.:', 400, 110),
                   box('09123456789', 520, 110), box('E-mail:', 0, 140)]
        values, _ = read_applicant(entries, (1, 100, 300))
        self.assertIsNone(values['applicant_address'])
        self.assertEqual(values['applicant_contact'], '09123456789')

    def test_rejects_malformed_numbers_preserves_candidates(self):
        entries = [box('Individual Monthly Income: Y,000', 0, 110),
                   box('Contact No.: Relasyon sa aplikante:', 0, 140),
                   box('Petsa ng pagkakulong: 12120,12025', 0, 170)]
        values, evidence = read_applicant(entries, (1, 100, 300))
        for key in ('individual_monthly_income', 'applicant_contact', 'detained_since'):
            self.assertIsNone(values[key])
            self.assertFalse(evidence[key]['accepted'])

    def test_boundaries_must_be_ordered_and_same_page(self):
        start = box('II. IMPORMASYON', 0, 100)
        end = box('II-A. IMPORMASYON', 0, 300)
        self.assertEqual(applicant_bounds([start, end]), (1, 120, 300))
        self.assertIsNone(applicant_bounds([start]))
        self.assertIsNone(applicant_bounds([start, dict(end, page=2)]))

    def test_spouse_labels_are_not_applicant_labels(self):
        values, _ = read_applicant([box('Tirahan ng asawa: N/A', 0, 110),
                                   box('Contact No. ng asawa: N/A', 0, 140)], (1, 100, 300))
        self.assertIsNone(values['applicant_address'])
        self.assertIsNone(values['applicant_contact'])
        self.assertEqual(values['spouse_address'], 'N/A')
