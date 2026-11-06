"""Synthetic skewed-column OCR, checkbox provenance and reviewed states."""
import unittest
from paper_intake import APPLICANT as A, REPRESENTATIVE as R, SCHEMA, checkbox_candidate, empty_sections, extract_paper_intake, validate_review


def synthetic_layout(representative='', bad_age=False):
    rows = [
        ('II. IMPORMASYON UKOL SA APLIKANTE', [50,50,1000,70]),
        ('Pangalan: SYNTHETIC Ana Grade 10', [50,103,1050,125]),
        ('Edad: 25 Sex: M', [600,100,820,120]), ('Civil Status:', [840,100,970,120]), ('Single', [985,97,1080,118]),
        ('Relihlyon:', [50,140,170,160]), ('SYNTHETIC faith', [210,132,420,154]),
        ('Naabot na pag-aaral:', [600,132,820,152]), ('Grade 10', [850,126,980,150]),
        ('Nakakulong: Oo Hindi', [50,300,350,322]),
        ('II-A. IMPORMASYON UKOL SA REPRESENTATIVE', [50,400,1100,420]),
        ('Pangalan:', [50,450,180,470]), ('Edad: Sex. Civil Status:', [600,440,1000,460]),
        ('Tirahan:', [50,490,180,510]), ('Contact No.:', [600,485,800,505]),
        ('Relasyon sa aplikante:', [50,530,280,550]), ('E-mait.', [600,525,800,545]),
        ('III. URI NG KASO', [50,600,1000,620]),
    ]
    if representative:
        rows.append((representative, [200,444,450,468]))
    ref = [
        {'text': 'Pangalan:', 'bbox': [50,110,170,130], 'page': 1, 'engine_score': .99},
        {'text': 'SYNTHETIC Ana', 'bbox': [200,103,450,125], 'page': 1, 'engine_score': .99},
    ]
    if bad_age:
        ref.append({'text': 'Edad: Z5 Sex: M', 'bbox': [600,100,820,120], 'page': 1, 'engine_score': .5})
    return '\n'.join(text for text, _ in rows), [{'bbox': box, 'page': 1, 'engine_score': .99} for _, box in rows], ref


class PaperEvidenceTests(unittest.TestCase):
    def test_three_synthetic_column_variations_preserve_person_and_field(self):
        for representative, bad_age in [('', False), ('SYNTHETIC Ben', False), ('', True)]:
            with self.subTest(representative=bool(representative), bad_age=bad_age):
                result = extract_paper_intake(*synthetic_layout(representative, bad_age))
                self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC Ana')
                self.assertEqual(result['sections'][A]['religion'], 'SYNTHETIC faith')
                self.assertEqual(result['sections'][A]['educational_attainment'], 'Grade 10')
                self.assertEqual(result['sections'][A]['age'], '' if bad_age else '25')
                self.assertEqual(result['sections'][R]['name'], representative)
                self.assertEqual(result['sections'][R]['age'], '')
                self.assertEqual(result['diagnostics']['field_states'][f'{A}.detained'], 'checkbox_unverified')
                self.assertEqual(result['diagnostics']['field_states'][f'{R}.age'], 'unverified_empty')
                self.assertTrue(result['needs_review'])

    def test_missing_ocr_never_becomes_visibly_blank_or_unchecked(self):
        result = extract_paper_intake('')
        self.assertEqual(set(result['diagnostics']['field_states'].values()), {'ocr_failed'})
        for value in ['', 'Hindi', 'Oo Hindi', 'Oo [] Hindi []', 'Oo [X] Hindi', '[X] Oo Hindi']:
            with self.subTest(value=value):
                self.assertEqual(checkbox_candidate(value), '')
        for value, expected in [('Oo [X] Hindi []', 'Oo'), ('[] Oo [X] Hindi', 'Hindi'), ('Oo [] Hindi [X]', 'Hindi')]:
            self.assertEqual(checkbox_candidate(value), expected)
        self.assertEqual(checkbox_candidate('Oo [X] Hindi [X]'), '')

    def test_review_states_persist_distinctions_without_inventing_values(self):
        sections = empty_sections()
        states = {f'{s}.{key}': 'blank' for s, fields in SCHEMA.items() for key, _ in fields}
        states[f'{A}.detained'] = 'unmarked'
        states[f'{A}.address'] = 'unreadable'
        states[f'{A}.age'] = 'ocr_failed'
        self.assertEqual(validate_review(sections, [f'{A}.address'], states), sections)
        states[f'{A}.detained'] = 'unclear'
        validate_review(sections, [f'{A}.address'], states)
        states[f'{A}.name'] = 'pending'
        with self.assertRaises(ValueError): validate_review(sections, [f'{A}.address'], states)
        states[f'{A}.name'] = 'confirmed'
        validate_review(sections, [f'{A}.address'], states)
        sections[A]['name'] = 'SYNTHETIC reviewed name'
        validate_review(sections, [f'{A}.address'], states)
        states[f'{A}.name'] = 'blank'
        validate_review(sections, [f'{A}.address'], states)
        validate_review(sections, [], None)
        validate_review(sections, [], {})
        validate_review(sections, [], {f'{A}.age': 'blank'})
        sections[A]['detained'] = 'False'
        with self.assertRaises(ValueError): validate_review(sections, [], None)
