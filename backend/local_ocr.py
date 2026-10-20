"""Local-only image/PDF OCR using PaddleOCR 3.x and PP-OCRv6.

All model paths are checked before PaddleOCR construction to prevent its implicit
download behavior. This module never calls a network service or production DB.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError


class OfflineOCRError(RuntimeError):
    """A document cannot be read or local PaddleOCR failed."""


@dataclass
class OCRDocument:
    raw_text: str
    layout: list[dict]
    engine: str | None
    page_count: int
    warnings: list[str]


def _model_dir(name: str, default: Path) -> Path:
    return Path(os.getenv(name, str(default))).expanduser()


def _positive_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


class LocalOCR:
    def __init__(self) -> None:
        cache = Path.home() / ".paddlex" / "official_models"
        self.det_model = _model_dir("PADDLEOCR_DET_MODEL_DIR", cache / "PP-OCRv6_medium_det")
        self.rec_model = _model_dir("PADDLEOCR_REC_MODEL_DIR", cache / "PP-OCRv6_medium_rec")
        self.max_pages = _positive_env("LOCAL_OCR_MAX_PAGES", 8)
        self.max_pixels = _positive_env("LOCAL_OCR_MAX_PIXELS", 40000000)
        self.max_dimension = max(400, _positive_env("LOCAL_OCR_MAX_DIMENSION", 2500))
        self._paddle = None
        self._paddle_failure: str | None = None

    @staticmethod
    def _model_complete(path: Path) -> bool:
        return all((path / name).is_file() for name in ("inference.json", "inference.pdiparams", "inference.yml"))

    def _paddle_engine(self):
        if self._paddle_failure:
            raise OfflineOCRError(self._paddle_failure)
        if self._paddle is not None:
            return self._paddle
        if not all(self._model_complete(path) for path in (self.det_model, self.rec_model)):
            raise OfflineOCRError("PaddleOCR local model files are missing; download is disabled.")
        try:
            paddleocr_version = version("paddleocr")
            paddle_version = version("paddlepaddle")
            if not paddleocr_version.startswith("3.") or not paddle_version.startswith("3."):
                raise OfflineOCRError("PaddleOCR 3.x and PaddlePaddle 3.x are required for PP-OCRv6.")
            import paddleocr

            if not str(paddleocr.__version__).startswith("3."):
                raise OfflineOCRError("PaddleOCR version is not supported by this local model adapter.")
            self._paddle = paddleocr.PaddleOCR(
                text_detection_model_name="PP-OCRv6_medium_det",
                text_detection_model_dir=str(self.det_model),
                text_recognition_model_name="PP-OCRv6_medium_rec",
                text_recognition_model_dir=str(self.rec_model),
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                device="cpu",
                enable_mkldnn=False,
                cpu_threads=max(1, min(4, os.cpu_count() or 1)),
            )
            return self._paddle
        except OfflineOCRError:
            raise
        except PackageNotFoundError as exc:
            raise OfflineOCRError("PaddleOCR or PaddlePaddle is not installed locally.") from exc
        except Exception as exc:
            raise OfflineOCRError(f"PaddleOCR initialization failed: {type(exc).__name__}.") from exc

    @staticmethod
    def _paddle_lines(result: object, page: int) -> list[dict]:
        entries: list[dict] = []
        if not isinstance(result, list) or len(result) != 1:
            raise OfflineOCRError("PaddleOCR returned an unexpected page result.")
        payload = getattr(result[0], "json", None)
        if not isinstance(payload, dict):
            raise OfflineOCRError("PaddleOCR returned an unexpected result format.")
        data = payload.get("res", payload)
        if not isinstance(data, dict):
            raise OfflineOCRError("PaddleOCR returned an unexpected result format.")
        texts, scores, boxes = (data.get(name) for name in ("rec_texts", "rec_scores", "rec_boxes"))
        if not all(isinstance(items, list) for items in (texts, scores, boxes)) or len(texts) != len(scores) or len(texts) != len(boxes):
            raise OfflineOCRError("PaddleOCR returned mismatched text and layout data.")
        for recognized_text, score, box in zip(texts, scores, boxes):
            if not str(recognized_text).strip():
                continue
            try:
                if len(box) != 4:
                    raise ValueError("invalid box")
                entries.append({
                    "page": page,
                    "text": str(recognized_text).strip(),
                    "bbox": [int(value) for value in box],
                    "engine_score": float(score),
                })
            except (TypeError, ValueError):
                raise OfflineOCRError("PaddleOCR returned invalid text or layout data.") from None
        # Keep each detection as one line. Joining boxes on a fixed pixel
        # threshold can merge unrelated form columns and erase label boundaries.
        entries.sort(key=lambda item: (item["bbox"][1], item["bbox"][0]))
        return entries

    def _paddle_page(self, image: Image.Image, page: int) -> list[dict]:
        engine = self._paddle_engine()
        try:
            results = engine.predict(input=np.asarray(image.convert("RGB")))
            return self._paddle_lines(list(results), page)
        except OfflineOCRError:
            raise
        except Exception as exc:
            self._paddle_failure = f"PaddleOCR inference failed: {type(exc).__name__}."
            raise OfflineOCRError(self._paddle_failure) from exc

    def _pages(self, path: Path):
        if not path.is_file():
            raise OfflineOCRError("Document file does not exist.")
        if path.suffix.lower() == ".pdf":
            try:
                import pypdfium2 as pdfium

                pdf = pdfium.PdfDocument(str(path))
                try:
                    count = len(pdf)
                    if not count or count > self.max_pages:
                        raise OfflineOCRError(f"PDF must contain 1 to {self.max_pages} pages.")
                    for index in range(count):
                        page = pdf[index]
                        width, height = page.get_size()
                        if width * height * 4 > self.max_pixels:
                            raise OfflineOCRError("Rendered PDF page exceeds the pixel limit.")
                        image = page.render(scale=2).to_pil().convert("RGB")
                        if image.width * image.height > self.max_pixels:
                            raise OfflineOCRError("Rendered PDF page exceeds the pixel limit.")
                        yield index + 1, image
                finally:
                    pdf.close()
            except ImportError as exc:
                raise OfflineOCRError("Local PDF renderer pypdfium2 is not installed.") from exc
            except OfflineOCRError:
                raise
            except Exception as exc:
                raise OfflineOCRError("PDF is corrupt or cannot be rendered locally.") from exc
        else:
            try:
                with Image.open(path) as source:
                    image = ImageOps.exif_transpose(source)
                    if image.width * image.height > self.max_pixels:
                        raise OfflineOCRError("Image exceeds the pixel limit.")
                    yield 1, image.convert("RGB")
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                raise OfflineOCRError("Image is corrupt or unsupported.") from exc

    def extract(self, file_path: str | Path) -> OCRDocument:
        path = Path(file_path)
        layout: list[dict] = []
        warnings: list[str] = []
        paddle_attempted = False
        page_count = 0
        for page_number, original in self._pages(path):
            page_count += 1
            if max(original.size) > self.max_dimension:
                scale = self.max_dimension / max(original.size)
                original = original.resize((max(1, round(original.width * scale)), max(1, round(original.height * scale))), Image.Resampling.LANCZOS)
            gray = np.asarray(original.convert("L"))
            if float(gray.std()) < 2.0:
                warnings.append(f"Page {page_number}: image appears blank or unreadable.")
                continue
            if float(gray.std()) < 12.0:
                warnings.append(f"Page {page_number}: low contrast; local autocontrast applied.")
                working = ImageOps.autocontrast(original)
            else:
                working = original
            paddle_attempted = True
            entries = self._paddle_page(working, page_number)
            if not entries:
                warnings.append(f"Page {page_number}: OCR found no readable text.")
            for entry in entries:
                entry["line"] = len(layout) + 1
                layout.append(entry)
        engine = "paddleocr" if paddle_attempted else None
        raw_text = "\n".join(item["text"] for item in layout)
        box_layout = [{key: value for key, value in item.items() if key != "text"} for item in layout]
        return OCRDocument(raw_text, box_layout, engine, page_count, warnings)
