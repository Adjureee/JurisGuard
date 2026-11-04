"""Synthetic cloud validation, fingerprints and deterministic pixel geometry."""
import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
from tests.checkbox_fixtures import checkbox_sheet
from tests.backend.test_paper_checkboxes import ENTRIES
from paper_checkboxes import PREFIX, detect_page_boxes, checkbox_review_warnings
from paper_intake import empty_sections, APPLICANT
from paper_provenance import canonical_digest, digest_file
from cloud_intake import validate_paper_response


class PaperPipelineAuditTests(unittest.TestCase):
    def test_strict_cloud_candidates_preserve_text_and_unknown_without_coercion(self):
        response = empty_sections()
        response[APPLICANT].update(name='SYNTHETIC Zeta Q9', age=29, contact_no='001234', detained='Hindi')
        response['checkbox_states'] = {PREFIX+'oo':'checked',PREFIX+'hindi':'unknown'}
        fields, boxes, states, warnings = validate_paper_response(response)
        self.assertEqual(fields[APPLICANT]['name'], 'SYNTHETIC Zeta Q9')
        self.assertEqual(fields[APPLICANT]['contact_no'], '001234')
        self.assertEqual(fields[APPLICANT]['age'], '')
        self.assertEqual(fields[APPLICANT]['detained'], '')
        self.assertEqual(boxes[PREFIX+'hindi'], 'unknown')
        self.assertEqual(states[APPLICANT+'.age'], 'ocr_failed')
        self.assertTrue(warnings)
        response['checkbox_states'][PREFIX+'oo'] = True
        self.assertEqual(validate_paper_response(response)[1][PREFIX+'oo'], 'unknown')
        response['outside'] = {}
        with self.assertRaises(ValueError): validate_paper_response(response)

    def test_semantic_hash_ignores_key_order_but_detects_value_changes(self):
        self.assertEqual(canonical_digest({'a':1,'b':2}),canonical_digest({'b':2,'a':1}))
        self.assertNotEqual(canonical_digest({'a':1}),canonical_digest({'a':2}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'synthetic.bin'; path.write_bytes(b'SYNTHETIC')
            first = digest_file(path); self.assertEqual(first,digest_file(path))
            path.write_bytes(b'SYNTHETIC changed'); self.assertNotEqual(first,digest_file(path))

    def test_tick_fill_faint_and_noisy_boxes_repeat_without_textual_oo(self):
        entries = [dict(e,text=e['text'].replace('Oo Hindi','Hindi')) for e in ENTRIES]
        for style, expected in [('tick','checked'),('cross','checked'),('filled','checked'),('faint','checked'),('unclear','unknown'),('empty','unchecked')]:
            with self.subTest(style=style):
                image, coordinates = checkbox_sheet('unchecked','unchecked')
                draw = ImageDraw.Draw(image); x,y,r,b=coordinates['oo']
                if style=='filled': draw.rectangle((x+2,y+2,r-2,b-2),fill='black')
                elif style in ('cross','faint','unclear'):
                    color = (170,170,170) if style=='unclear' else (85,85,85) if style=='faint' else 'black'
                    draw.line((x+4,y+4,r-4,b-4),fill=color,width=3)
                    draw.line((r-4,y+4,x+4,b-4),fill=color,width=3)
                elif style=='tick':draw.line((x+3,y+17,x+10,b-5,r-3,y+3),fill='black',width=3)
                # Fixed synthetic sensor noise; never seed or alter a real scan.
                if style=='empty':
                    rng=np.random.default_rng(21)
                    image=Image.fromarray(np.clip(np.asarray(image).astype(float)+rng.normal(0,2,(*image.size[::-1],1)),0,255).astype('uint8'))
                readings=[detect_page_boxes(image,entries) for _ in range(3)]
                self.assertEqual(readings[0],readings[1]); self.assertEqual(readings[1],readings[2])
                self.assertEqual(readings[0][0][PREFIX+'oo'],expected)
                self.assertEqual(readings[0][0][PREFIX+'hindi'],'unchecked')

    def test_tilt_and_exposure_keep_pair_identity(self):
        image,_=checkbox_sheet()
        for angle in [-4,4]:
            radians=math.radians(angle);c,s=math.cos(radians),math.sin(radians);cx,cy=image.width/2,image.height/2
            def point(x,y):return (cx+c*(x-cx)+s*(y-cy),cy-s*(x-cx)+c*(y-cy))
            entries=[]
            for e in ENTRIES:
                x,y,r,b=e['bbox'];points=[point(a,d) for a,d in [(x,y),(r,y),(r,b),(x,b)]]
                entries.append(dict(e,bbox=[math.floor(min(p[0] for p in points)),math.floor(min(p[1] for p in points)),math.ceil(max(p[0] for p in points)),math.ceil(max(p[1] for p in points))]))
            scan=ImageEnhance.Brightness(image.rotate(angle,resample=Image.Resampling.BICUBIC,fillcolor='white')).enhance(.6)
            states,_=detect_page_boxes(scan,entries)
            self.assertEqual(states[PREFIX+'oo'],'checked')
            self.assertEqual(states[PREFIX+'hindi'],'unchecked')

    def test_conflict_is_preserved_and_warned(self):
        image,_=checkbox_sheet('checked','checked')
        states,_=detect_page_boxes(image,ENTRIES)
        self.assertTrue(all(value=='checked' for value in states.values()))
        self.assertIn('conflicting',' '.join(checkbox_review_warnings(states)))
