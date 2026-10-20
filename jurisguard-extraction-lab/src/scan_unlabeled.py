"""Run one local OCR candidate over unlabeled images without accuracy claims.

Private transcripts and routed results are written only under the chosen
output directory. The summary contains identifiers and diagnostics, not text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from dataclasses import replace
from pathlib import Path

from config import LAB_ROOT, LabConfig
from .document_router import DocumentRouter
from .ocr_pipeline import make_engine


IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".jfif", ".png", ".webp"})


def scan(images_dir: Path, candidate: str, output_dir: Path, *, expected_count: int | None = None, engine=None, reuse_ocr_text: bool = False) -> dict:
    if candidate not in {"tesseract", "easyocr", "paddleocr"}:
        raise ValueError("candidate must be tesseract, easyocr, or paddleocr")
    if not images_dir.is_dir():
        raise FileNotFoundError("image directory does not exist")
    files = sorted((path for path in images_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES), key=lambda path: (int(path.stem) if path.stem.isdigit() else float("inf"), path.name))
    if not files:
        raise ValueError("image directory contains no supported images")
    if expected_count is not None and len(files) != expected_count:
        raise ValueError(f"expected {expected_count} images; found {len(files)}")
    if reuse_ocr_text and any(not (output_dir / f"{path.stem}.txt").is_file() for path in files):
        raise FileNotFoundError("saved OCR text is missing for at least one image")
    output_dir.mkdir(parents=True, exist_ok=True)
    ocr_engine = None if reuse_ocr_text else (engine or make_engine(replace(LabConfig.from_env(), ocr_engine=candidate)))
    router = DocumentRouter()
    rows = []
    for path in files:
        start = time.perf_counter()
        fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
        row = {"sample_id": path.stem, "filename": path.name, "sha256": fingerprint, "candidate": candidate}
        try:
            if reuse_ocr_text:
                raw_text = (output_dir / f"{path.stem}.txt").read_text(encoding="utf-8")
                line_count = len(raw_text.splitlines())
            else:
                ocr = ocr_engine.extract(path)
                raw_text, line_count = ocr.raw_text, len(ocr.lines)
                (output_dir / f"{path.stem}.txt").write_text(raw_text, encoding="utf-8")
            result = router.process(raw_text)
            (output_dir / f"{path.stem}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            row.update({
                "status": "completed", "document_type": result["document_type"],
                "needs_review": result["needs_review"], "line_count": line_count,
                "sandiganbayan_signal": bool(re.search(r"\bSandiganbayan\b", raw_text, re.I)),
                "rtc_signal": bool(re.search(r"\bRegional\s+Trial\s+Court\b", raw_text, re.I)),
                "decision_or_judgment_signal": bool(re.search(r"\b(?:Decision|Judgment)\b", raw_text, re.I)),
            })
        except Exception as exc:
            row.update({"status": "failed", "error_type": type(exc).__name__})
        row["wall_seconds"] = round(time.perf_counter() - start, 4)
        rows.append(row)
    summary = {
        "candidate": candidate, "sample_count": len(rows),
        "timing_scope": "routing_only_from_saved_ocr" if reuse_ocr_text else "ocr_and_routing",
        "completed": sum(row["status"] == "completed" for row in rows),
        "failed": sum(row["status"] == "failed" for row in rows),
        "sandiganbayan_signals": sum(row.get("sandiganbayan_signal", False) for row in rows),
        "rtc_signals": sum(row.get("rtc_signal", False) for row in rows),
        "document_type_counts": {kind: sum(row.get("document_type") == kind for row in rows) for kind in ("intake_form", "rtc_decision", "sandiganbayan_document", "unknown", "ambiguous")},
        "rows": rows,
        "accuracy": None,
        "accuracy_note": "CER, WER, and field accuracy require independently reviewed transcripts and inventory labels.",
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Private local OCR scan without ground truth")
    parser.add_argument("candidate", choices=("tesseract", "easyocr", "paddleocr"))
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--expected-count", type=int, default=None)
    parser.add_argument("--reuse-ocr-text", action="store_true", help="rerun routing on saved transcripts without repeating OCR")
    args = parser.parse_args()
    output_dir = args.output_dir or LAB_ROOT / "data/outputs/unlabeled" / args.candidate
    try:
        summary = scan(args.images_dir, args.candidate, output_dir, expected_count=args.expected_count, reuse_ocr_text=args.reuse_ocr_text)
    except (ValueError, FileNotFoundError) as exc:
        parser.error(str(exc))
    print(json.dumps({key: summary[key] for key in ("candidate", "sample_count", "completed", "failed", "sandiganbayan_signals", "rtc_signals", "document_type_counts", "accuracy")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
