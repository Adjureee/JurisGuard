"""Local-only lab settings. No production application or database imports."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


LAB_ROOT = Path(__file__).resolve().parent
_WINDOWS_TESSERACT = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
DEFAULT_TESSERACT = str(_WINDOWS_TESSERACT) if _WINDOWS_TESSERACT.is_file() else "tesseract"


@dataclass(frozen=True)
class LabConfig:
    ocr_engine: str = "paddleocr"  # select "easyocr" or "tesseract" for comparison runs
    paddle_det_model_dir: Path = Path.home() / ".paddlex/official_models/PP-OCRv6_medium_det"
    paddle_rec_model_dir: Path = Path.home() / ".paddlex/official_models/PP-OCRv6_medium_rec"
    tesseract_command: str = DEFAULT_TESSERACT
    tesseract_language: str = "eng"
    easyocr_model_dir: Path = Path.home() / ".EasyOCR/model"

    @classmethod
    def from_env(cls) -> "LabConfig":
        return cls(
            ocr_engine=os.getenv("JURISGUARD_LAB_OCR_ENGINE", "paddleocr").lower(),
            paddle_det_model_dir=Path(os.getenv("JURISGUARD_LAB_PADDLE_DET_MODEL", str(cls.paddle_det_model_dir))),
            paddle_rec_model_dir=Path(os.getenv("JURISGUARD_LAB_PADDLE_REC_MODEL", str(cls.paddle_rec_model_dir))),
            tesseract_command=os.getenv("JURISGUARD_LAB_TESSERACT", DEFAULT_TESSERACT),
            tesseract_language=os.getenv("JURISGUARD_LAB_TESSERACT_LANG", "eng"),
            easyocr_model_dir=Path(os.getenv("JURISGUARD_LAB_EASYOCR_MODEL_DIR", str(cls.easyocr_model_dir))),
        )
