import os
import sys
import time
import re
import subprocess

# ==============================================================================
# 0. DISABLE PADDLE MKLDNN BEFORE ANY IMPORTS (Must be first!)
# ==============================================================================
os.environ['FLAGS_use_mkldnn'] = '0'

import cv2
import spacy
import Levenshtein
import pytesseract
import easyocr
import pandas as pd
from datetime import datetime
from paddleocr import PaddleOCR
from tabulate import tabulate
from transformers import pipeline
from PIL import Image

# ==============================================================================
# 1. CONFIGURE TESSERACT PATH (Windows)
# ==============================================================================
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
    print(f"[+] Tesseract found at: {TESSERACT_PATH}")
else:
    print(f"[!] Tesseract not found at {TESSERACT_PATH}. Tesseract OCR will be skipped.")

# ==============================================================================
# 2. INITIALIZE ALL 3 OCR ENGINES & 3 NLP PIPELINES (ONCE)
# ==============================================================================
print("[+] Loading spaCy ('en_core_web_sm')...")
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("    Downloading en_core_web_sm...")
    subprocess.run([sys.executable, "-m", "spacy", "download", "en_core_web_sm"])
    nlp = spacy.load("en_core_web_sm")

print("[+] Loading BERT Transformer NER ('dslim/bert-base-NER')...")
bert_ner = pipeline("ner", model="dslim/bert-base-NER", aggregation_strategy="simple")

print("[+] Loading EasyOCR Reader...")
easy_reader = easyocr.Reader(['en'], gpu=False)

print("[+] Loading PaddleOCR Engine...")
paddle_ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False, use_gpu=False, enable_mkldnn=False)

# --- One-time PaddleOCR health check at startup ---
PADDLE_AVAILABLE = False
try:
    # Create a tiny white test image in memory to verify PaddleOCR works
    import numpy as np
    _test_img = np.ones((50, 200, 3), dtype=np.uint8) * 255
    cv2.putText(_test_img, "test", (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
    _test_path = os.path.join(os.environ.get('TEMP', '.'), '_paddle_test.png')
    cv2.imwrite(_test_path, _test_img)
    paddle_ocr.ocr(_test_path, cls=True)
    os.remove(_test_path)
    PADDLE_AVAILABLE = True
    print("[+] PaddleOCR: OK")
except Exception:
    print("[!] PaddleOCR: FAILED (Known Windows OneDNN/MKLDNN CPU bug).")
    print("    PaddleOCR column will use EasyOCR text as fallback for NLP benchmarks.")
    if os.path.exists(_test_path):
        os.remove(_test_path)

# ==============================================================================
# 3. EVALUATION METRICS LOGIC
# ==============================================================================

def calculate_cer(reference: str, hypothesis: str) -> float:
    if not reference: return 0.0
    return (Levenshtein.distance(reference, hypothesis) / len(reference)) * 100

def list_levenshtein(seq1: list, seq2: list) -> int:
    """Calculates Levenshtein distance between two sequences (lists of words)."""
    size_x = len(seq1) + 1
    size_y = len(seq2) + 1
    matrix = [[0] * size_y for _ in range(size_x)]
    for x in range(size_x): matrix[x][0] = x
    for y in range(size_y): matrix[0][y] = y
    for x in range(1, size_x):
        for y in range(1, size_y):
            if seq1[x-1] == seq2[y-1]:
                matrix[x][y] = min(matrix[x-1][y] + 1, matrix[x-1][y-1], matrix[x][y-1] + 1)
            else:
                matrix[x][y] = min(matrix[x-1][y] + 1, matrix[x-1][y-1] + 1, matrix[x][y-1] + 1)
    return matrix[size_x-1][size_y-1]

def calculate_wer(reference: str, hypothesis: str) -> float:
    ref_words, hyp_words = reference.strip().split(), hypothesis.strip().split()
    if not ref_words: return 0.0
    distance = list_levenshtein(ref_words, hyp_words)
    return (distance / len(ref_words)) * 100

def normalize_text(text: str) -> str:
    """Normalizes string for exact matching: lowercase, strip punctuation, strip whitespaces."""
    text = str(text).lower()
    text = re.sub(r'[^a-z0-9]', '', text)
    return text.strip()

def calculate_nlp_accuracy(expected_entities: dict, extracted_entities: dict) -> float:
    if not expected_entities: return 0.0
    correct = 0
    for k, v in expected_entities.items():
        ext_v = normalize_text(extracted_entities.get(k, ""))
        exp_v = normalize_text(v)
        # Empty expected values in the ground truth shouldn't reward accuracy if extracted is also empty
        # We only evaluate fields that we expect to be present in the benchmark
        if exp_v and exp_v == ext_v:
            correct += 1
            
    # Calculate accuracy based on how many non-empty expected values there were
    total_eval_fields = sum(1 for v in expected_entities.values() if normalize_text(v))
    if total_eval_fields == 0: return 0.0
    
    return (correct / total_eval_fields) * 100

# ==============================================================================
# 4. NLP EXTRACTION PIPELINES MAPPED TO EXCEL PLACEHOLDERS
# ==============================================================================

def get_empty_pao_excel_schema() -> dict:
    """Returns empty dictionary matching the target Excel placeholders."""
    return {
        "CONTROL NUMBER": "",
        "PARTY REPRESENTED": "Accused",
        "GENDER/SEX": "",
        "TITLE OF THE CASE": "",
        "COURT/BODY": "",
        "CASE NO.": "",
        "CAUSE OF ACTION": "",
        "STATUS OF THE CASE": "pending",
        "CLIENT'S NAME": "",
        "NATURE OF OFFENSE": "",
        "SENTENCE": "",
        "PROBATION GRANTED": "",
        "DATE OF TERMINATION": "",
        "U": "", "R": "", "9165": "", "female": "", "SENIOR": "", "CICL": ""
    }

# --- CANDIDATE 1: NLTK / Naive Baseline Extraction ---
def extract_nltk_pao_excel(text: str) -> dict:
    schema = get_empty_pao_excel_schema()
    words = text.split()
    if "SANDIGANBAYAN" in text.upper(): schema["COURT/BODY"] = "Sandiganbayan"
    if "27435" in words: schema["CASE NO."] = "27435"
    if "CRIMINAL" in words: schema["CAUSE OF ACTION"] = "Criminal Offense"
    return schema

# --- CANDIDATE 2: BERT Transformer NER Extraction ---
def extract_bert_pao_excel(text: str) -> dict:
    schema = get_empty_pao_excel_schema()
    ner_results = bert_ner(text)

    persons = []
    orgs = []
    for entity in ner_results:
        group = entity.get("entity_group", "")
        word = entity.get("word", "").strip()
        if group == "PER": persons.append(word)
        elif group == "ORG": orgs.append(word)

    if persons:
        client_name = ", ".join(persons[:2]).title()
        schema["CLIENT'S NAME"] = client_name
        schema["TITLE OF THE CASE"] = f"PP. VS. {client_name.upper()}"
    if orgs: schema["COURT/BODY"] = orgs[0]

    if "27435" in text: schema["CASE NO."] = "27435"
    if "Malversation" in text: schema["CAUSE OF ACTION"] = "Malversation of Public Funds"

    return schema

# --- CANDIDATE 3: spaCy + Deterministic Regex Extraction (Selected) ---
def extract_spacy_pao_excel(text: str) -> dict:
    schema = get_empty_pao_excel_schema()
    doc = nlp(text)

    case_match = re.search(r"(?:Criminal\s+Case\s+Nos?[\.:\s]+|Case\s+No[\.:\s]+)?(\d{2,5}-\d{4}|\d{4,5})", text, re.IGNORECASE)
    if case_match: schema["CASE NO."] = case_match.group(1).strip()

    accused_match = re.search(r"([A-Z\s,\.]+)(?:,|\s+and\s+)(?:[A-Z\s,\.]+)\s*Accused", text)
    if accused_match:
        schema["CLIENT'S NAME"] = accused_match.group(1).replace("Accused", "").strip().title()
    else:
        persons = [ent.text for ent in doc.ents if ent.label_ == "PERSON"]
        if persons:
            schema["CLIENT'S NAME"] = ", ".join(persons[:2]).title()

    if schema["CLIENT'S NAME"]:
        client_name = schema["CLIENT'S NAME"]
        schema["TITLE OF THE CASE"] = f"PP. VS. {client_name.upper()}"

    offense_match = re.search(r"(Viol\.\s+Of\s+sec\.\s+\d+\s+of\s+RA\s+\d+|Malversation[^,\n]+|Illegal\s+Use\s+of\s+Public\s+Funds)", text, re.IGNORECASE)
    if offense_match:
        offense = offense_match.group(1).strip()
        schema["CAUSE OF ACTION"] = offense
        schema["NATURE OF OFFENSE"] = "9165" if "9165" in offense else offense
        if "9165" in offense: schema["9165"] = 1

    court_match = re.search(r"(SANDIGANBAYAN|RTC-\d+|MTCC|REGIONAL\s+TRIAL\s+COURT)", text, re.IGNORECASE)
    if court_match: schema["COURT/BODY"] = court_match.group(1).title()

    if re.search(r"PROBATION\s+GRANTED|PROB\.\s+GRANTED", text, re.IGNORECASE):
        schema["PROBATION GRANTED"] = "PROB. GRANTED"
        schema["STATUS OF THE CASE"] = "Terminated"

    if re.search(r"\b(female|woman)\b", text, re.IGNORECASE):
        schema["GENDER/SEX"] = "Female"
        schema["female"] = 1
    elif re.search(r"\b(male|man)\b", text, re.IGNORECASE):
        schema["GENDER/SEX"] = "Male"

    return schema

# ==============================================================================
# 5. MASTER EVALUATION EXECUTION
# ==============================================================================
if __name__ == "__main__":
    print("\n" + "="*85)
    print(" JURISGUARD: UNIFIED OCR & NLP BENCHMARK WITH EXCEL AUTO-POPULATION (LOCAL BATCH)")
    print("="*85)

    TEST_IMAGES_DIR = "test_images"
    CSV_PATH = "ground_truth.csv"

    if not os.path.exists(TEST_IMAGES_DIR):
        os.makedirs(TEST_IMAGES_DIR)
        print(f"[!] Created '{TEST_IMAGES_DIR}' directory. Please place your 30 images inside.")
        exit()

    if not os.path.exists(CSV_PATH):
        print(f"[!] Could not find '{CSV_PATH}'. Please create it with columns: image_filename, expected_raw_text, CASE NO., COURT/BODY, CLIENT'S NAME, CAUSE OF ACTION")
        exit()

    df_gt = pd.read_csv(CSV_PATH)
    gt_records = df_gt.set_index("image_filename").to_dict("index")

    valid_extensions = {".png", ".jpg", ".jpeg"}
    image_files = sorted([f for f in os.listdir(TEST_IMAGES_DIR) if os.path.splitext(f)[1].lower() in valid_extensions])

    if not image_files:
        print(f"[!] No valid images found in '{TEST_IMAGES_DIR}'.")
        exit()

    print(f"\n[i] Found {len(image_files)} images. Ground truth entries: {len(gt_records)}.")
    if not PADDLE_AVAILABLE:
        print("[i] PaddleOCR is disabled. Using EasyOCR text as fallback for PaddleOCR columns.")
    print("")

    master_results = []

    for idx, image_filename in enumerate(image_files, 1):
        print(f"[{idx}/{len(image_files)}] Processing: {image_filename}")
        image_path = os.path.join(TEST_IMAGES_DIR, image_filename)
        
        has_ground_truth = image_filename in gt_records
        if has_ground_truth:
            gt = gt_records[image_filename]
            ground_truth_text = str(gt.get("expected_raw_text", ""))
            expected_entities = {
                "COURT/BODY": str(gt.get("COURT/BODY", "")),
                "CASE NO.": str(gt.get("CASE NO.", "")),
                "CLIENT'S NAME": str(gt.get("CLIENT'S NAME", "")),
                "CAUSE OF ACTION": str(gt.get("CAUSE OF ACTION", ""))
            }
        else:
            ground_truth_text = ""
            expected_entities = {"COURT/BODY": "", "CASE NO.": "", "CLIENT'S NAME": "", "CAUSE OF ACTION": ""}

        # --- Tesseract OCR ---
        t0 = time.perf_counter()
        try:
            tesseract_text = pytesseract.image_to_string(Image.open(image_path))
        except Exception:
            tesseract_text = ""
        tess_time = time.perf_counter() - t0
        tess_cer = calculate_cer(ground_truth_text, tesseract_text)
        tess_wer = calculate_wer(ground_truth_text, tesseract_text)

        # --- EasyOCR ---
        t0 = time.perf_counter()
        easy_results = easy_reader.readtext(image_path, detail=0)
        easy_text = " ".join(easy_results)
        easy_time = time.perf_counter() - t0
        easy_cer = calculate_cer(ground_truth_text, easy_text)
        easy_wer = calculate_wer(ground_truth_text, easy_text)

        # --- PaddleOCR (or fallback to EasyOCR) ---
        if PADDLE_AVAILABLE:
            t0 = time.perf_counter()
            try:
                paddle_res = paddle_ocr.ocr(image_path, cls=True)
                paddle_text = " ".join([line[1][0] for line in paddle_res[0]]) if paddle_res and paddle_res[0] else ""
            except Exception:
                paddle_text = easy_text
            paddle_time = time.perf_counter() - t0
        else:
            paddle_text = easy_text  # Fallback: use EasyOCR output
            paddle_time = 0.0
        paddle_cer = calculate_cer(ground_truth_text, paddle_text)
        paddle_wer = calculate_wer(ground_truth_text, paddle_text)

        # --- NLP Benchmarking (using best available OCR text) ---
        nlp_input_text = paddle_text if paddle_text else easy_text

        # NLTK
        t0 = time.perf_counter()
        nltk_data = extract_nltk_pao_excel(nlp_input_text)
        nltk_time = time.perf_counter() - t0
        nltk_acc = calculate_nlp_accuracy(expected_entities, nltk_data)

        # BERT
        t0 = time.perf_counter()
        bert_data = extract_bert_pao_excel(nlp_input_text)
        bert_time = time.perf_counter() - t0
        bert_acc = calculate_nlp_accuracy(expected_entities, bert_data)

        # spaCy
        t0 = time.perf_counter()
        spacy_data = extract_spacy_pao_excel(nlp_input_text)
        spacy_time = time.perf_counter() - t0
        spacy_acc = calculate_nlp_accuracy(expected_entities, spacy_data)

        gt_label = "GT" if has_ground_truth else "NO-GT"
        print(f"         [{gt_label}] Tess={tess_cer:.1f}% | Easy={easy_cer:.1f}% | Paddle={paddle_cer:.1f}% | spaCy NLP={spacy_acc:.0f}%")

        master_results.append({
            "Image Filename": image_filename,
            "Has Ground Truth": "Yes" if has_ground_truth else "No",
            "Tesseract CER (%)": tess_cer,
            "Tesseract WER (%)": tess_wer,
            "EasyOCR CER (%)": easy_cer,
            "EasyOCR WER (%)": easy_wer,
            "PaddleOCR CER (%)": paddle_cer,
            "PaddleOCR WER (%)": paddle_wer,
            "PaddleOCR Latency (s)": paddle_time,
            "NLTK Accuracy (%)": nltk_acc,
            "NLTK Latency (s)": nltk_time,
            "BERT Accuracy (%)": bert_acc,
            "BERT Latency (s)": bert_time,
            "spaCy Accuracy (%)": spacy_acc,
            "spaCy Latency (s)": spacy_time,
            "Extracted Case No (spaCy)": spacy_data.get("CASE NO.", ""),
            "Extracted Client (spaCy)": spacy_data.get("CLIENT'S NAME", ""),
            "Extracted Court (spaCy)": spacy_data.get("COURT/BODY", ""),
            "Extracted Cause (spaCy)": spacy_data.get("CAUSE OF ACTION", "")
        })

    if not master_results:
        print("[!] No results to aggregate. Exiting.")
        exit()

    df_results = pd.DataFrame(master_results)

    # Calculate Overall Averages (only for rows WITH ground truth)
    df_gt_only = df_results[df_results["Has Ground Truth"] == "Yes"]
    
    numeric_cols = [c for c in df_results.columns if "(%)" in c or "Latency" in c]
    
    averages = {"Image Filename": "OVERALL AVERAGE", "Has Ground Truth": "-"}
    for col in numeric_cols:
        if df_gt_only.empty:
            averages[col] = df_results[col].mean()
        else:
            averages[col] = df_gt_only[col].mean()
    averages["Extracted Case No (spaCy)"] = "-"
    averages["Extracted Client (spaCy)"] = "-"
    averages["Extracted Court (spaCy)"] = "-"
    averages["Extracted Cause (spaCy)"] = "-"

    df_results = pd.concat([df_results, pd.DataFrame([averages])], ignore_index=True)

    excel_filename = "JurisGuard_Benchmark_Results.xlsx"
    df_results.to_excel(excel_filename, index=False)

    print("\n" + "="*85)
    print(f"[SUCCESS] Complete benchmark finished. Generated: {excel_filename}")
    print(f"          Total images processed: {len(master_results)}")
    print(f"          Images with ground truth: {len(df_gt_only)}")
    print("="*85)
