"""Local-only PAO comparison. Outputs contain private OCR; choose ignored storage."""
import argparse
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def verified_scores(sections, reference=None):
    counts = dict(correct=0, omitted=0, incorrect=0, unverified=0)
    for path, field in (reference or {}).get('fields', {}).items():
        if field.get('verified') is not True:
            counts['unverified'] += 1
            continue
        section, key = path.split('.')
        actual, expected = sections[section][key], field['value']
        counts['correct' if actual == expected else 'omitted' if not actual and expected else 'incorrect'] += 1
    total = counts['correct']+counts['omitted']+counts['incorrect']
    return counts, dict(verified_fields=total, exact_match_percent=round(100*counts['correct']/total, 2) if total else None,
                        scope='Verified fields only; not an estimate of overall handwriting accuracy.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ocr-module', type=Path)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--replay', type=Path, help='Re-map saved OCR evidence without running recognition again.')
    args = parser.parse_args()
    import subprocess
    output = args.output.resolve()
    if subprocess.run(['git', 'check-ignore', '-q', str(output)], cwd=ROOT).returncode:
        parser.error('Output must be in Git-ignored storage.')
    from local_ocr import LocalOCR, OCRDocument
    if args.ocr_module:
        spec = importlib.util.spec_from_file_location('comparison_ocr', args.ocr_module)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        LocalOCR = module.LocalOCR
    from paper_intake import extract_paper_intake
    from paper_checkboxes import extract_visual_boxes
    started = time.perf_counter()
    engine = LocalOCR()
    if args.replay:
        saved = json.loads(args.replay.read_text(encoding='utf-8'))['ocr']
        ocr = OCRDocument(saved['raw_text'], saved['layout'], 'replayed', 1, [], saved['timings'], saved['refinements'])
    else:
        ocr = engine.extract(args.image)
    result = extract_paper_intake(ocr.raw_text, ocr.layout, ocr.refinements)
    result['checkbox_states'], _ = extract_visual_boxes(args.image, ocr.raw_text, ocr.layout)
    result['ocr'] = dict(raw_text=ocr.raw_text, layout=ocr.layout, refinements=ocr.refinements, timings=ocr.timings)
    result['seconds'] = round(time.perf_counter()-started, 3)
    result['source_sha256'] = hashlib.sha256(args.image.read_bytes()).hexdigest()
    result['recognition_replayed'] = bool(args.replay)
    from paper_provenance import attach_provenance, local_settings
    attach_provenance(result, args.image, 'local', local_settings(engine))
    reference = json.loads(args.reference.read_text(encoding='utf-8-sig')) if args.reference else None
    counts, accuracy = verified_scores(result['sections'], reference)
    result['verified_field_scores'] = counts
    result['verified_field_accuracy'] = accuracy
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(dict(seconds=result['seconds'], verified_field_scores=counts, verified_field_accuracy=accuracy)))


if __name__ == '__main__':
    main()
