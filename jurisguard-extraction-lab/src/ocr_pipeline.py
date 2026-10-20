"""Configurable local image OCR, routing, optional evaluation, and CLI."""

from __future__ import annotations

import argparse
import json
import subprocess
from importlib.metadata import PackageNotFoundError, version
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from config import LAB_ROOT, LabConfig
from .document_router import DocumentRouter
from .evaluate import compare, load_ground_truth


@dataclass(frozen=True)
class OCRLine:
    number: int
    text: str
    bbox: tuple[int, int, int, int] | None  # left, top, right, bottom
    engine_score: float | None = None  # OCR engine output, not calibrated field confidence


@dataclass(frozen=True)
class OCRResult:
    raw_text: str
    lines: tuple[OCRLine, ...]
    engine: str


class LocalOCREngine(Protocol):
    def extract(self, image_path: Path) -> OCRResult: ...


class PaddleOCREngine:
    def __init__(self, config: LabConfig) -> None:
        self.config = config
        self._engine = None

    def extract(self, image_path: Path) -> OCRResult:
        for label, path in (("detection", self.config.paddle_det_model_dir), ("recognition", self.config.paddle_rec_model_dir)):
            if not all((path / name).is_file() for name in ("inference.json", "inference.pdiparams", "inference.yml")):
                raise RuntimeError(f"Local PaddleOCR {label} model missing at {path}. Supply installed model directories; this lab does not download models.")
        try:
            if not version("paddleocr").startswith("3.") or not version("paddlepaddle").startswith("3."):
                raise RuntimeError("This lab adapter requires PaddleOCR 3.x and PaddlePaddle 3.x for PP-OCRv6.")
        except PackageNotFoundError as exc:
            raise RuntimeError("PaddleOCR and PaddlePaddle must be installed locally.") from exc
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise RuntimeError("PaddleOCR is not installed in this Python environment. See requirements.txt.") from exc
        if self._engine is None:
            self._engine = PaddleOCR(
                text_detection_model_name="PP-OCRv6_medium_det",
                text_detection_model_dir=str(self.config.paddle_det_model_dir),
                text_recognition_model_name="PP-OCRv6_medium_rec",
                text_recognition_model_dir=str(self.config.paddle_rec_model_dir),
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                device="cpu",
                enable_mkldnn=False,
                cpu_threads=4,
            )
        pages = list(self._engine.predict(input=str(image_path)))
        if len(pages) != 1 or not isinstance(getattr(pages[0], "json", None), dict):
            raise RuntimeError("PaddleOCR returned an unexpected page result.")
        data = pages[0].json.get("res", pages[0].json)
        if not isinstance(data, dict):
            raise RuntimeError("PaddleOCR returned an unexpected result format.")
        texts, scores, boxes = (data.get(name) for name in ("rec_texts", "rec_scores", "rec_boxes"))
        if not all(isinstance(items, list) for items in (texts, scores, boxes)) or len(texts) != len(scores) or len(texts) != len(boxes):
            raise RuntimeError("PaddleOCR returned mismatched text and layout data.")
        entries = []
        for text, score, box in zip(texts, scores, boxes):
            if not str(text).strip():
                continue
            if len(box) != 4:
                raise RuntimeError("PaddleOCR returned invalid layout data.")
            entries.append((str(text).strip(), tuple(int(value) for value in box), float(score)))
        entries.sort(key=lambda item: (item[1][1], item[1][0]))
        lines = tuple(OCRLine(i, text, box, score) for i, (text, box, score) in enumerate(entries, 1))
        return OCRResult("\n".join(line.text for line in lines), lines, "paddleocr")


class EasyOCREngine:
    def __init__(self, config: LabConfig) -> None:
        self.config = config
        self._reader = None

    def extract(self, image_path: Path) -> OCRResult:
        if not self.config.easyocr_model_dir.is_dir() or not any(self.config.easyocr_model_dir.glob("*.pth")):
            raise RuntimeError("Local EasyOCR model files are missing; download is disabled.")
        try:
            import easyocr
        except ImportError as exc:
            raise RuntimeError("EasyOCR is not installed in this Python environment.") from exc
        if self._reader is None:
            self._reader = easyocr.Reader(
                ["en"], gpu=False,
                model_storage_directory=str(self.config.easyocr_model_dir),
                download_enabled=False, verbose=False,
            )
        detections = self._reader.readtext(str(image_path), detail=1, paragraph=False)
        entries = []
        for box, text, score in detections:
            if not str(text).strip():
                continue
            xs, ys = zip(*box)
            entries.append((str(text).strip(), (int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))), float(score)))
        entries.sort(key=lambda item: (item[1][1], item[1][0]))
        lines = tuple(OCRLine(i, text, box, score) for i, (text, box, score) in enumerate(entries, 1))
        return OCRResult("\n".join(line.text for line in lines), lines, "easyocr")


class TesseractEngine:
    def __init__(self, config: LabConfig) -> None:
        self.config = config

    def extract(self, image_path: Path) -> OCRResult:
        try:
            completed = subprocess.run(
                [self.config.tesseract_command, str(image_path), "stdout", "-l", self.config.tesseract_language, "tsv"],
                capture_output=True, text=True, encoding="utf-8", errors="replace", check=True, timeout=120,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("Local Tesseract executable not found. Configure JURISGUARD_LAB_TESSERACT.") from exc
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(f"Tesseract failed: {exc.stderr.strip()[:300]}") from exc
        return parse_tesseract_tsv(completed.stdout)


def parse_tesseract_tsv(tsv: str) -> OCRResult:
    groups: dict[tuple[str, str, str, str], list[dict[str, str]]] = {}
    source_lines = tsv.splitlines()
    if not source_lines:
        return OCRResult("", (), "tesseract")
    headers = source_lines[0].split("\t")
    required = {"page_num", "block_num", "par_num", "line_num", "left", "top", "width", "height", "conf", "text"}
    if not required.issubset(headers):
        raise ValueError("Tesseract TSV is missing required columns")
    for line_number, source_line in enumerate(source_lines[1:], 2):
        # Tesseract's TSV is tab-delimited, not CSV-quoted. A recognized '"'
        # must remain text; csv.DictReader can merge subsequent TSV rows.
        parts = source_line.split("\t", len(headers) - 1)
        if len(parts) != len(headers):
            raise ValueError(f"Malformed Tesseract TSV row at line {line_number}")
        row = dict(zip(headers, parts))
        if not row.get("text", "").strip():
            continue
        key = (row["page_num"], row["block_num"], row["par_num"], row["line_num"])
        groups.setdefault(key, []).append(row)
    lines = []
    for number, words in enumerate(groups.values(), 1):
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        right = max(int(word["left"]) + int(word["width"]) for word in words)
        bottom = max(int(word["top"]) + int(word["height"]) for word in words)
        scores = [float(word["conf"]) for word in words if float(word["conf"]) >= 0]
        lines.append(OCRLine(number, " ".join(word["text"] for word in words), (left, top, right, bottom), sum(scores) / len(scores) if scores else None))
    return OCRResult("\n".join(line.text for line in lines), tuple(lines), "tesseract")


def make_engine(config: LabConfig) -> LocalOCREngine:
    if config.ocr_engine == "easyocr":
        return EasyOCREngine(config)
    if config.ocr_engine == "paddleocr":
        return PaddleOCREngine(config)
    if config.ocr_engine == "tesseract":
        return TesseractEngine(config)
    raise ValueError("ocr_engine must be paddleocr, easyocr, or tesseract")


def run_image(image_path: str | Path, *, config: LabConfig | None = None, engine: LocalOCREngine | None = None, router: DocumentRouter | None = None) -> tuple[OCRResult, dict]:
    image = Path(image_path)
    if not image.is_file():
        raise FileNotFoundError(image)
    config = config or LabConfig.from_env()
    ocr = (engine or make_engine(config)).extract(image)
    result = (router or DocumentRouter()).process(ocr.raw_text)
    if not ocr.raw_text.strip():
        result["diagnostics"]["warnings"].append("OCR returned no text; inspect image and engine settings.")
        result["needs_review"] = True
    return ocr, result


def main() -> None:
    parser = argparse.ArgumentParser(description="Local JurisGuard extraction lab")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="image to OCR and extract")
    source.add_argument("--ocr-text", type=Path, help="saved OCR text; skip OCR for NLP testing")
    parser.add_argument("--ground-truth", type=Path, help="JSON with document_type, exact inventory, and optional reference_text")
    parser.add_argument("--output-dir", type=Path, default=LAB_ROOT / "data/outputs/latest")
    args = parser.parse_args()
    if args.image:
        ocr, result = run_image(args.image)
        raw_text = ocr.raw_text
    else:
        raw_text = args.ocr_text.read_text(encoding="utf-8")
        ocr = None
        result = DocumentRouter().process(raw_text)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "ocr.txt").write_text(raw_text, encoding="utf-8")
    if ocr is not None:
        (args.output_dir / "layout.json").write_text(json.dumps({"engine": ocr.engine, "lines": [asdict(line) for line in ocr.lines]}, indent=2), encoding="utf-8")
    (args.output_dir / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    if args.ground_truth:
        report = compare(result, load_ground_truth(args.ground_truth), raw_text)
        (args.output_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"document_type": result["document_type"], "needs_review": result["needs_review"], "output_dir": str(args.output_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
