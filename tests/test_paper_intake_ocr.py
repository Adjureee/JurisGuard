"""Real local OCR on three explicitly synthetic paper-section variations."""
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw, ImageFont
from ai_service import process_document
from paper_intake import APPLICANT as A, REPRESENTATIVE as R


class PaperIntakeOCRTests(unittest.TestCase):
    def test_three_synthetic_applicant_representative_variations(self):
        font = ImageFont.truetype('arial.ttf', 36)
        with tempfile.TemporaryDirectory() as directory:
            for number, representative in enumerate(['SYNTHETIC Ben', '', 'SYNTHETIC Cara']):
                with self.subTest(variation=number):
                    image = Image.new('RGB', (1800, 1150), 'white')
                    draw = ImageDraw.Draw(image)
                    for y, value in [(30, 'SYNTHETIC TEST DOCUMENT ONLY'),
                        (100, 'II. IMPORMASYON UKOL SA APLIKANTE'),
                        (200, 'Pangalan: SYNTHETIC Ana'), (300, 'Tirahan: Alpha'),
                        (470, 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE'),
                        (570, 'Pangalan: ' + representative), (800, 'III. URI NG KASO'),
                        (900, 'Pangalan: OUTSIDE SECTION')]:
                        draw.text((40, y), value, font=font, fill='black')
                    draw.text((1100, 200), 'Edad: 29', font=font, fill='black')
                    path = Path(directory) / f'synthetic-{number}.png'
                    image.save(path)
                    result = process_document(str(path), extraction_mode='offline', extraction_target='paper_intake')
                    self.assertEqual(result['extraction_mode'], 'OFFLINE_PAPER_INTAKE')
                    self.assertEqual(result['sections'][A]['name'], 'SYNTHETIC Ana')
                    self.assertEqual(result['sections'][A]['age'], '29')
                    self.assertEqual(result['sections'][R]['name'], representative)
                    self.assertNotIn('OUTSIDE SECTION', str(result))
                    self.assertTrue(result['needs_review'])
