"""Local-only image/PDF OCR using PaddleOCR 3.x and PP-OCRv6.

All model paths are checked before PaddleOCR construction to prevent its implicit
download behavior. This module never calls a network service or production DB.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median

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
    timings: dict = field(default_factory=dict)


def _model_dir(name: str, default: Path) -> Path:
    return Path(os.getenv(name, str(default))).expanduser()


def _positive_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _positive_env_alias(primary: str, legacy: str, default: int) -> int:
    """Read the current setting first, then a legacy JurisGuard setting."""
    if os.getenv(primary) is not None:
        return _positive_env(primary, default)
    return _positive_env(legacy, default)


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class LocalOCR:
    def __init__(self) -> None:
        cache = Path.home() / ".paddlex" / "official_models"
        self.model_profile = os.getenv("PADDLEOCR_MODEL_PROFILE", "mobile").strip().lower()
        if self.model_profile in {"medium", "handwriting"}:
            self.det_model_name = "PP-OCRv6_medium_det"
            self.rec_model_name = "PP-OCRv6_medium_rec"
        else:
            self.model_profile = "mobile"
            self.det_model_name = "PP-OCRv5_mobile_det"
            self.rec_model_name = "en_PP-OCRv5_mobile_rec"
        self.det_model = _model_dir("PADDLEOCR_DET_MODEL_DIR", cache / self.det_model_name)
        self.rec_model = _model_dir("PADDLEOCR_REC_MODEL_DIR", cache / self.rec_model_name)
        self.max_pages = _positive_env("LOCAL_OCR_MAX_PAGES", 8)
        self.max_pixels = _positive_env("LOCAL_OCR_MAX_PIXELS", 40000000)
        # A full-size PAO page has small handwritten entries. The optional
        # handwriting profile retains more pixels for detection and recognition.
        # It is deliberately not the interactive default: CPU inference is slow.
        image_limit = 3200 if self.model_profile == "handwriting" else 2500
        detection_limit = 1920 if self.model_profile == "handwriting" else 1280
        self.max_dimension = max(400, _positive_env_alias("LOCAL_OCR_MAX_DIMENSION", "PADDLEOCR_MAX_DIMENSION", image_limit))
        # PP-OCRv6 defaults to limit_type=min, so a full form otherwise reaches
        # the CPU detector at ~2500px. Limit detection only; recognition crops
        # still use the larger working image and coordinates remain in its space.
        self.det_limit = max(640, min(3200, _positive_env_alias("LOCAL_OCR_DET_MAX_DIMENSION", "PADDLEOCR_DET_LIMIT_SIDE_LEN", detection_limit)))
        self.cpu_threads = max(1, min(8, _positive_env("PADDLEOCR_CPU_THREADS", 4)))
        self.recognition_batch_size = max(1, min(32, _positive_env("PADDLEOCR_RECOGNITION_BATCH_SIZE", 8)))
        self.enable_mkldnn = _bool_env("PADDLEOCR_ENABLE_MKLDNN", False)
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
                text_detection_model_name=self.det_model_name,
                text_detection_model_dir=str(self.det_model),
                text_recognition_model_name=self.rec_model_name,
                text_recognition_model_dir=str(self.rec_model),
                text_recognition_batch_size=self.recognition_batch_size,
                text_det_limit_side_len=self.det_limit,
                text_det_limit_type="max",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                device="cpu",
                enable_mkldnn=self.enable_mkldnn,
                cpu_threads=self.cpu_threads,
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
        # Paddle boxes on the same printed row often differ by several vertical
        # pixels. A plain y/x sort then places right-column values before their
        # left-column labels. Cluster by row first and sort each row left-to-right.
        if not entries:
            return entries
        typical_height = median(max(1, item["bbox"][3] - item["bbox"][1]) for item in entries)
        tolerance = max(5.0, typical_height * .55)
        rows: list[dict] = []
        for entry in sorted(entries, key=lambda item: ((item["bbox"][1] + item["bbox"][3]) / 2, item["bbox"][0])):
            center = (entry["bbox"][1] + entry["bbox"][3]) / 2
            matching = min(rows, key=lambda row: abs(row["center"] - center), default=None)
            if matching is None or abs(matching["center"] - center) > tolerance:
                rows.append({"center": center, "items": [entry]})
            else:
                matching["items"].append(entry)
                matching["center"] = sum((item["bbox"][1] + item["bbox"][3]) / 2 for item in matching["items"]) / len(matching["items"])
        ordered: list[dict] = []
        for row in sorted(rows, key=lambda item: item["center"]):
            ordered.extend(sorted(row["items"], key=lambda item: item["bbox"][0]))
        return ordered

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

    def extract(self, file_path: str | Path, target: str = "full") -> OCRDocument:
        started = time.perf_counter()
        path = Path(file_path)
        target = target.strip().lower()
        if target not in {"full", "client"}:
            raise OfflineOCRError("Unsupported OCR extraction target.")
        layout: list[dict] = []
        warnings: list[str] = []
        paddle_attempted = False
        page_count = 0
        page_timings = []
        for page_number, original in self._pages(path):
            page_count += 1
            source_width, source_height = original.size
            offset_x = offset_y = 0
            region_name = "full_page"
            if target == "client" and source_height > source_width:
                top = round(source_height * .29)
                bottom = round(source_height * .45)
                original = original.crop((0, top, source_width, bottom))
                offset_y = top
                region_name = "applicant_block"
            working = original
            if max(working.size) > self.max_dimension:
                scale = self.max_dimension / max(working.size)
                working = working.resize((max(1, round(working.width * scale)), max(1, round(working.height * scale))), Image.Resampling.LANCZOS)
            gray = np.asarray(working.convert("L"))
            contrast = float(gray.std())
            if contrast < 2.0:
                warnings.append(f"Page {page_number}: image appears blank or unreadable.")
                continue
            if contrast < 12.0:
                warnings.append(f"Page {page_number}: low contrast; local autocontrast applied.")
                working = ImageOps.autocontrast(working)
            paddle_attempted = True
            page_started = time.perf_counter()
            entries = self._paddle_page(working, page_number)
            page_timings.append({"page": page_number, "seconds": round(time.perf_counter() - page_started, 3)})
            if not entries:
                warnings.append(f"Page {page_number}: OCR found no readable text.")
            scale_x = original.width / working.width
            scale_y = original.height / working.height
            for entry in entries:
                x1, y1, x2, y2 = entry["bbox"]
                entry["bbox"] = [
                    round(x1 * scale_x + offset_x), round(y1 * scale_y + offset_y),
                    round(x2 * scale_x + offset_x), round(y2 * scale_y + offset_y),
                ]
                entry["region"] = region_name
                entry["line"] = len(layout) + 1
                layout.append(entry)
            if target == "client":
                break
        engine = "paddleocr" if paddle_attempted else None
        raw_text = "\n".join(item["text"] for item in layout)
        box_layout = [{key: value for key, value in item.items() if key != "text"} for item in layout]
        return OCRDocument(raw_text, box_layout, engine, page_count, warnings, {
            "total_seconds": round(time.perf_counter() - started, 3),
            "pages": page_timings, "detection_max_dimension": self.det_limit,
            "model_profile": self.model_profile, "target": target,
        })
