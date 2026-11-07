"""Content fingerprints for the scoped paper pipeline; no document text is logged."""
import hashlib
import json
from importlib.metadata import version, PackageNotFoundError
from pathlib import Path


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def local_settings(ocr):
    if hasattr(ocr, '_paper_settings_snapshot'):
        return ocr._paper_settings_snapshot
    settings = {key: getattr(ocr, key, None) for key in ('model_profile', 'max_dimension', 'det_limit', 'cpu_threads', 'recognition_batch_size', 'enable_mkldnn')}
    import os
    settings['refine_intake'] = os.getenv('LOCAL_OCR_REFINE_INTAKE', 'true').lower() in ('1','true','yes','on')
    settings['models'] = {}
    for key in ('det_model','rec_model'):
        directory = getattr(ocr,key,None)
        settings['models'][key] = ({p.name:digest_file(p) for p in sorted(Path(directory).iterdir()) if p.name in ('inference.json','inference.pdiparams','inference.yml')} if directory and Path(directory).is_dir() else {})
    for package in ('paddleocr','paddlepaddle','numpy','opencv-python','Pillow'):
        try: settings[package] = version(package)
        except PackageNotFoundError: settings[package] = 'not_installed'
    ocr._paper_settings_snapshot = settings
    return settings


def attach_provenance(result, source, backend, settings):
    root = Path(__file__).parent
    rules = {name:digest_file(root/name) for name in ('paper_intake.py','paper_intake_layout.py','intake_layout.py','paper_checkboxes.py','cloud_intake.py','local_ocr.py','ai_service.py')}
    result['diagnostics']['provenance'] = {
        'source_sha256':digest_file(source), 'backend':backend, 'settings':settings,
        'rules_sha256':canonical_digest(rules), 'settings_sha256':canonical_digest(settings),
        'candidate_sha256':canonical_digest({'sections':result['sections'],'checkbox_states':result['checkbox_states']}),
    }
    return result
