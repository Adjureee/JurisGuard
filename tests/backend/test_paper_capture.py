"""Synthetic photographed-sheet geometry and evidence tests; no real PAO data."""
import hashlib
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from paper_capture import (PaperCropError, build_ocr_image, detect_document,
                           load_capture, remap_field_evidence, suggest_sections, validate_plan)
from paper_intake import APPLICANT, REPRESENTATIVE


def plan():
    return {'corners': [[0, 0], [1, 0], [1, 1], [0, 1]], 'rotation': 0,
            'sections': {'part_ii': [.2, .5], 'part_iia': [.5, .7]},
            'document_reviewed': True, 'sections_reviewed': True}


class PaperCaptureTests(unittest.TestCase):
    def test_detects_tilted_page_and_refuses_clipped_page(self):
        photograph = np.zeros((900, 1200, 3), np.uint8)
        corners = np.array([[180, 120], [990, 75], [1060, 810], [140, 850]], np.int32)
        cv2.fillConvexPoly(photograph, corners, (245, 245, 245))
        found = detect_document(photograph)
        self.assertEqual(found['confidence'], 'suggested')
        self.assertTrue(all(.02 < x < .98 and .02 < y < .98 for x, y in found['corners']))
        clipped = np.full((900, 1200, 3), 245, np.uint8)
        self.assertEqual(detect_document(clipped)['confidence'], 'uncertain')

    def test_heading_suggestion_and_uncertainty(self):
        positions = {APPLICANT: {'bbox': [0, 200, 500, 230]},
                     REPRESENTATIVE: {'bbox': [0, 600, 500, 630]},
                     'end': {'bbox': [0, 760, 500, 790]}}
        suggested = suggest_sections(positions, 1000)
        self.assertEqual(suggested['confidence'], 'suggested')
        self.assertEqual(suggested['part_ii'][1], suggested['part_iia'][0])
        self.assertEqual(suggest_sections({APPLICANT: positions[APPLICANT]}, 1000)['confidence'], 'uncertain')

    def test_review_required_and_invalid_crops_rejected(self):
        candidate = plan()
        candidate['sections_reviewed'] = False
        with self.assertRaises(PaperCropError):
            validate_plan(candidate)
        candidate = plan()
        candidate['sections']['part_ii'] = [.2, .8]
        with self.assertRaises(PaperCropError):
            validate_plan(candidate)

    def test_only_reviewed_sections_enter_ocr_and_evidence_maps_to_original(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.jpg'
            output = Path(directory) / 'ocr.jpg'
            image = np.full((1000, 1200, 3), 255, np.uint8)
            image[200:500, 100:1100] = (30, 90, 180)  # Part II
            image[500:700, 100:1100] = (40, 180, 90)  # blank Part II-A region
            image[800:900, 100:1100] = (180, 90, 30)  # excluded Part III
            cv2.imwrite(str(source), image, [cv2.IMWRITE_JPEG_QUALITY, 100])
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            processing = build_ocr_image(source, plan(), output)
            focused = cv2.imread(str(output))
            self.assertEqual(processing['original_sha256'], digest)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest)
            self.assertEqual(len(processing['segments']), 2)
            self.assertLess(focused.shape[0], image.shape[0])
            self.assertTrue(np.any((focused[:, :, 2] > 150) & (focused[:, :, 1] < 130)))
            self.assertFalse(np.any((focused[:, :, 0] > 130) & (focused[:, :, 1] < 130) & (focused[:, :, 2] < 100)))
            segment = processing['segments'][0]
            result = {'diagnostics': {'field_evidence': {'applicant.name': {
                'page': 1, 'bbox': [200, segment['ocr_top'] + 30, 400, segment['ocr_top'] + 60]}},
                'warnings': []}}
            remap_field_evidence(result, processing)
            mapped = result['diagnostics']['field_evidence']['applicant.name']['bbox']
            self.assertEqual(mapped, [200, 230, 400, 260])
            self.assertEqual(result['diagnostics']['capture_processing']['original_sha256'], digest)

    def test_rotation_preserves_readable_region_dimensions(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.png'
            output = Path(directory) / 'ocr.jpg'
            cv2.imwrite(str(source), np.full((600, 800, 3), 255, np.uint8))
            candidate = plan()
            candidate['rotation'] = 90
            processing = build_ocr_image(source, candidate, output)
            self.assertEqual(processing['page_size'], [600, 800])

    def test_single_page_pdf_can_be_reviewed_without_replacing_original(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.pdf'
            output = Path(directory) / 'ocr.jpg'
            image = Image.new('RGB', (800, 600), 'white')
            image.save(source, format='PDF', resolution=144)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            raster = load_capture(source)
            self.assertEqual(raster.shape[:2], (600, 800))
            processing = build_ocr_image(source, plan(), output)
            self.assertTrue(output.is_file())
            self.assertEqual(processing['original_sha256'], digest)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest)

    def test_multi_page_pdf_requires_whole_page_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic-two-pages.pdf'
            image = Image.new('RGB', (800, 600), 'white')
            image.save(source, format='PDF', save_all=True, append_images=[image], resolution=144)
            with self.assertRaisesRegex(PaperCropError, 'Process the whole page'):
                load_capture(source)


if __name__ == '__main__':
    unittest.main()
