"""Time local OCR inference without requiring or inventing reference transcripts."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import time
from dataclasses import replace
from pathlib import Path

from config import LabConfig
from .ocr_pipeline import make_engine
from .scan_unlabeled import IMAGE_SUFFIXES

CANDIDATES = ("tesseract", "easyocr", "paddleocr")


def run_timing(images_dir: Path, candidate: str, *, expected_count: int | None = None,
               saved_text_dir: Path | None = None, engine=None) -> dict:
    if candidate not in CANDIDATES:
        raise ValueError("unsupported OCR candidate")
    if not images_dir.is_dir():
        raise FileNotFoundError("image directory does not exist")
    files = sorted((p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES),
                   key=lambda p: (int(p.stem) if p.stem.isdigit() else float("inf"), p.name))
    if not files:
        raise ValueError("no supported images found")
    if expected_count is not None and len(files) != expected_count:
        raise ValueError(f"expected {expected_count} images; found {len(files)}")
    startup_start = time.perf_counter()
    ocr_engine = engine or make_engine(replace(LabConfig.from_env(), ocr_engine=candidate))
    ocr_engine.extract(files[0])  # Model load and first-image warm-up are untimed.
    startup_and_warmup = time.perf_counter() - startup_start
    rows = []
    for index, image in enumerate(files, 1):
        start = time.perf_counter()
        result = ocr_engine.extract(image)
        elapsed = time.perf_counter() - start
        row = {
            "sample_id": image.stem,
            "order": index,
            "ocr_wall_seconds": round(elapsed, 5),
            "line_count": len(result.lines),
            "ocr_text_sha256": hashlib.sha256(result.raw_text.encode("utf-8")).hexdigest(),
        }
        if saved_text_dir is not None:
            saved = (saved_text_dir / f"{image.stem}.txt").read_text(encoding="utf-8")
            row["matches_original_saved_text"] = result.raw_text == saved
        rows.append(row)
        print(f"{candidate}: {index}/{len(files)}", flush=True)
    times = [row["ocr_wall_seconds"] for row in rows]
    ordered = sorted(times)
    return {
        "candidate": candidate,
        "sample_count": len(rows),
        "timing_scope": "one engine.extract(image) call per image; excludes file hashing, routing, JSON writes, and model startup/warm-up",
        "warmup": "first image once, before the measured 20-image pass",
        "startup_and_warmup_seconds": round(startup_and_warmup, 5),
        "sample_order": [p.stem for p in files],
        "mean_ocr_wall_seconds": round(statistics.mean(times), 5),
        "median_ocr_wall_seconds": round(statistics.median(times), 5),
        "p90_ocr_wall_seconds_nearest_rank": ordered[math.ceil(0.9 * len(ordered)) - 1],
        "min_ocr_wall_seconds": ordered[0],
        "max_ocr_wall_seconds": ordered[-1],
        "total_measured_ocr_wall_seconds": round(sum(times), 5),
        "saved_text_exact_matches": sum(row.get("matches_original_saved_text", False) for row in rows) if saved_text_dir is not None else None,
        "rows": rows,
        "ocr_cer": None,
        "ocr_wer": None,
        "metric_note": "Wall time only. CER/WER require image-reviewed reference transcripts; engine score and routing agreement are not OCR accuracy.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", choices=CANDIDATES)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--saved-text-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = run_timing(args.images_dir, args.candidate, expected_count=args.expected_count,
                            saved_text_dir=args.saved_text_dir)
    except (ValueError, FileNotFoundError) as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("candidate", "sample_count", "startup_and_warmup_seconds", "mean_ocr_wall_seconds", "median_ocr_wall_seconds", "saved_text_exact_matches")}, indent=2))


if __name__ == "__main__":
    main()
