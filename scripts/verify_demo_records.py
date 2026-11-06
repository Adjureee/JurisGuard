"""Read-only reconciliation using actual application serializers/analytics functions.

Load function definitions via AST, like the existing backend tests. Do not import
main.py: that would run startup migrations and seeders against the real database.
"""
import ast
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import json
from pathlib import Path
import re
import sys
from typing import Any, Literal

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'scripts')]
import models
from database import SessionLocal
from classification_evidence import stored_reviewed_flags
from sqlalchemy import func, or_, text
from fastapi import HTTPException
from region_xi_demo import BATCH


def application_functions():
    tree = ast.parse((ROOT / 'backend/main.py').read_text(encoding='utf-8'))
    functions = {n.name:n for n in tree.body if isinstance(n,ast.FunctionDef)}
    needed = {'get_client_payload','get_case_payload','dashboard_overview','dashboard_monthly_trends',
        'dashboard_case_categories','dashboard_barangay_stats','dashboard_heatmap'}
    while True:
        more={node.id for name in needed for node in ast.walk(functions[name]) if isinstance(node,ast.Name) and node.id in functions}
        if more <= needed: break
        needed |= more
    namespace = dict(models=models, datetime=datetime, date=date, time=time, timedelta=timedelta,
        timezone=timezone, func=func, or_=or_, text=text, re=re, json=json, Any=Any, Literal=Literal,
        stored_reviewed_flags=stored_reviewed_flags, HTTPException=HTTPException)
    for node in tree.body:
        if isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name):
            try: namespace[node.target.id]=ast.literal_eval(node.value)
            except (ValueError,TypeError): pass
        if isinstance(node,ast.Assign):
            try: value=ast.literal_eval(node.value)
            except (ValueError,TypeError): continue
            for target in node.targets:
                if isinstance(target,ast.Name): namespace[target.id]=value
    nodes=[]
    for name in sorted(needed):
        node=functions[name]
        node.decorator_list=[]
        node.args.defaults=[ast.Constant(None) if isinstance(d,ast.Call) and isinstance(d.func,ast.Name) and d.func.id in ('Depends','Query') else d for d in node.args.defaults]
        nodes.append(node)
    module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*nodes],type_ignores=[])
    exec(compile(ast.fix_missing_locations(module),'<read-only JurisGuard functions>','exec'),namespace)
    return namespace


def main():
    output=ROOT / '.local/synthetic-records' / BATCH
    manifest=json.loads((output/'manifest.json').read_text())
    app=application_functions()
    with SessionLocal() as db:
        db.execute(text('SET TRANSACTION READ ONLY'))
        first=db.get(models.Case,manifest['records'][0]['case_id'])
        owner=db.get(models.User,first.intake.interviewer_id)
        overview=app['dashboard_overview'](owner,db,None,None)
        trends=app['dashboard_monthly_trends'](owner,db,None,None)
        categories=app['dashboard_case_categories'](owner,db,None,None)
        locations=app['dashboard_barangay_stats'](owner,db,None,None)
        heatmap=app['dashboard_heatmap'](owner,db,None,None)
        assert sum(row['total_cases'] for row in trends)==overview['total_cases']
        assert sum(row['total_cases'] for row in categories)==overview['total_cases']
        assert sum(row['total_cases'] for row in locations)==overview['total_clients']
        assert overview['active_cases']+overview['terminated_cases']==overview['total_cases']
        payloads=[]
        for item in manifest['records']:
            case=db.get(models.Case,item['case_id'])
            client=app['get_client_payload'](case.client)
            payload=app['get_case_payload'](case)
            assert payload['participants'][0]['address']==client['client_details']['address']
            assert payload['participants'][0]['contact_no']==client['client_details']['contact_no']
            assert payload['representative']['rep_name']==client['client_details']['representative_name']
            assert payload['cases']['detained']==client['client_details']['detained']
            assert payload['cases']['is_terminated']==(payload['cases']['status_of_case']=='Terminated')
            payloads.append({'record':payload,'client':client,'clientName':client['client']['name']})
        assert Counter(p['record']['case_type'] for p in payloads)=={'Criminal':70,'Civil':30}
        assert Counter(p['record']['cases']['location_type'] for p in payloads)=={'Urban':50,'Rural':50}
    # Only fictional target rows are exported for the local spreadsheet/UI check.
    (output/'application-payloads.json').write_text(json.dumps(payloads,indent=2),encoding='utf-8')
    report={'overview':overview,'monthly_total':sum(r['total_cases'] for r in trends),
        'category_total':sum(r['total_cases'] for r in categories),
        'address_analytics_total':sum(r['total_cases'] for r in locations),
        'address_groups':len(locations),'heatmap_points':len(heatmap['points']),
        'verified_fictional_payloads':len(payloads)}
    (output/'application-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
