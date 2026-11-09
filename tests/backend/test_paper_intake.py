"""Synthetic section boundaries and lossless reviewed paper intake contract."""
import unittest
from paper_intake import APPLICANT as A, REPRESENTATIVE as R, empty_sections, extract_paper_intake, validate_review
from extraction_mapping import public_extraction_payload


class PaperIntakeTests(unittest.TestCase):
    def test_language_label_glyph_confusion_preserves_answer(self):
        for label in ('Salita/Dialekto', 'Salita/Dlalekto', 'Salita / Dialekto'):
            result = extract_paper_intake(self.sheet(f'{label}: Cebuano / Tagalog'))
            self.assertEqual(result['sections'][A]['language_dialect'], 'Cebuano / Tagalog')
            self.assertTrue(all(not value for value in result['sections'][R].values()))

    def test_unusable_heading_boxes_preserve_text_with_explicit_section_labels(self):
        lines = ['II. IMPORMASYON UKOL SA APLIKANTE', 'Pangalan: Fictional Ana',
                 'Sex: F', 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE',
                 'Pangalan: Fictional Ben', 'III. URI NG KASO']
        # A merged heading detection overlaps the following section heading.
        bounds = [[0,0,600,100], [0,30,250,45], [325,30,450,45],
                  [0,80,600,95], [0,110,250,125], [0,150,600,165]]
        result = extract_paper_intake('\n'.join(lines), [{'bbox': box, 'page': 1} for box in bounds])
        self.assertEqual(result['sections'][A]['name'], 'Fictional Ana')
        self.assertEqual(result['sections'][A]['sex'], 'F')
        self.assertEqual(result['sections'][R]['name'], 'Fictional Ben')
        self.assertNotIn(f'{A}.name', result['diagnostics']['field_evidence'])
        self.assertTrue(result['needs_review'])

    def sheet(self, applicant='', representative=''):
        return ('INTERVIEW SHEET\nI. URI NG INIHIHINGI NG TULONG\nPangalan: OUTSIDE\n'
                'II. IMPORMASYON UKOL SA APLIKANTE\n' + applicant + '\n'
                'II-A. IMPORMASYON UKOL SA REPRESENTATIVE\n' + representative + '\n'
                'III. URI NG KASO\nPangalan: NEVER IMPORT\nIV. SEKTOR\nWoman [X]')

    def test_same_labels_are_scoped_and_other_sections_do_not_escape(self):
        result = extract_paper_intake(self.sheet('Pangalan: SYNTHETIC Ana\nTirahan: Alpha\nContact No.: 00123',
                                                 'Pangalan: SYNTHETIC Ben\nTirahan: Beta\nContact No.: 00456'))
        result['extraction_mode'] = 'OFFLINE_PAPER_INTAKE'
        public = public_extraction_payload(result)
        self.assertEqual(set(public['sections']), {A, R})
        self.assertEqual(public['sections'][A]['name'], 'SYNTHETIC Ana')
        self.assertEqual(public['sections'][R]['name'], 'SYNTHETIC Ben')
        self.assertEqual(public['sections'][A]['contact_no'], '00123')
        self.assertNotIn('NEVER IMPORT', str(public))
        self.assertNotIn('OUTSIDE', str(public))
        self.assertNotIn('inventory', public)

    def test_blank_representative_and_blank_fields_stay_empty(self):
        result = extract_paper_intake(self.sheet('Pangalan: SYNTHETIC Ana', 'Pangalan: ____ Edad: ___ Sex: ___ Civil Status: ____\nTirahan: ___ Contact No.: ____'))
        self.assertTrue(all(value == '' for value in result['sections'][R].values()))
        self.assertEqual(result['sections'][A]['age'], '')
        self.assertEqual(result['sections'][A]['citizenship'], '')

    def test_partial_representative_does_not_fill_applicant(self):
        result = extract_paper_intake(self.sheet('', 'Contact No.: 00123'))
        self.assertEqual(result['sections'][A]['contact_no'], '')
        self.assertEqual(result['sections'][R]['contact_no'], '00123')

    def test_detention_date_repairs_only_unambiguous_separator_damage(self):
        path = f'{A}.detained_since'
        for source, expected, state in [
            ('12120,12025', 'Dec. 20, 2025', 'uncertain'),
            ('12/20,/2025', 'Dec. 20, 2025', 'uncertain'),
            ('29|02,/2024', 'Feb. 29, 2024', 'uncertain'),
            ('08/17/2023', '08/17/2023', 'candidate'),
            ('2023-08-17', '2023-08-17', 'candidate'),
            ('08/09,/2023', '08/09,/2023', 'uncertain'),
            ('02/30,/2025', '02/30,/2025', 'uncertain'),
            ('1212012025', '1212012025', 'uncertain'),
            ('N/A', 'N/A', 'candidate'),
            ('', '', 'unverified_empty'),
        ]:
            with self.subTest(source=source):
                result = extract_paper_intake(self.sheet(f'Petsa ng pagkakakulong: {source}\nContact No.: 09120000000'))
                diagnostics = result['diagnostics']
                self.assertEqual(result['sections'][A]['detained_since'], expected)
                self.assertEqual(diagnostics['field_states'][path], state)
                self.assertEqual(result['sections'][A]['contact_no'], '09120000000')
                if source != expected:
                    self.assertEqual(diagnostics['detention_date_original_candidate'], source)
                    self.assertIn(source, result['raw_text'])

    def test_positioned_detention_date_keeps_original_source_box(self):
        lines = ['II. IMPORMASYON UKOL SA APLIKANTE', 'Petsa ng pagkakakulong:', '12120,12025',
                 'Lugar ng Detention:', 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE', 'III. URI NG KASO']
        bounds = [[0,0,600,15], [0,30,170,45], [180,30,280,45], [325,30,500,45], [0,65,600,80], [0,95,600,110]]
        result = extract_paper_intake('\n'.join(lines), [{'bbox': box, 'page': 1} for box in bounds])
        self.assertEqual(result['sections'][A]['detained_since'], 'Dec. 20, 2025')
        evidence = result['diagnostics']['field_evidence'][f'{A}.detained_since']
        self.assertEqual(evidence['bbox'], bounds[2])
        self.assertEqual(evidence['source_text'], '12120,12025')

    def test_missing_or_reversed_boundaries_do_not_use_whole_page(self):
        for text in ['Pangalan: OUTSIDE', 'II. IMPORMASYON UKOL SA APLIKANTE\nPangalan: UNKNOWN',
                     'II-A. IMPORMASYON UKOL SA REPRESENTATIVE\nIII. URI NG KASO\nII. IMPORMASYON UKOL SA APLIKANTE\nPangalan: OUTSIDE']:
            result = extract_paper_intake(text)
            self.assertTrue(all(value == '' for values in result['sections'].values() for value in values.values()))
            self.assertTrue(result['diagnostics']['warnings'])

    def test_spouse_labels_and_adjacent_columns_keep_identity(self):
        result = extract_paper_intake(self.sheet('Pangalan: SYNTHETIC Ana Edad: 029 Sex: F Civil Status: Married\nTirahan: Alpha Contact No.: 00123\nIndividual Monthly Income: P 1,234.50 Tirahan ng asawa: Other\nContact No. ng asawa: 00456'))
        values = result['sections'][A]
        self.assertEqual(values['name'], 'SYNTHETIC Ana')
        self.assertEqual(values['age'], '029')
        self.assertEqual(values['individual_monthly_income'], 'P 1,234.50')
        self.assertEqual(values['spouse_address'], 'Other')
        self.assertEqual(values['contact_no'], '00123')
        self.assertEqual(values['spouse_contact_no'], '00456')

    def test_unmarked_checkboxes_and_conflicting_values_require_review(self):
        result = extract_paper_intake(self.sheet('Nakakulong: Oo[] Hindi[]\nPangalan: One\nPangalan: Two'))
        self.assertEqual(result['sections'][A]['detained'], '')
        self.assertEqual(result['sections'][A]['name'], '')
        self.assertGreater(len(result['diagnostics']['warnings']), 1)

    def test_text_glyphs_do_not_supply_visual_checkbox_states(self):
        for value, expected in [('Oo [X] Hindi []', 'Oo'), ('Oo [] Hindi [x]', 'Hindi'),
                                ('Oo [X] Hindi [X]', ''), ('Oo [] Hindi []', '')]:
            with self.subTest(value=value):
                self.assertEqual(extract_paper_intake(self.sheet('Nakakulong: ' + value))['sections'][A]['detained'], '')

    def test_review_rejects_other_sections_extra_fields_and_guessed_values(self):
        sections = empty_sections()
        sections[A]['name'] = '  SYNTHETIC name as written  '
        self.assertEqual(validate_review(sections, [f'{R}.name'])[A]['name'], '  SYNTHETIC name as written  ')
        for invalid in [dict(sections, classification={}), dict(sections, **{A: dict(sections[A], age=0)}),
                        dict(sections, **{R: dict(sections[R], case_type='Civil')})]:
            with self.assertRaises(ValueError): validate_review(invalid, [])
        with self.assertRaises(ValueError): validate_review(sections, [f'{A}.name'])

    def test_positioned_separate_value_boxes_are_joined_on_same_row(self):
        lines = ['II. IMPORMASYON UKOL SA APLIKANTE', 'Pangalan:', 'SYNTHETIC Ana', 'Edad:', '29',
                 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE', 'III. URI NG KASO']
        boxes = [{'page': 1, 'bbox': box} for box in [[0,0,300,10], [0,20,70,30], [80,20,150,30],
                 [200,20,240,30], [250,20,280,30], [0,60,300,70], [0,100,300,110]]]
        result = extract_paper_intake('\n'.join(lines), boxes)
        self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC Ana')
        self.assertEqual(result['sections'][A]['age'], '29')

    def test_low_score_candidate_is_flagged_without_repair(self):
        text = self.sheet('Pangalan: SYNTHETIC A?na')
        boxes = [{'page': 1, 'bbox': [0, i*20, 400, i*20+10], 'engine_score': .5 if 'A?na' in line else .99}
                 for i, line in enumerate(text.splitlines())]
        result = extract_paper_intake(text, boxes)
        self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC A?na')
        self.assertIn(f'{A}.name', result['diagnostics']['uncertain_fields'])

    def test_complete_printed_titles_bound_sections_when_roman_numerals_are_missed(self):
        text = self.sheet('Pangalan: SYNTHETIC Ana').replace('II. IMPORMASYON', 'I. IMPORMASYON').replace('II-A.', '')
        result = extract_paper_intake(text)
        self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC Ana')
        self.assertTrue(result['needs_review'])

    def test_printed_contact_label_zero_does_not_repair_the_answer(self):
        result = extract_paper_intake(self.sheet('Contact N0.: 00O12', 'Contact N0.: 00034'))
        self.assertEqual(result['sections'][A]['contact_no'], '00O12')
        self.assertEqual(result['sections'][R]['contact_no'], '00034')

    def test_handwritten_word_fragments_join_without_crossing_columns_or_people(self):
        # Synthetic spatial fixture: separate words, repeated labels, two people.
        from paper_intake_layout import positioned_candidates
        entries = [
            ('II. IMPORMASYON UKOL SA APLIKANTE', [0,0,400,10]),
            ('Pangalan:', [0,20,65,30]), ('Fictional', [75,20,115,30]), ('Rivera', [120,20,155,30]),
            ('Edad: 29', [220,20,280,30]),
            ('II-A. IMPORMASYON UKOL SA REPRESENTATIVE', [0,60,400,70]),
            ('Pangalan: Synthetic Rosa', [0,80,160,90]), ('Edad: 40', [220,80,280,90]),
            ('III. URI NG KASO', [0,120,400,130]),
        ]
        text = '\n'.join(e[0] for e in entries)
        layout = [{'page': 1, 'bbox': e[1]} for e in entries]
        values, states, evidence = positioned_candidates(text, layout)
        self.assertEqual(values[A]['name'], 'Fictional Rivera')
        self.assertEqual(values[R]['name'], 'Synthetic Rosa')
        self.assertEqual(len(evidence[f'{A}.name']['candidates']), 2)
        # A label-only refinement must not erase the first-pass answer.
        refined = [{'page': 1, 'text': 'Pangalan:', 'bbox': [0,20,65,30]}]
        self.assertEqual(positioned_candidates(text, layout, refined)[0][A]['name'], 'Fictional Rivera')
        alternative = [{'page': 1, 'text': 'Pangalan: Fictional R?vera', 'bbox': [0,20,155,30], 'engine_score': .99}]
        values, states, evidence = positioned_candidates(text, layout, alternative)
        self.assertEqual(values[A]['name'], 'Fictional R?vera')
        self.assertEqual(states[f'{A}.name'], 'uncertain')
        self.assertTrue(evidence[f'{A}.name']['pass_disagreement'])
        # Two readings of overlapping pixels are alternatives, not extra words.
        entries.insert(3, ('Different', [75,20,115,30]))
        values, states, evidence = positioned_candidates('\n'.join(e[0] for e in entries), [{'page': 1, 'bbox': e[1]} for e in entries])
        self.assertEqual(values[A]['name'], '')
        self.assertEqual(states[f'{A}.name'], 'ocr_failed')

    def test_paper_target_never_runs_other_section_extractors(self):
        from ai_service import JurisGuardExtractionEngine
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        engine = JurisGuardExtractionEngine.__new__(JurisGuardExtractionEngine)
        engine.local_ocr = Mock()
        engine.local_ocr.extract.return_value = SimpleNamespace(raw_text=self.sheet('Pangalan: SYNTHETIC Ana'), layout=[], warnings=[], page_count=2)
        with patch.object(engine, '_run_offline_pipeline', side_effect=AssertionError('Legacy full extraction must not run')), patch('paper_provenance.attach_provenance', side_effect=lambda result, *args: result), patch('paper_provenance.local_settings', return_value={}):
            result = engine.execute_extraction('synthetic.png', extraction_target='paper_intake')
        self.assertEqual(set(result['sections']), {A, R})
        self.assertNotIn('inventory', result)
        self.assertEqual(result['diagnostics']['page_count'], 2)

    def test_explicit_cloud_paper_schema_has_only_two_sections(self):
        import base64
        import io
        import json
        from PIL import Image
        from unittest.mock import Mock, patch
        from ai_service import JurisGuardExtractionEngine
        engine = JurisGuardExtractionEngine.__new__(JurisGuardExtractionEngine)
        engine.mistral_api_key = 'synthetic-test-key'
        engine.mistral_model = 'synthetic-model'
        engine.mistral_connect_timeout = engine.mistral_read_timeout = 1
        image = io.BytesIO(); Image.new('RGB', (20,20), 'white').save(image, 'PNG')
        data = empty_sections(); data[A]['name'] = 'SYNTHETIC name'; data[A]['age'] = 29
        response = Mock()
        response.json.return_value = {'choices': [{'message': {'content': json.dumps(data)}}]}
        with patch('ai_service.requests.post', return_value=response) as request:
            result = engine._run_online_pipeline(base64.b64encode(image.getvalue()).decode(), paper_intake=True)
        self.assertEqual(set(result['sections']), {A, R})
        self.assertEqual(result['sections'][A]['age'], '')
        self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC name')
        prompt = request.call_args.kwargs['json']['messages'][0]['content'][0]['text']
        self.assertIn('Transcribe ONLY Part II', prompt)
        self.assertEqual(request.call_args.kwargs['json']['random_seed'], 0)
        self.assertIn('unsupported text data', ' '.join(result['diagnostics']['warnings']))
        self.assertIn('cloud_response_text', result['diagnostics'])
        self.assertNotIn('cloud_response_sections', result['diagnostics'])
