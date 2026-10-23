"""Report document routing on saved OCR text and visual document-type labels.

The current 20-page set was used to refine routing rules. This report is an
in-sample diagnostic, not a held-out NLP benchmark or an OCR accuracy report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .document_router import DocumentRouter
from .schema import DOCUMENT_TYPES, validate_inventory

CANDIDATES = ("tesseract", "easyocr", "paddleocr")


def build_report(images_dir: Path, manifest_path: Path, ocr_base_dir: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    samples = manifest.get("samples")
    if manifest.get("dataset_origin") != "real" or not isinstance(samples, list) or not samples:
        raise ValueError("a nonempty real-image manifest is required")
    if not images_dir.is_dir():
        raise FileNotFoundError("image directory does not exist")
    seen: set[str] = set()
    for sample in samples:
        sample_id = sample["sample_id"]
        if sample_id in seen or sample["image_filename"] != f"{sample_id}{Path(sample['image_filename']).suffix}":
            raise ValueError(f"duplicate or mismatched sample ID: {sample_id}")
        seen.add(sample_id)
        if sample.get("visual_document_type") not in DOCUMENT_TYPES - {"unknown", "ambiguous"}:
            raise ValueError(f"{sample_id}: visual_document_type is missing or invalid")
        if sample.get("visual_label_source") != "agent_visual_inspection_of_image":
            raise ValueError(f"{sample_id}: visual label source is missing")
        image = images_dir / sample["image_filename"]
        if not image.is_file() or hashlib.sha256(image.read_bytes()).hexdigest() != sample["image_sha256"]:
            raise ValueError(f"{sample_id}: image missing or changed since labeling")
    if {p.stem for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}} != seen:
        raise ValueError("image folder and manifest contain different sample IDs")

    candidates = {}
    router = DocumentRouter()
    for candidate in CANDIDATES:
        rows = []
        for sample in samples:
            sample_id = sample["sample_id"]
            raw_text = (ocr_base_dir / candidate / f"{sample_id}.txt").read_text(encoding="utf-8")
            result = router.process(raw_text)
            validate_inventory(result["inventory"])
            if result["document_type"] == "sandiganbayan_document" and any(
                value is not None for field, value in result["inventory"].items() if field != "Case No."
            ):
                raise ValueError(f"{candidate}/{sample_id}: unapproved Sandiganbayan field mapping")
            rows.append({
                "sample_id": sample_id,
                "visual_label": sample["visual_document_type"],
                "predicted_type": result["document_type"],
                "label_match": result["document_type"] == sample["visual_document_type"],
                "needs_review": result["needs_review"],
            })
        labels = sorted({row["visual_label"] for row in rows})
        candidates[candidate] = {
            "sample_count": len(rows),
            "label_match_count": sum(row["label_match"] for row in rows),
            "label_match_fraction": sum(row["label_match"] for row in rows) / len(rows),
            "unknown_count": sum(row["predicted_type"] == "unknown" for row in rows),
            "ambiguous_count": sum(row["predicted_type"] == "ambiguous" for row in rows),
            "wrong_court_count": sum(row["predicted_type"] in {"rtc_decision", "sandiganbayan_document"} and row["predicted_type"] != row["visual_label"] for row in rows),
            "review_count": sum(row["needs_review"] for row in rows),
            "confusion": {label: {prediction: sum(row["visual_label"] == label and row["predicted_type"] == prediction for row in rows)
                                  for prediction in sorted(DOCUMENT_TYPES)} for label in labels},
            "rows": rows,
        }
    return {
        "report_kind": "in_sample_document_routing_diagnostic",
        "dataset_origin": "real_images_with_agent_visual_document_type_labels",
        "sample_count": len(samples),
        "data_used_for_rule_development": True,
        "held_out": False,
        "metric_scope": "Agreement with agent visual document-family labels on the same pages used to refine rules; not field accuracy or generalization accuracy.",
        "rtc_real_sample_count": sum(s["visual_document_type"] == "rtc_decision" for s in samples),
        "ocr_cer": None,
        "ocr_wer": None,
        "field_accuracy": None,
        "candidates": candidates,
    }


def write_report(report: dict, json_path: Path, markdown_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# Decision image routing check",
        "",
        f"**Set:** {report['sample_count']} real images, visually labeled by the agent. These same pages informed the routing rules, so this is an **in-sample diagnostic**.",
        "",
        "| Saved OCR text | Label matches | Unknown | Ambiguous | Wrong court | Review required |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, values in report["candidates"].items():
        lines.append(f"| {name} | {values['label_match_count']}/{values['sample_count']} | {values['unknown_count']} | {values['ambiguous_count']} | {values['wrong_court_count']} | {values['review_count']} |")
    lines.append("")
    for name, values in report["candidates"].items():
        unresolved = [row["sample_id"] for row in values["rows"] if row["predicted_type"] in {"unknown", "ambiguous"}]
        if unresolved:
            lines.append(f"- {name} unresolved image IDs: {', '.join(unresolved)}.")
    lines += [
        "",
        "The label match counts measure routing agreement on this tuning set. They are not held-out classifier performance.",
        f"There are {report['rtc_real_sample_count']} visually labeled RTC images in this set; RTC behavior is checked only by synthetic regression tests.",
        "Only an explicit Sandiganbayan criminal case number may be mapped. Other inventory fields remain null pending approved mappings.",
        "OCR CER/WER require corrected image-reviewed transcripts; field accuracy requires separate inventory annotations.",
        "The three NLP entity candidates are not scored on these pages because their PAO/RTC target-field mapping is not defined for Sandiganbayan.",
        "",
    ]
    markdown_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--ocr-base-dir", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = build_report(args.images_dir, args.manifest, args.ocr_base_dir)
        write_report(report, args.output_json, args.output_md)
    except (ValueError, FileNotFoundError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps({name: {key: values[key] for key in ("label_match_count", "sample_count", "unknown_count", "wrong_court_count")}
                      for name, values in report["candidates"].items()}, indent=2))


if __name__ == "__main__":
    main()
