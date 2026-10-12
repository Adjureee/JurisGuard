"""Run each manuscript OCR/NLP candidate separately on identical local samples.

Reports contain sample IDs and metrics, never image bytes, OCR text, or names.
The manuscript's published numbers are not loaded or treated as measurements.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import threading
import time
from dataclasses import replace
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from config import LabConfig
from .document_router import DocumentRouter
from .evaluate import load_ground_truth, ocr_metrics
from .nlp_candidates import TARGET_FIELDS, make_nlp_candidate
from .ocr_pipeline import make_engine


GROUPS = ("clean", "mobile", "low_quality")
OCR_CANDIDATES = ("tesseract", "easyocr", "paddleocr")
NLP_CANDIDATES = ("nltk_rules", "bert_ner", "spacy_regex")


def _package(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def _rss_mb() -> float | None:
    try:
        import psutil
        process = psutil.Process()
        members = [process] + process.children(recursive=True)
        return round(sum(member.memory_info().rss for member in members if member.is_running()) / 1048576, 2)
    except ImportError:
        return None
    except Exception:
        return None


class _PeakMemory:
    """Sample current process and OCR child processes; child CPU is approximate."""

    def __init__(self) -> None:
        self.peak_mb: float | None = None
        self.child_cpu_seconds: dict[int, float] = {}
        self._baseline_child_cpu: dict[int, float] = {}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self) -> None:
        while not self._stop.is_set():
            current = _rss_mb()
            if current is not None:
                self.peak_mb = max(self.peak_mb or 0.0, current)
            try:
                import psutil
                for child in psutil.Process().children(recursive=True):
                    if child.is_running():
                        times = child.cpu_times()
                        self.child_cpu_seconds[child.pid] = max(
                            self.child_cpu_seconds.get(child.pid, 0.0),
                            times.user + times.system - self._baseline_child_cpu.get(child.pid, 0.0),
                        )
            except Exception:
                pass
            self._stop.wait(0.02)

    def __enter__(self):
        try:
            import psutil
            for child in psutil.Process().children(recursive=True):
                times = child.cpu_times()
                self._baseline_child_cpu[child.pid] = times.user + times.system
        except Exception:
            pass
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self._stop.set()
        self._thread.join()


def _path(manifest: Path, relative: str) -> Path:
    return (manifest.parent / relative).resolve()


def load_manifest(path: Path, *, mode: str, require_30: bool = False, expected_samples: int | None = None, nlp_text_dir: Path | None = None) -> tuple[str, list[dict]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("dataset_origin") not in {"real", "synthetic"}:
        raise ValueError("manifest needs dataset_origin: real or synthetic")
    samples = data.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ValueError("manifest needs at least one sample")
    seen: set[str] = set()
    prepared = []
    for item in samples:
        if not isinstance(item, dict) or not isinstance(item.get("sample_id"), str) or not item["sample_id"].strip():
            raise ValueError("each sample needs a nonempty sample_id")
        sample_id = item["sample_id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", sample_id):
            raise ValueError("sample_id may contain only letters, digits, underscores, and hyphens")
        if sample_id in seen:
            raise ValueError(f"duplicate sample_id: {sample_id}")
        seen.add(sample_id)
        if item.get("quality_group") not in GROUPS:
            raise ValueError(f"{sample_id}: quality_group must be clean, mobile, or low_quality")
        truth_path = _path(path, item["ground_truth"])
        truth = load_ground_truth(truth_path)
        if truth.get("sample_origin") != data["dataset_origin"]:
            raise ValueError(f"{sample_id}: ground truth sample_origin differs from manifest")
        if truth.get("sample_id") != sample_id:
            raise ValueError(f"{sample_id}: ground truth sample_id differs from manifest")
        source_key = "image" if mode == "ocr" else "nlp_text"
        if mode == "nlp" and nlp_text_dir is not None:
            source = (nlp_text_dir / f"{sample_id}.txt").resolve()
        elif not isinstance(item.get(source_key), str):
            raise ValueError(f"{sample_id}: {source_key} is required for {mode}")
        else:
            source = _path(path, item[source_key])
        if not source.is_file():
            raise FileNotFoundError(f"{sample_id}: {source_key} file does not exist")
        if mode == "ocr" and "reference_text" not in truth:
            raise ValueError(f"{sample_id}: a reviewed reference_text is required for CER/WER")
        prepared.append({"sample_id": sample_id, "quality_group": item["quality_group"], "source": source, "truth": truth})
    if require_30 and (len(prepared) != 30 or any(sum(item["quality_group"] == group for item in prepared) != 10 for group in GROUPS) or data["dataset_origin"] != "real"):
        raise ValueError("manuscript replication requires 30 real samples: 10 clean, 10 mobile, 10 low_quality")
    if expected_samples is not None:
        if expected_samples < 1:
            raise ValueError("expected sample count must be positive")
        if len(prepared) != expected_samples or data["dataset_origin"] != "real":
            raise ValueError(f"this evaluation requires exactly {expected_samples} real samples")
    return data["dataset_origin"], prepared


def _mean(values: list[float | None]) -> float | None:
    available = [value for value in values if value is not None]
    return round(statistics.mean(available), 5) if available else None


def _summarize_ocr(rows: list[dict]) -> dict:
    return {
        "samples": len(rows),
        "mean_cer_percent": _mean([row["cer_percent"] for row in rows]),
        "mean_wer_percent": _mean([row["wer_percent"] for row in rows]),
        "micro_cer_percent": round(100 * sum(row["character_edits"] for row in rows) / sum(row["reference_characters"] for row in rows), 5) if sum(row["reference_characters"] for row in rows) else None,
        "micro_wer_percent": round(100 * sum(row["word_edits"] for row in rows) / sum(row["reference_words"] for row in rows), 5) if sum(row["reference_words"] for row in rows) else None,
        "mean_wall_seconds": _mean([row["wall_seconds"] for row in rows]),
        "mean_cpu_seconds": _mean([row["cpu_seconds"] for row in rows]),
    }


def _summarize_nlp(rows: list[dict]) -> dict:
    expected = sum(row["annotated_target_values"] for row in rows)
    matched = sum(row["exact_target_matches"] for row in rows)
    return {
        "samples": len(rows),
        "annotated_target_values": expected,
        "exact_target_matches": matched,
        "non_null_target_accuracy_percent": round(100 * matched / expected, 5) if expected else None,
        "unsupported_predictions": sum(row["unsupported_predictions"] for row in rows),
        "mean_wall_seconds": _mean([row["wall_seconds"] for row in rows]),
        "mean_cpu_seconds": _mean([row["cpu_seconds"] for row in rows]),
    }


def run_ocr(manifest: Path, candidate: str, *, require_30: bool = False, expected_samples: int | None = None, warmup: bool = True, ocr_text_dir: Path | None = None) -> dict:
    origin, samples = load_manifest(manifest, mode="ocr", require_30=require_30, expected_samples=expected_samples)
    config = replace(LabConfig.from_env(), ocr_engine=candidate)
    startup = time.perf_counter()
    engine = make_engine(config)
    if warmup:
        engine.extract(samples[0]["source"])
    startup_seconds = round(time.perf_counter() - startup, 5)
    memory_after_load = _rss_mb()
    rows = []
    if ocr_text_dir is not None:
        ocr_text_dir.mkdir(parents=True, exist_ok=True)
    for item in samples:
        cpu_start, wall_start = time.process_time(), time.perf_counter()
        with _PeakMemory() as memory:
            result = engine.extract(item["source"])
        elapsed = time.perf_counter() - wall_start
        cpu = time.process_time() - cpu_start + sum(memory.child_cpu_seconds.values())
        metrics = ocr_metrics(item["truth"]["reference_text"], result.raw_text)
        if ocr_text_dir is not None:
            (ocr_text_dir / f"{item['sample_id']}.txt").write_text(result.raw_text, encoding="utf-8")
        rows.append({
            "sample_id": item["sample_id"], "quality_group": item["quality_group"],
            "character_edits": metrics["character_edits"], "reference_characters": metrics["reference_characters"],
            "word_edits": metrics["word_edits"], "reference_words": metrics["reference_words"],
            "cer_percent": round(100 * metrics["cer"], 5) if metrics["cer"] is not None else None,
            "wer_percent": round(100 * metrics["wer"], 5) if metrics["wer"] is not None else None,
            "wall_seconds": round(elapsed, 5), "cpu_seconds": round(cpu, 5), "peak_rss_mb": memory.peak_mb, "rss_after_mb": _rss_mb(),
        })
    return {
        "mode": "ocr", "candidate": candidate, "dataset_origin": origin,
        "metrics_definition": "Exact Unicode character and whitespace-token word edit distance against reviewed transcripts; mean is per-sample macro average. No text normalization.",
        "warmup_on_first_sample": warmup, "startup_and_warmup_seconds": startup_seconds,
        "ocr_text_dir": str(ocr_text_dir) if ocr_text_dir is not None else None,
        "rss_after_load_mb": memory_after_load,
        "versions": {name: _package(name) for name in ("pytesseract", "easyocr", "paddleocr", "paddlepaddle")},
        "overall": _summarize_ocr(rows),
        "groups": {group: _summarize_ocr([row for row in rows if row["quality_group"] == group]) for group in GROUPS},
        "samples": rows,
    }


def run_nlp(manifest: Path, candidate: str, *, bert_model: Path | None = None, require_30: bool = False, expected_samples: int | None = None, warmup: bool = True, nlp_text_dir: Path | None = None) -> dict:
    origin, samples = load_manifest(manifest, mode="nlp", require_30=require_30, expected_samples=expected_samples, nlp_text_dir=nlp_text_dir)
    startup = time.perf_counter()
    engine = make_nlp_candidate(candidate, bert_model=bert_model)
    if warmup:
        engine.extract(samples[0]["source"].read_text(encoding="utf-8"))
    startup_seconds = round(time.perf_counter() - startup, 5)
    memory_after_load = _rss_mb()
    router = DocumentRouter()
    rows = []
    for item in samples:
        text = item["source"].read_text(encoding="utf-8")
        cpu_start, wall_start = time.process_time(), time.perf_counter()
        with _PeakMemory() as memory:
            routed_type = router.classify_document(text)
            inventory = engine.extract(text) if routed_type in {"intake_form", "rtc_decision"} else None
        elapsed = time.perf_counter() - wall_start
        cpu = time.process_time() - cpu_start + sum(memory.child_cpu_seconds.values())
        expected = item["truth"]["inventory"]
        actual = inventory or {field: None for field in TARGET_FIELDS}
        annotated = sum(expected[field] is not None for field in TARGET_FIELDS)
        matched = sum(expected[field] is not None and expected[field] == actual[field] for field in TARGET_FIELDS)
        unsupported = sum(expected[field] is None and actual[field] is not None for field in TARGET_FIELDS)
        rows.append({
            "sample_id": item["sample_id"], "quality_group": item["quality_group"],
            "expected_document_type": item["truth"]["document_type"], "routed_document_type": routed_type,
            "annotated_target_values": annotated, "exact_target_matches": matched,
            "unsupported_predictions": unsupported,
            "wall_seconds": round(elapsed, 5), "cpu_seconds": round(cpu, 5), "peak_rss_mb": memory.peak_mb, "rss_after_mb": _rss_mb(),
        })
    return {
        "mode": "nlp", "candidate": candidate, "dataset_origin": origin,
        "target_fields": TARGET_FIELDS,
        "metrics_definition": "Exact matches over non-null reviewed values in the three declared entity fields. Shared deterministic routing is included in every candidate's timing. This is not a trained-model score.",
        "text_source": str(nlp_text_dir) if nlp_text_dir is not None else "manifest nlp_text paths; no OCR execution in this stage",
        "bert_model": str(bert_model) if candidate == "bert_ner" and bert_model else None,
        "warmup_on_first_sample": warmup, "startup_and_warmup_seconds": startup_seconds,
        "rss_after_load_mb": memory_after_load,
        "versions": {name: _package(name) for name in ("nltk", "spacy", "transformers", "torch")},
        "overall": _summarize_nlp(rows),
        "groups": {group: _summarize_nlp([row for row in rows if row["quality_group"] == group]) for group in GROUPS},
        "samples": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Reproducible, separate 3 OCR / 3 NLP manuscript comparison")
    parser.add_argument("mode", choices=("ocr", "nlp"))
    parser.add_argument("candidate", choices=OCR_CANDIDATES + NLP_CANDIDATES)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bert-model", type=Path, help="existing local token-classification checkpoint")
    parser.add_argument("--ocr-text-dir", type=Path, help="save private OCR text files for a later NLP run")
    parser.add_argument("--nlp-text-dir", type=Path, help="read identical <sample_id>.txt files for every NLP candidate")
    parser.add_argument("--require-manuscript-30", action="store_true")
    parser.add_argument("--require-samples", type=int, help="require this number of real annotated samples")
    parser.add_argument("--no-warmup", action="store_true")
    args = parser.parse_args()
    if (args.mode == "ocr" and args.candidate not in OCR_CANDIDATES) or (args.mode == "nlp" and args.candidate not in NLP_CANDIDATES):
        parser.error("candidate does not belong to the selected mode")
    if args.require_manuscript_30 and args.require_samples not in (None, 30):
        parser.error("choose either the original 30-sample protocol or a different sample count")
    try:
        report = run_ocr(args.manifest, args.candidate, require_30=args.require_manuscript_30, expected_samples=args.require_samples, warmup=not args.no_warmup, ocr_text_dir=args.ocr_text_dir) if args.mode == "ocr" else run_nlp(args.manifest, args.candidate, bert_model=args.bert_model, require_30=args.require_manuscript_30, expected_samples=args.require_samples, warmup=not args.no_warmup, nlp_text_dir=args.nlp_text_dir)
    except (ValueError, FileNotFoundError, RuntimeError) as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"candidate": report["candidate"], "dataset_origin": report["dataset_origin"], "overall": report["overall"], "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
