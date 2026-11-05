"""Dashboard UI checks with explicitly synthetic API responses; no database writes."""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from paper_intake import SCHEMA

parser=argparse.ArgumentParser();parser.add_argument('--before',action='store_true');args=parser.parse_args()
out=Path(__file__).resolve().parents[1]/'.local/dashboard-review';out.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 for role in ('admin','staff','legal_staff'):
  context=browser.new_context(viewport={'width':1440,'height':1000})
  context.add_init_script("sessionStorage.setItem('jurisguard_token','synthetic-ui-test')")
  mode={'value':'data'};requests=[];errors=[];pending_routes=[]
  def api(route):
   path=urlparse(route.request.url).path;requests.append(path)
   headers={'access-control-allow-origin':'http://localhost:5173','access-control-allow-headers':'*','access-control-allow-methods':'GET,OPTIONS'}
   if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
   if path.endswith('/auth/me'):
    data={'user_id':999,'full_name':'Synthetic Test User','email':'test@example.invalid','role':role,'approval_status':'approved','profile_completed':True,'mfa_enabled':False,'profile_image_path':None,'profile_picture_path':None}
   elif '/dashboard/' in path and mode['value']=='loading':pending_routes.append(route);return
   elif '/dashboard/' in path and mode['value']=='error':route.fulfill(status=503,headers=headers,json={'detail':'Synthetic unavailable'});return
   elif path.endswith('/pao-intakes/schema'):data=SCHEMA
   elif path.endswith('/dashboard/overview'):
    data=dict(total_clients=0,total_cases=0,active_cases=0,terminated_cases=0,cases_this_month=0,ocr_scanned_documents=0) if mode['value']=='empty' else dict(total_clients=24,total_cases=18,active_cases=12,terminated_cases=6,cases_this_month=3,ocr_scanned_documents=7)
   elif path.endswith('/dashboard/staff-workload'):
    data={'assigned_cases':0 if mode['value']=='empty' else 8,'cases_created_today':0 if mode['value']=='empty' else 2,'pending_case_work':0 if mode['value']=='empty' else 3,'my_ocr_usage':0,'recent_cases':[],'recent_clients':[],'recent_actions':[] if mode['value']=='empty' else [{'id':'synthetic-activity','description':'Synthetic case record updated.','timestamp':'2026-11-05T09:00:00+08:00'}],'ocr_recent':[],'status_breakdown':[]}
   elif path.endswith('/dashboard/intake-load'):data={'weekly':[],'hourly':[],'busiest_day':None,'busiest_hour':None}
   elif path.endswith('/case-submissions') or path.endswith('/case-submissions/'):
    data=[] if mode['value']=='empty' else [{'submission_id':'synthetic-report','staff_id':999,'staff_name':'Synthetic Staff','staff_role':'staff','title':'Synthetic report for review','status':'Submitted' if role=='admin' else 'Correction Required','updated_at':'2026-11-05T09:00:00+08:00','created_at':'2026-11-05T09:00:00+08:00','date_from':'2026-11-01','date_to':'2026-11-05','items':[],'feedback':[],'case_count':2}]
   else:data=[]
   route.fulfill(status=200,headers=headers,json=data)
  context.route('http://127.0.0.1:8000/api/**',api)
  page=context.new_page();page.on('pageerror',lambda e:(errors.append(str(e)),print('Browser:',str(e),flush=True)))
  page.on('console',lambda msg: print(msg.text,flush=True) if msg.type=='error' else None)
  page.goto('http://localhost:5173/dashboard');page.wait_for_load_state('networkidle')
  page.locator('main').wait_for(timeout=30000)
  page.screenshot(path=str(out/(f'{role}-'+('before' if args.before else 'after')+'.png')),full_page=True)
  if not args.before:
   assert page.get_by_role('heading',name='Dashboard',exact=True).count()==1
   assert page.get_by_role('link',name='Scan interview sheet',exact=True).count()==1
   if role!='admin':assert '/api/dashboard/overview' not in requests
   primary=page.get_by_role('link',name='Scan interview sheet',exact=True)
   primary.focus();assert primary.evaluate('(el)=>getComputedStyle(el).outlineStyle')=='solid'
   assert primary.evaluate('(el)=>el.getBoundingClientRect().height')>=44
   assert page.get_by_text('1 staff reports awaiting review.' if role=='admin' else '1 reports returned for correction.',exact=True).count()==1
   assert page.locator('section[aria-label="Workload summary"] dd').all_text_contents()==(['12','24','18','3'] if role=='admin' else ['8','3','2','0'])
   if role=='admin':
    page.get_by_role('button',name='Add reminder',exact=True).click()
    page.get_by_label('Reminder title',exact=True).fill('Synthetic follow-up')
    page.get_by_role('button',name='Save reminder',exact=True).click()
    page.get_by_role('button',name='Mark complete',exact=True).click()
    assert page.get_by_role('button',name='Reopen reminder',exact=True).count()==1
   for width in (768,390):
    page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(250);page.screenshot(path=str(out/f'{role}-{width}-after.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal page overflow'
   page.keyboard.press('Tab');assert page.evaluate('document.activeElement.tagName')!='BODY'
   page.set_viewport_size({'width':1440,'height':1000})
   page.get_by_role('link',name='Scan interview sheet',exact=True).focus();page.keyboard.press('Enter');page.get_by_role('heading',name='Add client',exact=True).wait_for()
   page.locator('input[type=file]').wait_for(state='attached')
   page.screenshot(path=str(out/f'{role}-intake-shortcut.png'))
   page.goto('http://localhost:5173/dashboard');page.wait_for_load_state('networkidle')
   mode['value']='error';page.reload();page.wait_for_load_state('networkidle');assert page.get_by_role('button',name='Retry dashboard data').count()==1
   page.screenshot(path=str(out/f'{role}-error.png'),full_page=True)
   mode['value']='empty';page.get_by_role('button',name='Retry dashboard data').click();page.wait_for_load_state('networkidle')
   assert page.locator('section[aria-label="Workload summary"] dd').all_text_contents()==['0','0','0','0']
   page.screenshot(path=str(out/f'{role}-empty.png'),full_page=True)
   mode['value']='loading';page.reload(wait_until='domcontentloaded')
   page.get_by_role('button',name='Loading dashboard data…',exact=True).wait_for()
   assert page.locator('section[aria-label="Workload summary"]').get_attribute('aria-busy')=='true'
   page.screenshot(path=str(out/f'{role}-loading.png'),full_page=True)
   mode['value']='empty'
   for waiting in pending_routes[:]:api(waiting)
   page.wait_for_load_state('networkidle')
   assert not errors,errors
  context.close()
 browser.close()
print('Synthetic dashboard browser checks completed')
