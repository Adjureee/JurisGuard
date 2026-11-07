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
