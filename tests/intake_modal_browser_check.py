"""Synthetic API/UI scenarios, including a simulated browser camera. No real data."""
import base64,json,sys,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'backend')]
from paper_intake import SCHEMA,empty_sections
from tests.checkbox_fixtures import checkbox_sheet
out=ROOT/'.local/intake-redesign';out.mkdir(exist_ok=True)
before=ROOT/'.local/dashboard-review/admin-intake-shortcut.png'
if before.exists() and not (out/'before.png').exists():shutil.copyfile(before,out/'before.png')
image,_=checkbox_sheet();source=out/'synthetic.png';image.save(source)
preview='data:image/png;base64,'+base64.b64encode(source.read_bytes()).decode()
with sync_playwright() as play:
 browser=play.chromium.launch(channel='msedge',args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
 context=browser.new_context(viewport={'width':1440,'height':1000},permissions=['camera'])
 context.add_init_script("sessionStorage.setItem('jurisguard_token','synthetic-intake-test')")
 state={'save_attempts':0,'crop_upload':False};errors=[]
 def api(route):
  path=urlparse(route.request.url).path
  headers={'access-control-allow-origin':'http://localhost:5173','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
  if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
  if path.endswith('/auth/me'):data={'user_id':999,'full_name':'Synthetic User','email':'synthetic@example.invalid','role':'admin','approval_status':'approved','profile_completed':True,'mfa_enabled':False}
  elif path.endswith('/pao-intakes/schema'):data=SCHEMA
  elif path.endswith('/pao-intakes/capture-analyze'):data={'document':{'corners':[[0,0],[1,0],[1,1],[0,1]],'confidence':'uncertain'},'rotation':0,'page':{'preview':preview},'sections':{'part_ii':[.12,.46],'part_iia':[.56,.8],'confidence':'uncertain'},'warnings':['Synthetic uncertain headings: check both boundaries.']}
  elif path.endswith('/upload-document/'):
   state['crop_upload']=b'crop_plan' in (route.request.post_data_buffer or b'')
   sections=empty_sections();sections['applicant_personal_circumstances']['name']='SYNTHETIC applicant'
   data={'document_id':1,'source_draft_id':'synthetic','extracted_data':{'sections':sections,'checkbox_states':{'applicant_personal_circumstances.detained.oo':'unknown','applicant_personal_circumstances.detained.hindi':'unknown'},'diagnostics':{'warnings':[],'field_states':{}},'extraction_mode':'offline'}}
  elif path.rstrip('/').endswith('/pao-intakes') and route.request.method=='POST':
   state['save_attempts']+=1
   if state['save_attempts']==1:route.fulfill(status=503,headers=headers,json={'detail':'Synthetic save failure'});return
   payload=route.request.post_data_json
   data={'client_id':'synthetic-client','client':{'name':payload['sections']['applicant_personal_circumstances']['name']},'paper_intake':payload}
  else:data=[]
  route.fulfill(status=200,headers=headers,json=data)
 context.route('http://127.0.0.1:8000/api/**',api)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def open_scan():
  page.goto('http://localhost:5173/cases?action=intake');page.get_by_role('heading',name='Add client',exact=True).wait_for();page.wait_for_function("!document.querySelector('input[type=file]').disabled")
 open_scan();page.screenshot(path=str(out/'select-after.png'))
 modal=page.get_by_role('dialog',name='Add client')
 assert modal.locator(':scope > div').evaluate('(el)=>el.getBoundingClientRect().width')<900
 page.locator('input[type=file]').set_input_files({'name':'invalid.txt','mimeType':'text/plain','buffer':b'synthetic invalid file'})
 page.get_by_role('alert').filter(has_text='Choose a JPG').wait_for()
 page.locator('input[type=file]').set_input_files(str(source));page.get_by_text('synthetic.png',exact=True).wait_for()
 page.get_by_role('button',name='Extract Parts II and II-A',exact=True).focus();page.keyboard.press('Tab')
 assert page.evaluate('document.activeElement.textContent').strip()=='Close'
 assert state['save_attempts']==0
 page.get_by_role('button',name='Close',exact=True).click();page.get_by_role('button',name='Cancel',exact=True).click()
 assert page.get_by_text('synthetic.png',exact=True).count()==1
 page.get_by_label('Review section crops',exact=False).check()
 page.get_by_role('button',name='Review section crops',exact=True).click()
 page.get_by_role('heading',name='Review both section boundaries').wait_for()
 assert page.get_by_role('button',name='Extract Parts II and II-A',exact=True).is_disabled()
 page.get_by_role('slider').first.focus();page.keyboard.press('ArrowRight')
 page.get_by_label('I checked the page',exact=False).check()
 page.screenshot(path=str(out/'crops-after.png'))
 page.get_by_role('button',name='Extract Parts II and II-A',exact=True).click()
 page.get_by_role('button',name='Save reviewed record',exact=True).wait_for()
 assert state['crop_upload']
 page.get_by_role('button',name='Part II-A · Representative',exact=True).click()
 page.get_by_role('button',name='Review representative fields',exact=True).click()
 for section,fields in SCHEMA.items():
  for key,label in fields:
   if key=='detained':continue
   control=page.locator(f'#paper-{section}-{key}');control.scroll_into_view_if_needed();control.focus()
   assert control.evaluate('(el)=>{const r=el.getBoundingClientRect();return r.width>30&&r.top>=0&&r.bottom<=innerHeight;}'),key
 page.get_by_role('button',name='Part II · Applicant',exact=True).click()
 name=page.locator('#paper-applicant_personal_circumstances-name');name.fill('SYNTHETIC corrected applicant')
 page.screenshot(path=str(out/'review-after.png'))
 page.get_by_role('button',name='Save reviewed record',exact=True).click()
 page.get_by_text('Your edits are kept.',exact=False).wait_for();assert name.input_value()=='SYNTHETIC corrected applicant'
 page.screenshot(path=str(out/'save-error.png'))
 page.get_by_role('button',name='Save reviewed record',exact=True).click()
 page.get_by_text('Reviewed intake saved with its original scan.',exact=True).wait_for()
 page.screenshot(path=str(out/'saved-after.png'))
 for width in (768,390):
  page.set_viewport_size({'width':width,'height':900});open_scan();page.screenshot(path=str(out/f'select-{width}.png'))
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.set_viewport_size({'width':1440,'height':1000});open_scan()
 page.get_by_role('button',name='Scan with Camera',exact=True).click()
 page.get_by_role('button',name='Start camera preview',exact=True).click()
 page.get_by_role('button',name='Capture photo',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name='Capture photo',exact=True).click()
 page.get_by_role('button',name='Use this photo',exact=True).click()
 page.get_by_role('button',name='Extract Parts II and II-A',exact=True).click()
 page.get_by_role('button',name='Save reviewed record',exact=True).wait_for()
 page.screenshot(path=str(out/'simulated-camera-review.png'))
 assert not errors,errors
 browser.close()
print('PASS: compact selection, crop confirmation, extraction, correction, failed-save retry, success, responsive views, simulated camera.')
