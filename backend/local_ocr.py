"""Local-only image/PDF OCR. PaddleOCR is primary; Tesseract is an offline fallback.

All model paths are checked before PaddleOCR construction to prevent its implicit
download behavior. This module never calls a network service or production DB.
"""

from __future__ import annotations

import csv
import io
from importlib.metadata import PackageNotFoundError, version
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError


class OfflineOCRError(RuntimeError):
    """A document cannot be read or all installed local OCR engines failed."""


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
        cache = Path.home() / ".paddleocr" / "whl"
        self.det_model = _model_dir("PADDLEOCR_DET_MODEL_DIR", cache / "det/en/en_PP-OCRv3_det_infer")
        self.rec_model = _model_dir("PADDLEOCR_REC_MODEL_DIR", cache / "rec/en/en_PP-OCRv4_rec_infer")
        self.cls_model = _model_dir("PADDLEOCR_CLS_MODEL_DIR", cache / "cls/ch_ppocr_mobile_v2.0_cls_infer")
        self.max_pages = _positive_env("LOCAL_OCR_MAX_PAGES", 8)
        self.max_pixels = _positive_env("LOCAL_OCR_MAX_PIXELS", 40000000)
        self.max_dimension = max(400, _positive_env("LOCAL_OCR_MAX_DIMENSION", 2500))
        self.tesseract_command = os.getenv("TESSERACT_CMD") or self._default_tesseract()
        self._paddle = None
        self._paddle_failure: str | None = None

    @staticmethod
    def _default_tesseract() -> str | None:
        found = shutil.which("tesseract")
        windows = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
        return found or (str(windows) if windows.is_file() else None)

    @staticmethod
    def _model_complete(path: Path) -> bool:
        return (path / "inference.pdmodel").is_file() and (path / "inference.pdiparams").is_file()

    def _paddle_engine(self):
        if self._paddle_failure:
            raise OfflineOCRError(self._paddle_failure)
        if self._paddle is not None:
            return self._paddle
        if not all(self._model_complete(path) for path in (self.det_model, self.rec_model, self.cls_model)):
            raise OfflineOCRError("PaddleOCR local model files are missing; download is disabled.")
        try:
            paddleocr_version = version("paddleocr")
            paddle_version = version("paddlepaddle")
            if paddleocr_version.startswith("2.") and paddle_version.split(".", 1)[0] != "2":
                raise OfflineOCRError("Installed PaddleOCR 2.x and PaddlePaddle runtime are incompatible; using local fallback.")
            import paddleocr

            if not str(paddleocr.__version__).startswith("2."):
                raise OfflineOCRError("PaddleOCR version is not supported by this local model adapter.")
            self._paddle = paddleocr.PaddleOCR(
                det_model_dir=str(self.det_model),
                rec_model_dir=str(self.rec_model),
                cls_model_dir=str(self.cls_model),
                use_angle_cls=False,
                use_gpu=False,
                enable_mkldnn=False,
                cpu_threads=max(1, min(4, os.cpu_count() or 1)),
                det_limit_side_len=1536,
                lang="en",
                show_log=False,
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
        if not isinstance(result, list):
            return entries
        for detected in result:
            if not isinstance(detected, (list, tuple)) or len(detected) < 2:
                continue
            try:
                box, recognition = detected[0], detected[1]
                text, score = recognition
                points = np.asarray(box, dtype=float).reshape(-1, 2)
                if not str(text).strip() or len(points) < 4:
                    continue
                entries.append({
                    "page": page,
                    "text": str(text).strip(),
                    "bbox": [int(points[:, 0].min()), int(points[:, 1].min()), int(points[:, 0].max()), int(points[:, 1].max())],
                    "engine_score": float(score),
                })
            except (TypeError, ValueError):
                continue
        # Keep each detection as one line. Joining boxes on a fixed pixel
        # threshold can merge unrelated form columns and erase label boundaries.
        entries.sort(key=lambda item: (item["bbox"][1], item["bbox"][0]))
        return entries

    def _paddle_page(self, image: Image.Image, page: int) -> list[dict]:
        engine = self._paddle_engine()
        try:
            results = engine.ocr(np.asarray(image.convert("RGB")), cls=False)
            return self._paddle_lines(results[0] if results else [], page)
        except Exception as exc:
            self._paddle_failure = f"PaddleOCR inference failed: {type(exc).__name__}."
            raise OfflineOCRError(self._paddle_failure) from exc

    def _tesseract_page(self, image: Image.Image, page: int) -> list[dict]:
        if not self.tesseract_command:
            raise OfflineOCRError("Tesseract executable is unavailable.")
        with tempfile.TemporaryDirectory(prefix="jurisguard-ocr-") as directory:
            path = Path(directory) / "page.png"
            image.save(path, "PNG")
            try:
                completed = subprocess.run(
                    [self.tesseract_command, str(path), "stdout", "-l", "eng", "tsv"],
                    capture_output=True, text=True, encoding="utf-8", errors="replace", check=True, timeout=120,
                )
            except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                raise OfflineOCRError(f"Tesseract failed: {type(exc).__name__}.") from exc
        groups: dict[tuple[str, str, str, str], list[dict[str, str]]] = {}
        for row in csv.DictReader(io.StringIO(completed.stdout), delimiter="\t"):
            if row.get("text", "").strip():
                key = (row["page_num"], row["block_num"], row["par_num"], row["line_num"])
                groups.setdefault(key, []).append(row)
        entries = []
        for words in groups.values():
            left = min(int(word["left"]) for word in words)
            top = min(int(word["top"]) for word in words)
            right = max(int(word["left"]) + int(word["width"]) for word in words)
            bottom = max(int(word["top"]) + int(word["height"]) for word in words)
            scores = [float(word["conf"]) for word in words if float(word["conf"]) >= 0]
            entries.append({
                "page": page,
                "text": " ".join(word["text"] for word in words),
                "bbox": [left, top, right, bottom],
                "engine_score": sum(scores) / len(scores) if scores else None,
            })
        return entries

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
        engines: set[str] = set()
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
            try:
                entries = self._paddle_page(working, page_number)
                engines.add("paddleocr")
            except OfflineOCRError as exc:
                warnings.append(str(exc) + " Using local Tesseract fallback.")
                entries = self._tesseract_page(working, page_number)
                engines.add("tesseract")
            if not entries:
                warnings.append(f"Page {page_number}: OCR found no readable text.")
            for entry in entries:
                entry["line"] = len(layout) + 1
                layout.append(entry)
        engine = "+".join(sorted(engines)) if engines else None
        raw_text = "\n".join(item["text"] for item in layout)
        box_layout = [{key: value for key, value in item.items() if key != "text"} for item in layout]
        return OCRDocument(raw_text, box_layout, engine, page_count, warnings)
