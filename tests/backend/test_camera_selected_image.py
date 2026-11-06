"""Synthetic upload contract: retain the original; OCR reads the selected copy."""
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers
from tests.backend import test_upload_extraction as upload_tests


class CameraSelectedImageTests(upload_tests.UploadExtractionTests):
    @staticmethod
    def image(color, size):
        data=io.BytesIO()
        Image.new('RGB',size,color).save(data,'PNG');data.seek(0)
        return UploadFile(data,filename='fictional-camera.png',headers=Headers({'content-type':'image/png'}))

    async def test_ocr_uses_selected_pixels_and_original_is_unchanged(self):
        original=self.image('white',(100,80))
        selected=self.image('black',(40,60))
        original_bytes=original.file.getvalue()
        used=[]
        async def extract(path,*args,**kwargs):
            used.append(Path(path))
            with Image.open(path) as image:
                self.assertEqual(image.size,(40,60))
                self.assertEqual(image.getpixel((10,10)),(0,0,0))
            return {'extraction_mode':'OFFLINE_SPACY_RULES','inventory':{},'needs_review':True}
        self.extract.side_effect=extract
        result=await self.handler(request=SimpleNamespace(is_disconnected=AsyncMock(return_value=False)),
            user=SimpleNamespace(user_id=1,full_name='Fictional Attorney'),user_id=None,
            file=original,ocr_image=selected,crop_plan=None,case_id=None,intake_id=None,extraction_mode='offline',
            extraction_target='client',db=self.db)
        retained=Path(self.document.encrypted_file_path)
        self.assertEqual(retained.read_bytes(),original_bytes)
        self.assertNotEqual(retained,used[0])
        self.assertFalse(used[0].exists())
        self.assertTrue(result['extracted_data']['diagnostics']['image_preparation']['selected_copy'])

    async def test_invalid_selected_copy_never_replaces_or_saves_original(self):
        original=self.image('white',(100,80))
        invalid=UploadFile(io.BytesIO(b'not an image'),filename='invalid.png',headers=Headers({'content-type':'image/png'}))
        with self.assertRaises(HTTPException):
            await self.handler(request=SimpleNamespace(is_disconnected=AsyncMock(return_value=False)),
                user=SimpleNamespace(user_id=1,full_name='Fictional Attorney'),user_id=None,
                file=original,ocr_image=invalid,crop_plan=None,case_id=None,intake_id=None,extraction_mode='offline',
                extraction_target='client',db=self.db)
        self.extract.assert_not_awaited()
        self.assertEqual(list(self.handler.__globals__['UPLOAD_DIR'].iterdir()),[])
