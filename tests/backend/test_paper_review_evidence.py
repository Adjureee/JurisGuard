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
    def test_sparse_representative_section_preserves_applicant_source_boxes(self):
        text, layout, refinements = synthetic_layout()
        lines = []
        boxes = []
        for line, box in zip(text.splitlines(), layout):
            if 420 < box['bbox'][1] < 600:
                if not line.startswith('Pangalan'):
                    continue
                line = 'Pangalan: SYNTHETIC Delegate'
            lines.append(line)
            boxes.append(box)
        for scale, offset in [(1, 0), (2, 130)]:
            with self.subTest(scale=scale):
                def transform(entry):
                    return dict(entry, bbox=[coordinate*scale + offset for coordinate in entry['bbox']])
                result = extract_paper_intake('\n'.join(lines), list(map(transform, boxes)), list(map(transform, refinements)))
                self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC Ana')
                self.assertEqual(result['sections'][R]['name'], 'SYNTHETIC Delegate')
                source = result['diagnostics']['field_evidence'][f'{A}.name']
                self.assertEqual(source['highlight_bbox'], [n*scale + offset for n in [200,103,450,125]])
                self.assertNotIn(f'{R}.name', result['diagnostics']['field_evidence'])

    def test_instruction_row_above_name_and_printed_detention_label_are_not_answers(self):
        rows = [
            ('II. IMPORMASYON UKOL SA APLIKANTE', [10,10,1000,30]),
            ('Pangalan:', [10,60,120,90]),
            ('(Pars sa aphikantelrepresenative; Gumanit nn panit', [130,45,490,60]),
            ('SYNTHETIC Flora', [140,61,350,90]),
            ('Edad: 36 Sex: F', [600,60,790,90]),
            ('Lugar ng Detention:', [600,160,790,180]),
            ('II-A. IMPORMASYON UKOL SA REPRESENTATIVE', [10,200,1000,220]),
            ('Pangalan:', [10,250,120,270]), ('Edad:', [600,250,680,270]),
            ('III. URI NG KASO', [10,300,1000,320]),
        ]
        refined = [dict(page=1, text='Lugar ng Detentior:', bbox=[600,160,790,180])]
        result=extract_paper_intake('\n'.join(t for t,_ in rows),[dict(page=1,bbox=b) for _,b in rows],refined)
        self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC Flora')
        self.assertEqual(result['sections'][A]['place_of_detention'], '')
        self.assertEqual(result['sections'][R]['name'], '')

    def test_empty_field_has_label_anchored_answer_region_without_inventing_a_value(self):
        text, layout, refinements = synthetic_layout()
        result = extract_paper_intake(text, layout, refinements)
        path = f'{R}.address'
        self.assertEqual(result['sections'][R]['address'], '')
        area = result['diagnostics']['field_evidence'][path]
        self.assertEqual(area['location_kind'], 'label_answer_area')
        self.assertGreater(area['bbox'][2], area['bbox'][0])
        self.assertLess(area['bbox'][2], 1000)
        self.assertEqual(result['diagnostics']['field_states'][path], 'unverified_empty')

    def test_highlights_use_answer_boxes_and_never_combined_label_boxes(self):
        text, layout, refinements = synthetic_layout()
        result = extract_paper_intake(text, layout, refinements)
        evidence = result['diagnostics']['field_evidence']
        self.assertEqual(evidence[f'{A}.name']['highlight_bbox'], [200,103,450,125])
        self.assertIsNone(evidence[f'{A}.sex']['highlight_bbox'])
        self.assertIsNone(evidence[f'{R}.age']['highlight_bbox'])
        area = evidence[f'{R}.address']['highlight_bbox']
        self.assertGreater(area[0], 180)  # after the detected Tirahan label

    def test_joined_sex_civil_status_and_misread_citizenship_labels_do_not_become_answers(self):
        # Synthetic fixture uses the exact problematic OCR label strings from
        # the report, with fictional values and independent section boundaries.
        rows = [
            ('II. IMPORMASYON UKOL SA APLIKANTE', [0,0,1000,20]),
            ('Pangalan: SYNTHETIC Applicant', [10,40,400,60]),
            ('Edad:_Sex:F', [600,40,760,60]), ('Civil Status:', [780,40,900,60]), ('Single', [910,40,980,60]),
            ('Pagkamamamayan:', [10,100,240,120]), ('Fictional nationality', [250,100,490,120]),
            ('II-A. IMPORMASYON UKOL SA REPRESENTATIVE', [0,200,1000,220]),
            ('Pangalan: SYNTHETIC Representative', [10,240,400,260]),
            ('Edad: 40 Sex:MCivil Status: Married', [600,240,990,260]),
            ('III. URI NG KASO', [0,300,1000,320]),
        ]
        refinements = [
            dict(page=1, text='Edad: Sex:FCivil Status:', bbox=[600,40,900,60], engine_score=.99),
            dict(page=1, text='Single', bbox=[910,40,980,60], engine_score=.99),
            dict(page=1, text='Pagkamamnamayan:', bbox=[10,100,240,120], engine_score=.99),
            dict(page=1, text='Fictional nationality', bbox=[250,100,490,120], engine_score=.99),
        ]
        result = extract_paper_intake('\n'.join(t for t, _ in rows), [dict(page=1,bbox=b) for _,b in rows], refinements)
        self.assertEqual(result['sections'][A]['sex'], 'F')
        self.assertEqual(result['sections'][A]['civil_status'], 'Single')
        self.assertEqual(result['sections'][A]['citizenship'], 'Fictional nationality')
        self.assertEqual(result['sections'][A]['age'], '')
        self.assertEqual(result['sections'][R]['sex'], 'M')
        self.assertEqual(result['sections'][R]['civil_status'], 'Married')
        # Original damaged strings remain inspectable as evidence.
        self.assertEqual(result['diagnostics']['field_evidence'][f'{A}.sex']['source_text'], 'Edad: Sex:FCivil Status:')

    def test_ocr_misspelling_of_civil_status_ends_the_sex_value(self):
        text, layout, refinements = synthetic_layout()
        for separator in (' ', ''):
            with self.subTest(separator=separator):
                row = f'Edad: 2$ Sex: M{separator}Civil Stalus:'
                result = extract_paper_intake(text, layout, [
                    *refinements,
                    dict(page=1, text=row, bbox=[600,100,970,120], engine_score=.99),
                ])
                self.assertEqual(result['sections'][A]['sex'], 'M')
                self.assertEqual(result['sections'][A]['civil_status'], 'Single')
                self.assertEqual(result['diagnostics']['field_evidence'][f'{A}.sex']['source_text'], row)

    def test_text_only_joined_labels_preserve_readings_without_correcting_spelling(self):
        text = ('II. IMPORMASYON UKOL SA APLIKANTE\nEdad:_Sex:FCivil Status: Single\n'
                'Pagkamamnamayan: Fixpino\nII-A. IMPORMASYON UKOL SA REPRESENTATIVE\n'
                'Sex:MCivil Stalus: Married\nIII. URI NG KASO')
        result = extract_paper_intake(text)
        self.assertEqual(result['sections'][A]['sex'], 'F')
        self.assertEqual(result['sections'][A]['civil_status'], 'Single')
        self.assertEqual(result['sections'][A]['citizenship'], 'Fixpino')
        self.assertEqual(result['sections'][R]['sex'], 'M')
        self.assertEqual(result['sections'][R]['civil_status'], 'Married')

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
