"""Synthetic scan pixels, never OCR text, determine per-box candidates."""
import unittest
from PIL import Image, ImageDraw, ImageFilter
from tests.checkbox_fixtures import checkbox_sheet
from paper_checkboxes import PREFIX, unknown_boxes, answer_from_boxes, classify_box, detect_page_boxes, validate_boxes
from paper_intake import empty_sections, extract_paper_intake


ENTRIES = [
    {'text': 'II. IMPORMASYON UKOL SA APLIKANTE', 'bbox': [55, 150, 850, 185]},
    {'text': 'Nakakulong: Oo Hindi', 'bbox': [55, 550, 530, 588]},
    {'text': 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE', 'bbox': [55, 850, 1000, 890]},
]


class PaperCheckboxTests(unittest.TestCase):
    def test_merged_printed_option_labels_still_locate_boxes_without_deciding_marks(self):
        entries = [dict(e, text=e['text'].replace('Nakakulong: Oo Hindi', 'Nakakulong:OoHindi')) for e in ENTRIES]
        for oo in ['checked', 'unchecked', 'unknown']:
            image, _ = checkbox_sheet(oo, 'unchecked')
            states, _ = detect_page_boxes(image, entries)
            self.assertEqual(states[PREFIX+'oo'], oo)
            self.assertEqual(states[PREFIX+'hindi'], 'unchecked')

    def test_nearby_structural_and_printed_headings_do_not_hide_visible_marks(self):
        image, _ = checkbox_sheet('checked', 'unchecked')
        with_markers = [
            {'text': ENTRIES[0]['text'], 'bbox': [55, 70, 850, 105]},
            {'text': 'SYNTHETIC printed form instructions', 'bbox': [55, 110, 700, 130]},
            *ENTRIES,
            {'text': ENTRIES[2]['text'], 'bbox': [55, 775, 1000, 810]},
        ]
        states, _ = detect_page_boxes(image, with_markers)
        self.assertEqual(states[PREFIX+'oo'], 'checked')
        self.assertEqual(states[PREFIX+'hindi'], 'unchecked')
        distant_repeat = with_markers + [{'text': ENTRIES[0]['text'], 'bbox': [55, 350, 850, 385]}]
        self.assertEqual(detect_page_boxes(image, distant_repeat)[0], unknown_boxes())

    def test_gray_camera_background_and_blurred_narrow_borders_are_not_ink(self):
        for expected in ['checked', 'unchecked', 'unknown']:
            with self.subTest(expected=expected):
                image = Image.new('RGB', (100, 80), (145, 145, 145))
                draw = ImageDraw.Draw(image)
                draw.rectangle((30, 15, 50, 50), outline='black', width=3)
                if expected != 'unchecked':
                    draw.line((34, 43, 45, 20), fill='black' if expected == 'checked' else (110, 110, 110), width=3)
                image = image.filter(ImageFilter.GaussianBlur(.7))
                self.assertEqual(classify_box(image, [30, 15, 51, 51]), expected)

    def test_occluded_edge_never_establishes_an_empty_box(self):
        image = Image.new('RGB', (100, 80), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 15, 50, 50), outline='black', width=3)
        draw.rectangle((30, 15, 50, 18), fill='white')
        self.assertEqual(classify_box(image, [30, 15, 51, 51]), 'unknown')
        draw.line((34, 43, 45, 20), fill='black', width=3)
        self.assertEqual(classify_box(image, [30, 15, 51, 51]), 'checked')

    def test_actual_marks_empty_faint_and_conflicting_boxes(self):
        for oo, hindi, summary in [('checked', 'unchecked', 'Oo'), ('unchecked', 'checked', 'Hindi'),
                                   ('unchecked', 'unchecked', ''), ('unknown', 'unchecked', ''), ('checked', 'checked', '')]:
            with self.subTest(oo=oo, hindi=hindi):
                image, _ = checkbox_sheet(oo, hindi)
                states, evidence = detect_page_boxes(image, ENTRIES)
                self.assertEqual(states, {PREFIX+'oo': oo, PREFIX+'hindi': hindi})
                self.assertEqual(answer_from_boxes(states), summary)
                self.assertEqual(evidence[PREFIX+'oo']['source'], 'scan_pixels')

    def test_missing_cropped_ambiguous_or_low_confidence_identity_is_unknown(self):
        image, _ = checkbox_sheet('cropped', 'unchecked')
        self.assertEqual(detect_page_boxes(image, ENTRIES)[0], unknown_boxes())
        image, _ = checkbox_sheet()
        for entries in [ENTRIES[1:], [dict(e, engine_score=.4) for e in ENTRIES],
                        [dict(e, text=e['text'].replace('Oo Hindi', 'Hindi Oo')) for e in ENTRIES],
                        [dict(e, bbox=[55, 550, 530, 2000]) if 'Nakakulong' in e['text'] else e for e in ENTRIES],
                        ENTRIES + [ENTRIES[1]]]:
            self.assertEqual(detect_page_boxes(image, entries)[0], unknown_boxes())
        self.assertEqual(classify_box(image, [0, 0, 25, 33]), 'unknown')

    def test_nearby_text_alone_never_establishes_a_checkbox_state(self):
        text = 'II. IMPORMASYON UKOL SA APLIKANTE\nNakakulong: Oo [X] Hindi []\nII-A. IMPORMASYON UKOL SA REPRESENTATIVE\nIII. URI NG KASO'
        result = extract_paper_intake(text)
        self.assertEqual(result['checkbox_states'], unknown_boxes())
        self.assertEqual(result['sections']['applicant_personal_circumstances']['detained'], '')

    def test_validation_preserves_three_states_and_rejects_coercions(self):
        sections = empty_sections()
        for oo, hindi in [('unknown', 'unchecked'), ('unchecked', 'unchecked'), ('checked', 'checked')]:
            states = {PREFIX+'oo': oo, PREFIX+'hindi': hindi}
            validate_boxes(states, sections)
        for bad in [{PREFIX+'oo': False, PREFIX+'hindi': 'unchecked'}, {}, {**unknown_boxes(), 'outside': 'checked'}]:
            with self.assertRaises(ValueError): validate_boxes(bad, sections)
        with self.assertRaises(ValueError): validate_boxes({PREFIX+'oo':'checked', PREFIX+'hindi':'unchecked'}, sections)
