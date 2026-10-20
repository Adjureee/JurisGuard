"""Validation for uploaded files before they are persisted or publicly served."""

from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError


IMAGE_FORMATS = {
    ".jpg": "JPEG", ".jpeg": "JPEG", ".jfif": "JPEG",
    ".png": "PNG", ".webp": "WEBP",
}


def save_bounded_upload(source: BinaryIO, destination: Path, max_bytes: int) -> None:
    """Copy at most max_bytes and remove incomplete files on any failure."""
    try:
        size = 0
        with destination.open("wb") as output:
            while chunk := source.read(min(1024 * 1024, max_bytes - size + 1)):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="Upload exceeds the size limit.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def verify_image(path: Path, extension: str) -> None:
    """Reject non-images and files whose actual format disagrees with their extension."""
    try:
        with Image.open(path) as image:
            if image.format != IMAGE_FORMATS[extension]:
                raise HTTPException(status_code=400, detail="Image format does not match its filename.")
            if image.width * image.height > 40_000_000:
                raise HTTPException(status_code=413, detail="Image exceeds the pixel limit.")
            image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupt image.") from exc
