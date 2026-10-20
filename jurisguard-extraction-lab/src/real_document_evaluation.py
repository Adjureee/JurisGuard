"""Score reviewed, de-identified real documents without emitting source text or values."""
import argparse
import hashlib
import json
from pathlib import Path

from .evaluate import ocr_metrics
from .schema import INVENTORY_FIELDS, validate_inventory

SCENARIOS = {"poor_scan", "missing_fields", "ambiguous_checkboxes", "multiple_accused", "readable_handwriting"}
KINDS = {"pao_english", "pao_tagalog", "rtc_decision"}


def score(manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("dataset_origin") != "real_deidentified" or not manifest.get("samples"):
        raise ValueError("Expected nonempty real_deidentified manifest")
    rows = []
    fields = {name: {"tp": 0, "fp": 0, "fn": 0, "exact": 0} for name in INVENTORY_FIELDS}
    seen = set()
    for sample in manifest["samples"]:
        sid = sample["sample_id"]
        if sid in seen or sample.get("kind") not in KINDS or not set(sample.get("scenarios", [])) <= SCENARIOS:
            raise ValueError(f"Invalid or duplicate sample metadata: {sid}")
        seen.add(sid)
        image = (manifest_path.parent / sample["image"]).resolve()
        if not image.is_file() or hashlib.sha256(image.read_bytes()).hexdigest() != sample["image_sha256"]:
            raise ValueError(f"Source image missing or changed: {sid}")
        if sample.get("reviewed_against_image") is not True or sample.get("deidentified_confirmed") is not True:
            raise ValueError(f"Independent annotation and de-identification required: {sid}")
        reference = json.loads((manifest_path.parent / sample["reference"]).read_text(encoding="utf-8"))
        prediction = json.loads((manifest_path.parent / sample["prediction"]).read_text(encoding="utf-8"))
        validate_inventory(reference.get("inventory"))
        validate_inventory(prediction.get("inventory"))
        if not isinstance(reference.get("reference_text"), str) or not isinstance(prediction.get("raw_text"), str):
            raise ValueError(f"Expected reference_text and raw_text: {sid}")
        metrics = ocr_metrics(reference["reference_text"], prediction["raw_text"])
        tp = fp = fn = exact = 0
        for field in INVENTORY_FIELDS:
            truth, actual = reference["inventory"][field], prediction["inventory"][field]
            matched = truth == actual and type(truth) is type(actual)
            exact += matched
            fields[field]["exact"] += matched
            if truth is not None and matched:
                tp += 1
                fields[field]["tp"] += 1
            else:
                if actual is not None:
                    fp += 1
                    fields[field]["fp"] += 1
                if truth is not None:
                    fn += 1
                    fields[field]["fn"] += 1
        rows.append({"sample_id": sid, "kind": sample["kind"], "scenarios": sample.get("scenarios", []),
                     **{key: metrics[key] for key in ("character_edits", "reference_characters", "word_edits", "reference_words")},
                     "tp": tp, "fp": fp, "fn": fn, "exact": exact})
    sums = {key: sum(row[key] for row in rows) for key in ("character_edits", "reference_characters", "word_edits", "reference_words", "tp", "fp", "fn", "exact")}
    by_field = {
        name: {
            "precision": counts["tp"] / (counts["tp"] + counts["fp"]) if counts["tp"] + counts["fp"] else None,
            "recall": counts["tp"] / (counts["tp"] + counts["fn"]) if counts["tp"] + counts["fn"] else None,
            "exact_match_accuracy": counts["exact"] / len(rows),
            **counts,
        }
        for name, counts in fields.items()
    }
    covered_kinds = sorted({row["kind"] for row in rows})
    covered_scenarios = sorted({scenario for row in rows for scenario in row["scenarios"]})
    return {"dataset_origin": "real_deidentified", "sample_count": len(rows), "per_sample": rows,
            "by_field": by_field, "covered_kinds": covered_kinds, "covered_scenarios": covered_scenarios,
            "missing_kinds": sorted(KINDS - set(covered_kinds)),
            "missing_scenarios": sorted(SCENARIOS - set(covered_scenarios)),
            "micro_cer": sums["character_edits"] / sums["reference_characters"] if sums["reference_characters"] else None,
            "micro_wer": sums["word_edits"] / sums["reference_words"] if sums["reference_words"] else None,
            "field_precision": sums["tp"] / (sums["tp"] + sums["fp"]) if sums["tp"] + sums["fp"] else None,
            "field_recall": sums["tp"] / (sums["tp"] + sums["fn"]) if sums["tp"] + sums["fn"] else None,
            "field_exact_match_accuracy": sums["exact"] / (21 * len(rows))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = score(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Scored {report['sample_count']} reviewed de-identified documents; report: {args.output}")
