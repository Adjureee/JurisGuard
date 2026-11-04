"""Explicit real-model benchmark. Private outputs stay under .local/.

Local: python tests/paper_repeatability.py --scan <scan> --runs 3
Cloud: add --mode cloud --synthetic --allow-cloud; never uploads private scans.
"""
import argparse
import base64
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT)]


def comparable(result):
    from paper_provenance import canonical_digest
    diagnostics = result['diagnostics']
    return {
        'recognized_text': diagnostics.get('recognized_text_sha256'),
        'fields': canonical_digest(result['sections']),
        'checkboxes': canonical_digest(result['checkbox_states']),
        'warnings': canonical_digest(diagnostics['warnings']),
        'evidence': canonical_digest(diagnostics.get('field_evidence', {})),
        'cloud_raw_response': canonical_digest(diagnostics['cloud_response_text']) if 'cloud_response_text' in diagnostics else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan', type=Path)
    parser.add_argument('--synthetic', action='store_true')
    parser.add_argument('--mode', choices=['local','cloud'], default='local')
    parser.add_argument('--allow-cloud', action='store_true')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--interval', type=float, default=65)
    parser.add_argument('--output', type=Path, default=ROOT/'.local/paper-repeatability')
    args = parser.parse_args()
    if args.runs < 2: parser.error('Repeatability needs at least two runs.')
    if args.mode == 'cloud' and (not args.allow_cloud or not args.synthetic or args.scan):
        parser.error('Cloud benchmarks require --synthetic --allow-cloud and cannot upload --scan files.')
    output = args.output.resolve()
    if not output.is_relative_to((ROOT/'.local').resolve()): parser.error('Private benchmark outputs must stay under .local/.')
    output.mkdir(parents=True,exist_ok=True)
    from dotenv import load_dotenv
    load_dotenv(ROOT/'.env')
    from ai_service import JurisGuardExtractionEngine
    from paper_provenance import digest_file, attach_provenance
    if args.synthetic:
        from tests.checkbox_fixtures import checkbox_sheet
        source = output/'synthetic.png'; checkbox_sheet()[0].save(source)
    elif args.scan:
        source = args.scan.resolve()
    else: parser.error('Supply --scan or --synthetic.')
    original_digest = digest_file(source)
    engine = JurisGuardExtractionEngine()
    encoded = base64.b64encode(source.read_bytes()).decode() if args.mode == 'cloud' else None
    runs = []
    for index in range(args.runs):
        if index and args.mode == 'cloud': time.sleep(args.interval)
        if digest_file(source) != original_digest: raise RuntimeError('Source changed during benchmark.')
        started = time.perf_counter()
        try:
            if args.mode == 'local':
                result = engine.execute_extraction(str(source),'offline','paper_intake')
            else:
                # Isolate provider predictions; never count a local fallback as cloud.
                result = engine._run_online_pipeline(encoded,paper_intake=True)
                attach_provenance(result,source,'cloud',{'model':engine.mistral_model,'temperature':0,'random_seed':engine.mistral_random_seed,'max_tokens':4096})
            expected_mode = 'OFFLINE_PAPER_INTAKE' if args.mode == 'local' else 'ONLINE_MISTRAL'
            status = 'success' if result['extraction_mode'] == expected_mode else 'engine_failure'
            (output/f'run-{index+1}.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
            runs.append({'run':index+1,'status':status,'seconds':round(time.perf_counter()-started,3),
                         'hashes':comparable(result),'provenance':result['diagnostics'].get('provenance'),
                         'checkbox_states':result['checkbox_states']})
        except Exception as error:
            runs.append({'run':index+1,'status':'unavailable','error_type':type(error).__name__,
                         'http_status':getattr(getattr(error,'response',None),'status_code',None)})
        print(json.dumps({k:v for k,v in runs[-1].items() if k not in ('provenance',)}),flush=True)
    successful = [run for run in runs if run['status']=='success']
    components = {key:len({run['hashes'][key] for run in successful}) for key in successful[0]['hashes']} if successful else {}
    signatures = {json.dumps(run.get('provenance',{}).get('settings'),sort_keys=True) for run in successful}
    versions = {run.get('provenance',{}).get('rules_sha256') for run in successful}
    summary = {'distinct_settings':len(signatures),'distinct_rule_versions':len(versions),'mode':args.mode,'source_sha256':original_digest,'runs':runs,'successful_runs':len(successful),
               'all_runs_succeeded':len(successful)==args.runs,'distinct_component_outputs':components,
               'repeatable_observed':all(n==1 for n in components.values()) and len(signatures)==1 and len(versions)==1 if len(successful)>=2 else None}
    (output/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k not in ('source_sha256','runs')}),flush=True)


if __name__ == '__main__': main()
