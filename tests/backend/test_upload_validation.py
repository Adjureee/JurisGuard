"""Synthetic-only upload validation regressions, independent of PostgreSQL."""

import io
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

from upload_validation import save_bounded_upload, verify_image


class UploadValidationTests(unittest.TestCase):
    def test_valid_image_and_jfif_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            image = io.BytesIO()
            Image.new("RGB", (2, 2), "white").save(image, "JPEG")
            path = Path(directory) / "profile.jfif"
            save_bounded_upload(io.BytesIO(image.getvalue()), path, 1024)
            verify_image(path, ".jfif")

    def test_spoofed_and_corrupt_images_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.png"
            path.write_bytes(b"<script>not an image</script>")
            with self.assertRaises(HTTPException) as error:
                verify_image(path, ".png")
            self.assertEqual(error.exception.status_code, 400)
            Image.new("RGB", (2, 2)).save(path, "JPEG")
            with self.assertRaises(HTTPException):
                verify_image(path, ".png")

    def test_truncated_image_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            image = io.BytesIO()
            Image.new("RGB", (20, 20)).save(image, "PNG")
            path = Path(directory) / "truncated.png"
            path.write_bytes(image.getvalue()[:50])
            with self.assertRaises(HTTPException) as error:
                verify_image(path, ".png")
            self.assertEqual(error.exception.status_code, 400)

    def test_empty_and_oversized_uploads_leave_no_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "upload.jpg"
            for data, status in ((b"", 400), (b"123456", 413)):
                with self.subTest(status=status):
                    with self.assertRaises(HTTPException) as error:
                        save_bounded_upload(io.BytesIO(data), path, 5)
                    self.assertEqual(error.exception.status_code, status)
                    self.assertFalse(path.exists())

    def test_interrupted_stream_leaves_no_file(self):
        class FailingStream:
            def read(self, size):
                raise OSError("read failed")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "upload.jpg"
            with self.assertRaises(OSError):
                save_bounded_upload(FailingStream(), path, 5)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
