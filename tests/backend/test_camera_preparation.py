"""Synthetic page edges, faint marks, orientation and capture warnings."""
import base64
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import cv2
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'))
from camera_preparation import conservative_lighting, document_corners, prepare_capture


class CameraPreparationTests(unittest.TestCase):
    def prepare(self, image, orientation=0, confidence=15):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fictional.png';Image.fromarray(image).save(path)
            original=path.read_bytes()
            with patch('camera_preparation.detect_orientation',return_value=(orientation,confidence)):
                result=prepare_capture(path)
            self.assertEqual(path.read_bytes(),original)
            return result,np.asarray(Image.open(io.BytesIO(base64.b64decode(result['image_base64']))))

    def test_uncertain_boundaries_keep_entire_frame(self):
        image=np.full((300,220,3),235,np.uint8)
        result,output=self.prepare(image,confidence=0)
        self.assertFalse(result['boundary_confident'])
        self.assertEqual(output.shape,image.shape)
        self.assertTrue(any('boundaries' in w for w in result['warnings']))
        self.assertTrue(any('blurred' in w for w in result['warnings']))

    def test_lighting_does_not_erase_faint_marks_or_punctuation(self):
        image=np.full((300,220,3),242,np.uint8)
        image[70:90,70:72]=220  # faint slash-like stroke
        image[100:102,90:92]=215  # punctuation
        cv2.rectangle(image,(100,150),(116,170),(80,80,80),1)
        cv2.line(image,(100,169),(116,150),(190,190,190),1)
        result=conservative_lighting(image)
        self.assertLess(int(result[75,70,0]),int(result[75,75,0])-10)
        self.assertLess(int(result[100,90,0]),int(result[100,95,0])-10)
        self.assertLess(int(result[150,100,0]),100)
        self.assertLessEqual(np.abs(result.astype(int)-image.astype(int)).max(),14)

    def test_reliable_outer_edges_rectify_and_keep_border_marks(self):
        image=np.full((600,800,3),70,np.uint8)
        quad=np.int32([[150,50],[680,90],[630,550],[100,510]])
        cv2.fillConvexPoly(image,quad,(245,245,245))
        cv2.circle(image,(170,85),5,(0,0,0),-1)
        cv2.circle(image,(615,510),5,(0,0,0),-1)
        result,output=self.prepare(image)
        self.assertTrue(result['boundary_confident'])
        self.assertLess(output[:80,:80].min(),50)
        self.assertLess(output[-90:,-90:].min(),50)

    def test_only_confident_orientation_rotates(self):
        image=np.full((300,220,3),235,np.uint8)
        result,output=self.prepare(image,90)
        self.assertEqual(output.shape,(220,300,3))
        self.assertEqual(result['rotation'],90)
        result,output=self.prepare(image,90,confidence=2)
        self.assertEqual(output.shape,image.shape)
        self.assertEqual(result['rotation'],0)

    def test_possible_glare_warns_without_inventing_content(self):
        image=np.full((300,220,3),90,np.uint8);image[80:170,70:160]=255
        result,_=self.prepare(image)
        self.assertTrue(any('glare' in warning for warning in result['warnings']))
