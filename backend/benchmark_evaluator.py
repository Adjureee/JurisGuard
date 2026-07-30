import os
import sys
import time
import json
import uuid
import datetime
import hashlib
import platform
from typing import Dict, Any, List
from backend.benchmark_metrics import calculate_cer, calculate_wer

# Try importing Levenshtein for fast C implementation
try:
    import Levenshtein
    HAS_LEVENSHTEIN = True
except ImportError:
    HAS_LEVENSHTEIN = False

# Import JurisGuard's AI service
from backend.ai_service import process_document

# --- Math & Metrics ---

def standardize_field(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, (dict, list)):
        return json.dumps(val).strip().lower()
    return str(val).strip().lower()

def calculate_nlp_accuracy(truth_dict: dict, extracted_dict: dict) -> float:
    """Calculate NLP Schema Matching Accuracy."""
    if not truth_dict:
        return 100.0
    
    total_fields = 0
    correct_fields = 0
    
    for key, truth_val in truth_dict.items():
        if key == "sections":
            continue
        total_fields += 1
        truth_std = standardize_field(truth_val)
        ext_std = standardize_field(extracted_dict.get(key, ""))
        if truth_std == ext_std:
            correct_fields += 1
            
    if total_fields == 0:
        return 100.0
        
    return (correct_fields / total_fields) * 100

# --- Test Harness & Synthetic Data ---

def create_synthetic_image(text: str, filename: str, quality_group: str):
    """Generates a dummy image with text using PIL."""
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageFilter
        import random
    except ImportError:
        print("Pillow not installed. Please `pip install Pillow` for synthetic image generation.")
        sys.exit(1)
        
    img = Image.new('RGB', (800, 1000), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    
    try:
        font = ImageFont.truetype("arial.ttf", 20)
    except IOError:
        font = ImageFont.load_default()
        
    d.text((10,10), text, fill=(0,0,0), font=font)
    
    if quality_group == "B":
        img = img.filter(ImageFilter.GaussianBlur(radius=1.2))
    elif quality_group == "C":
        img = img.filter(ImageFilter.GaussianBlur(radius=2.5))
        
    img.save(filename)

def generate_synthetic_dataset(output_dir: str = "./benchmark_data"):
    """Generates 30 test images in A, B, C groups."""
    os.makedirs(output_dir, exist_ok=True)
    dataset = []
    
    groups = {
        "A": {"name": "Clean Scanned Forms", "count": 10},
        "B": {"name": "Mobile Captures", "count": 10},
        "C": {"name": "Low-Quality Captures", "count": 10}
    }
    
    print(f"Generating synthetic dataset in {output_dir}...")
    for group_id, group_info in groups.items():
        for i in range(group_info["count"]):
            doc_id = f"DOC_{group_id}_{i+1:02d}"
            filename = os.path.join(output_dir, f"{doc_id}.png")
            
            sample_text = f"Control No: {doc_id}\nName: Juan Dela Cruz\nAge: 30\nSex: Male\nOffense: Reckless Imprudence\nDate: October 12, 2023"
            
            truth_dict = {
                "control_no": doc_id,
                "applicant_name": "Juan Dela Cruz",
                "applicant_age": "30",
                "applicant_sex": "Male",
            }
            
            create_synthetic_image(sample_text, filename, group_id)
            
            dataset.append({
                "doc_id": doc_id,
                "group": group_id,
                "file_path": filename,
                "truth_text": sample_text,
                "truth_schema": truth_dict
            })
    return dataset

# --- Terminal UI & Execution ---

class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_row(doc_id, group, cer, wer, acc, lat, is_header=False, is_summary=False):
    if is_header:
        print(f"{Colors.HEADER}{Colors.BOLD}{doc_id:<12} | {group:<8} | {cer:<8} | {wer:<8} | {acc:<10} | {lat:<10}{Colors.ENDC}")
        print("-" * 72)
    elif is_summary:
        print("=" * 72)
        print(f"{Colors.OKGREEN}{Colors.BOLD}{doc_id:<12} | {group:<8} | {cer:<8.2f} | {wer:<8.2f} | {acc:<10.2f} | {lat:<10.2f}{Colors.ENDC}")
    else:
        cer_str = f"{Colors.FAIL if cer > 20 else Colors.WARNING if cer > 5 else Colors.OKGREEN}{cer:8.2f}{Colors.ENDC}"
        wer_str = f"{Colors.FAIL if wer > 20 else Colors.WARNING if wer > 5 else Colors.OKGREEN}{wer:8.2f}{Colors.ENDC}"
        acc_str = f"{Colors.OKGREEN if acc > 90 else Colors.WARNING if acc > 70 else Colors.FAIL}{acc:10.2f}{Colors.ENDC}"
        
        print(f"{doc_id:<12} | {group:<8} | {cer_str} | {wer_str} | {acc_str} | {lat:10.2f}")

def dataset_fingerprint(dataset: list[dict]) -> str:
    digest = hashlib.sha256()
    for item in sorted(dataset, key=lambda row: row["doc_id"]):
        digest.update(item["doc_id"].encode("utf-8"))
        with open(item["file_path"], "rb") as sample:
            for chunk in iter(lambda: sample.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def run_benchmark(export_results: bool = False, allow_synthetic: bool = False):
    print(f"{Colors.BOLD}{Colors.OKCYAN}JurisGuard AI Pipeline - Benchmark Evaluator{Colors.ENDC}\n")
    
    dataset_dir = "./benchmark_data"
    manifest_path = os.path.join(dataset_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        if not allow_synthetic:
            raise RuntimeError(
                "Benchmark dataset manifest is unavailable. Regeneration is blocked; "
                "do not use generated benchmark data as a production result."
            )
        print("WARNING: generating synthetic development-only data; do not publish these as PAO benchmark results.")
        dataset = generate_synthetic_dataset(dataset_dir)
    else:
        with open(manifest_path, "r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        dataset = manifest.get("samples", [])
        if not dataset or any(not os.path.exists(item.get("file_path", "")) for item in dataset):
            raise RuntimeError("Benchmark manifest is missing usable sample paths")
        
    print_row("Doc ID", "Group", "CER (%)", "WER (%)", "NLP Acc(%)", "Latency(s)", is_header=True)
    
    results = []
    agg = {"cer": 0, "wer": 0, "acc": 0, "lat": 0, "count": 0}
    avg_cer = avg_wer = avg_acc = avg_lat = None
    
    for doc in dataset:
        start_time = time.perf_counter()
        
        try:
            # We pass include_benchmarks=True to the backend service
            extracted_data = process_document(
                file_path=doc["file_path"],
                extraction_mode="offline", 
                include_benchmarks=True
            )
            
            latency = time.perf_counter() - start_time
            service_benchmarks = extracted_data.get("_benchmarks", {})
            
            ocr_text = extracted_data.get("raw_text", "")
            offline_attempt = extracted_data.get("offline_attempt") or {}
            if offline_attempt.get("status") == "failed":
                engine_status, failure_reason = "failed", offline_attempt.get("reason", "offline_ocr_failed")
                cer = wer = acc = process_lat = None
            else:
                engine_status, failure_reason = "completed", None
                cer = calculate_cer(doc["truth_text"], ocr_text)
                wer = calculate_wer(doc["truth_text"], ocr_text)
                acc = calculate_nlp_accuracy(doc["truth_schema"], extracted_data)
                process_lat = service_benchmarks.get("processing_latency_seconds", latency)
            
        except Exception as e:
            print(f"{Colors.FAIL}Error processing {doc['doc_id']}: {e}{Colors.ENDC}")
            engine_status, failure_reason = "failed", str(e)
            cer = wer = acc = process_lat = None
            extracted_data = {"error": str(e)}

        results.append({
            "doc_id": doc["doc_id"],
            "group": doc["group"],
            "cer": cer,
            "wer": wer,
            "nlp_accuracy": acc,
            "latency": process_lat,
            "engine_status": engine_status,
            "failure_reason": failure_reason,
            "raw_text": extracted_data.get("raw_text") if engine_status == "completed" else None,
            "extracted_data": extracted_data,
            "truth_schema": doc["truth_schema"]
        })
        
        if engine_status == "completed":
            agg["cer"] += cer
            agg["wer"] += wer
            agg["acc"] += acc
            agg["lat"] += process_lat
            agg["count"] += 1
            print_row(doc["doc_id"], doc["group"], cer, wer, acc, process_lat)
        else:
            print(f"{doc['doc_id']:<12} | {doc['group']:<8} | unavailable (engine failed: {failure_reason})")
        
    if agg["count"] > 0:
        avg_cer = agg["cer"] / agg["count"]
        avg_wer = agg["wer"] / agg["count"]
        avg_acc = agg["acc"] / agg["count"]
        avg_lat = agg["lat"] / agg["count"]
        print_row("AGGREGATE", "ALL", avg_cer, avg_wer, avg_acc, avg_lat, is_summary=True)
        
    if export_results:
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        export_file = f"benchmark_results_{timestamp}.json"
        with open(export_file, "w") as f:
            json.dump({
                "summary": {
                    "avg_cer": avg_cer,
                    "avg_wer": avg_wer,
                    "avg_nlp_accuracy": avg_acc,
                    "avg_latency": avg_lat,
                    "total_documents": len(dataset),
                    "completed_engine_samples": agg["count"],
                },
                "dataset": {
                    "sample_count": len(dataset),
                    "sha256": dataset_fingerprint(dataset),
                    "aggregate_formula": "arithmetic mean over completed engine samples only",
                },
                "runtime": {
                    "python": sys.version,
                    "platform": platform.platform(),
                    "preprocessing": "backend.ai_service offline default configuration",
                },
                "individual_results": results
            }, f, indent=4)
        print(f"\n{Colors.OKBLUE}Detailed individual results exported to {export_file}{Colors.ENDC}")

if __name__ == "__main__":
    export = "--export" in sys.argv
    run_benchmark(export_results=export, allow_synthetic="--generate-synthetic" in sys.argv)
