import base64
import io
import unittest
from unittest.mock import patch
from PIL import Image
from cloud_intake import validate_sections, vision_content
from ai_service import JurisGuardExtractionEngine


class CloudIntakeTests(unittest.TestCase):
    def test_png_is_sent_with_matching_jpeg_encoding(self):
        stream = io.BytesIO()
        Image.new('RGBA', (20, 30), 'white').save(stream, 'PNG')
        content = vision_content(base64.b64encode(stream.getvalue()).decode(), {})
        data = base64.b64decode(content[1]['image_url'].split(',', 1)[1])
        with Image.open(io.BytesIO(data)) as image:
            self.assertEqual(image.format, 'JPEG')

    def test_nonfinite_numbers_are_withheld(self):
        for number in (float('nan'), float('inf'), float('-inf')):
            warnings = []
            result = validate_sections({'section': {'amount': number}}, {'section': {'amount': None}}, warnings)
            self.assertIsNone(result['section']['amount'])
            self.assertTrue(warnings)

    def test_rejects_printed_signature_label_as_name(self):
        warnings = []
        result = validate_sections({'header': {'approver': 'Pangalan at Lagda ng Officer'}},
                                   {'header': {'approver': None}}, warnings)
        self.assertIsNone(result['header']['approver'])
        self.assertTrue(warnings)

    def test_invalid_candidate_is_withheld_without_coercion(self):
        warnings = []
        actual = {'section': {'marked': 'false'}}
        result = validate_sections(actual, {'section': {'marked': False}}, warnings)
        self.assertIsNone(result['section']['marked'])
        self.assertEqual(actual['section']['marked'], 'false')
        self.assertEqual(len(warnings), 1)

    def test_preserves_unknown_false_and_literal_text(self):
        schema = {'section': {'marked': False, 'blank': False, 'answer': None}}
        actual = {'section': {'marked': None, 'blank': False, 'answer': 'N/A'}}
        self.assertEqual(validate_sections(actual, schema), actual)

    def test_rejects_string_booleans_and_extra_fields(self):
        schema = {'section': {'marked': False}}
        for actual in ({'section': {'marked': 'false'}}, {'section': {'marked': False, 'extra': 0}}):
            with self.assertRaises(ValueError):
                validate_sections(actual, schema)

    def test_provides_labeled_detail_images(self):
        stream = io.BytesIO()
        Image.new('RGB', (1000, 800), 'white').save(stream, 'JPEG')
        content = vision_content(base64.b64encode(stream.getvalue()).decode(), {})
        self.assertEqual(sum(item['type'] == 'image_url' for item in content), 5)
        self.assertIn('same page', content[2]['text'])

    def test_execute_does_not_reconstruct_cloud_sections(self):
        engine = JurisGuardExtractionEngine.__new__(JurisGuardExtractionEngine)
        result = {'extraction_mode': 'ONLINE_MISTRAL', 'sections': {'test': {'unknown': None}}}
        with patch('ai_service.compress_image_for_vlm', return_value='synthetic.jpg'), \
             patch.object(engine, '_run_cloud_then_offline_fallback', return_value=result):
            actual = engine.execute_extraction('synthetic.jpg', extraction_mode='cloud')
        self.assertEqual(actual['sections'], result['sections'])
