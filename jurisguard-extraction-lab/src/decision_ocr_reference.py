"""Prepare private image transcripts and score saved OCR against reviewed text.

This is an OCR-only path for the current 20 Sandiganbayan images. It does not
assign PAO inventory labels or claim that OCR output is a reference transcript.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .evaluate import ocr_metrics
from .scan_unlabeled import IMAGE_SUFFIXES

CANDIDATES = ("tesseract", "easyocr", "paddleocr")


def _images(images_dir: Path) -> list[Path]:
    if not images_dir.is_dir():
        raise FileNotFoundError(f"image directory does not exist: {images_dir}")
    files = sorted(
        (p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES),
        key=lambda p: (int(p.stem) if p.stem.isdigit() else float("inf"), p.name),
    )
    if not files:
        raise ValueError("no supported images found")
    if len({p.stem for p in files}) != len(files):
        raise ValueError("image basenames must be unique so transcript filenames do not collide")
    return files


def prepare(images_dir: Path, reference_dir: Path, *, expected_count: int | None = None) -> dict:
    files = _images(images_dir)
    if expected_count is not None and len(files) != expected_count:
        raise ValueError(f"expected {expected_count} images; found {len(files)}")
    reference_dir.mkdir(parents=True, exist_ok=True)
    samples = []
    for image in files:
        transcript = reference_dir / f"{image.stem}.txt"
        transcript.touch(exist_ok=True)  # Never overwrite a human annotation.
        samples.append({
            "sample_id": image.stem,
            "image_filename": image.name,
            "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
            "reference_filename": transcript.name,
            "reviewed_against_image": False,
            "transcript_origin": "empty_template",
        })
    manifest = {
        "dataset_origin": "real",
        "task": "manual_ocr_transcription_only",
        "document_scope": "Sandiganbayan decision images; verify each image when annotating",
        "samples": samples,
    }
    manifest_path = reference_dir / "manifest.json"
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text(encoding="utf-8"))
        stable_keys = ("sample_id", "image_filename", "image_sha256", "reference_filename")
        old_samples = old.get("samples") if isinstance(old, dict) else None
        if (not isinstance(old_samples, list) or len(old_samples) != len(samples)
                or old.get("dataset_origin") != "real"
                or old.get("task") != "manual_ocr_transcription_only"
                or any(tuple(existing.get(key) for key in stable_keys) != tuple(current[key] for key in stable_keys)
                       for existing, current in zip(old_samples, samples))):
            raise ValueError("existing manifest differs; review image changes before replacing it")
        if any("reviewed_against_image" not in item or "transcript_origin" not in item for item in old_samples):
            for item in old_samples:
                item.setdefault("reviewed_against_image", False)
                item.setdefault("transcript_origin", "empty_template")
            manifest_path.write_text(json.dumps(old, indent=2) + "\n", encoding="utf-8")
    else:
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {"sample_count": len(samples), "reference_dir": str(reference_dir), "manifest": str(manifest_path)}


def draft(images_dir: Path, reference_dir: Path, ocr_base_dir: Path, *, candidate: str = "paddleocr") -> dict:
    """Populate only empty transcript templates from local OCR as unreviewed drafts."""
    if candidate not in CANDIDATES:
        raise ValueError(f"unsupported OCR candidate: {candidate}")
    prepare(images_dir, reference_dir)
    manifest_path = reference_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    created = skipped = 0
    for item in manifest["samples"]:
        target = reference_dir / item["reference_filename"]
        if target.read_text(encoding="utf-8").strip():
            skipped += 1
            continue
        source = ocr_base_dir / candidate / f"{item['sample_id']}.txt"
        draft_text = source.read_text(encoding="utf-8")
        if not draft_text.strip():
            raise ValueError(f"{item['sample_id']}: OCR draft is empty")
        target.write_text(draft_text, encoding="utf-8")
        item["transcript_origin"] = f"{candidate}_assisted_draft"
        item["reviewed_against_image"] = False
        created += 1
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {"sample_count": len(manifest["samples"]), "drafts_created": created, "existing_preserved": skipped, "draft_engine": candidate}


def evaluate(images_dir: Path, reference_dir: Path, ocr_base_dir: Path, output_path: Path) -> dict:
    manifest = json.loads((reference_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("dataset_origin") != "real" or manifest.get("task") != "manual_ocr_transcription_only":
        raise ValueError("expected a real manual OCR transcription manifest")
    images = {p.name: p for p in _images(images_dir)}
    samples = manifest.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ValueError("manifest has no samples")
    references = {}
    for item in samples:
        image = images.get(item["image_filename"])
        if image is None or hashlib.sha256(image.read_bytes()).hexdigest() != item["image_sha256"]:
            raise ValueError(f"{item['sample_id']}: source image missing or changed")
        sample_id = item["sample_id"]
        if item["reference_filename"] != f"{sample_id}.txt":
            raise ValueError(f"{sample_id}: invalid reference filename")
        reference = (reference_dir / item["reference_filename"]).read_text(encoding="utf-8")
        if not reference.strip():
            raise ValueError(f"{sample_id}: reviewed transcript is still empty")
        if item.get("reviewed_against_image") is not True:
            raise ValueError(f"{sample_id}: transcript has not been marked reviewed_against_image=true")
        if item.get("transcript_origin") not in {"independent_manual", "manually_corrected_from_ocr_draft"}:
            raise ValueError(f"{sample_id}: transcript_origin must document completed manual transcription or correction")
        references[sample_id] = reference
    if set(references) != {p.stem for p in images.values()}:
        raise ValueError("manifest and image folder contain different sample IDs")
    results = {}
    for candidate in CANDIDATES:
        rows = []
        for item in samples:
            sample_id = item["sample_id"]
            hypothesis = (ocr_base_dir / candidate / f"{sample_id}.txt").read_text(encoding="utf-8")
            rows.append({"sample_id": sample_id, **ocr_metrics(references[sample_id], hypothesis)})
        char_edits = sum(r["character_edits"] for r in rows)
        chars = sum(r["reference_characters"] for r in rows)
        word_edits = sum(r["word_edits"] for r in rows)
        words = sum(r["reference_words"] for r in rows)
        results[candidate] = {
            "sample_count": len(rows),
            "micro_cer": char_edits / chars if chars else None,
            "micro_wer": word_edits / words if words else None,
            "macro_cer": sum(r["cer"] for r in rows) / len(rows),
            "macro_wer": sum(r["wer"] for r in rows) / len(rows),
            "rows": rows,
        }
    report = {
        "dataset_origin": "real",
        "task": "ocr_comparison_only",
        "sample_count": len(samples),
        "reference_origin_counts": {
            origin: sum(item.get("transcript_origin") == origin for item in samples)
            for origin in ("independent_manual", "manually_corrected_from_ocr_draft")
        },
        "metric_note": "Exact Unicode character edit distance and whitespace-token word edit distance against image-reviewed transcripts. OCR-assisted references may bias comparison even after manual correction; report their origin. No NLP or PAO inventory accuracy measured.",
        "candidates": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "draft", "evaluate"))
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--reference-dir", type=Path, required=True)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--ocr-base-dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "prepare":
            summary = prepare(args.images_dir, args.reference_dir, expected_count=args.expected_count)
        elif args.action == "draft":
            if args.ocr_base_dir is None:
                parser.error("draft requires --ocr-base-dir")
            summary = draft(args.images_dir, args.reference_dir, args.ocr_base_dir)
        else:
            if args.ocr_base_dir is None or args.output is None:
                parser.error("evaluate requires --ocr-base-dir and --output")
            report = evaluate(args.images_dir, args.reference_dir, args.ocr_base_dir, args.output)
            summary = {"sample_count": report["sample_count"], "candidates": {
                name: {k: values[k] for k in ("micro_cer", "micro_wer", "macro_cer", "macro_wer")}
                for name, values in report["candidates"].items()
            }}
    except (ValueError, FileNotFoundError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
