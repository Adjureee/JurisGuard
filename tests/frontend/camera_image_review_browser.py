"""Fake document camera + synthetic API. No private files, cloud calls or DB writes."""
import base64
from email.parser import BytesParser
from email.policy import default
from io import BytesIO
from pathlib import Path
import json
from urllib.parse import urlparse
import numpy as np
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.local/camera-image-review';OUT.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(1280,960),'#777777');draw=ImageDraw.Draw(image)
draw.rectangle((110,45,1170,915),fill='white',outline='black',width=4)
draw.text((150,80),'FICTIONAL PAO CAMERA FIXTURE - NOT A REAL INTERVIEW',fill='black')
draw.rectangle((140,160,1140,195),fill='black')
draw.text((160,170),'II. IMPORMASYON UKOL SA APLIKANTE',fill='white')
for n,label in enumerate(['Pangalan: Ana Rivera','Edad: 31   Sex: F','Tirahan: Purok 2, Digos City','Contact No.: 000-000-0001','Nakakulong: Oo [ ]    Hindi [X]']):
    draw.text((160,235+n*60),label,fill='black')
draw.rectangle((140,620,1140,655),fill='black')
draw.text((160,630),'II-A. IMPORMASYON UKOL SA REPRESENTATIVE',fill='white')
for y in (705,770,835):draw.line((160,y,1100,y),fill='black',width=2)
image.save(OUT/'synthetic-sheet.png')
yuv=np.asarray(image.convert('YCbCr'))
frame=OUT/'synthetic-sheet.y4m'
frame.write_bytes(b'YUV4MPEG2 W1280 H960 F5:1 Ip A1:1 C420jpeg\nFRAME\n'+yuv[:,:,0].tobytes()+yuv[::2,::2,1].tobytes()+yuv[::2,::2,2].tobytes())
schema={'applicant_personal_circumstances':[['name','Pangalan'],['address','Tirahan'],['contact_no','Contact No.'],['detained','Nakakulong']],
    'representative_personal_circumstances':[['name','Pangalan'],['address','Tirahan'],['contact_no','Contact No.']]}
sections={'applicant_personal_circumstances':{'name':'Ana Rivera','address':'Purok 2, Digos City','contact_no':'000-000-0001','detained':'Hindi'},
    'representative_personal_circumstances':{'name':'','address':'','contact_no':''}}
state={'uploads':[],'saved':None}

def api(route):
    path=urlparse(route.request.url).path
    if not path.startswith('/api/'):
        route.continue_();return
    headers={'access-control-allow-origin':'http://127.0.0.1:5173','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
    if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
    if path.endswith('/auth/me'):data=dict(user_id=999,role='admin',approval_status='approved',profile_completed=True,full_name='Fictional Attorney')
    elif path.endswith('/pao-intakes/schema'):
        if state.get('schema_fail'):
            route.fulfill(status=404,headers=headers,json={'detail':'Not Found'});return
        data=schema
    elif path.endswith('/pao-intakes/prepare-camera'):
        import sys
        from unittest.mock import patch
        sys.path.insert(0,str(ROOT/'backend'))
        from camera_preparation import prepare_capture
        message=BytesParser(policy=default).parsebytes(f"Content-Type: {route.request.headers['content-type']}\r\n\r\n".encode()+route.request.post_data_buffer)
        source=OUT/'camera-original.jpg'
        source.write_bytes(next(part.get_payload(decode=True) for part in message.iter_parts() if part.get_param('name',header='content-disposition')=='file'))
        with patch('camera_preparation.detect_orientation',return_value=(0,15)):
            data=prepare_capture(source)
    elif path.endswith('/upload-document/'):
        content_type=route.request.headers['content-type']
        message=BytesParser(policy=default).parsebytes(f'Content-Type: {content_type}\r\n\r\n'.encode()+route.request.post_data_buffer)
        files={part.get_param('name',header='content-disposition'):part.get_payload(decode=True) for part in message.iter_parts()}
        state['uploads'].append(files)
        data={'document_id':77,'extracted_data':{'sections':sections,'intake_scope':'parts_ii_iia','extraction_mode':'OFFLINE',
            'diagnostics':{'warnings':[]},'checkbox_states':{'applicant_personal_circumstances.detained.oo':'unchecked','applicant_personal_circumstances.detained.hindi':'checked'}}}
    elif '/pao-intakes/documents/77' in path:
        route.fulfill(status=200,headers=headers,content_type='image/jpeg',body=state['uploads'][-1]['file']);return
    elif path.rstrip('/').endswith('/pao-intakes'):
        state['saved']=route.request.post_data_json
        data={'client_id':'SYN-77','client':{'name':state['saved']['sections']['applicant_personal_circumstances']['name']},'client_details':{},'client_classification':{}}
    else:data=[]
    route.fulfill(status=200,headers=headers,json=data)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={frame}'])
    context=browser.new_context(viewport={'width':1440,'height':1000},permissions=['camera'])
    context.add_init_script("sessionStorage.setItem('jurisguard_token','synthetic-camera-test');window.__stops=0;const stop=MediaStreamTrack.prototype.stop;MediaStreamTrack.prototype.stop=function(){window.__stops++;return stop.call(this)}")
    context.route('**/api/**',api)
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def mount(capture=True, dedicated_upload=False):
        page.goto('http://127.0.0.1:5173/login',wait_until='domcontentloaded')
        page.evaluate('''async dedicated=>{
          const entry=await(await fetch('/src/main.tsx')).text();
          const React=await import(entry.match(/from "([^"\\n]*\\/react\\.js[^"\\n]*)"/)[1]);
          const DOM=await import(entry.match(/from "([^"\\n]*\\/react-dom_client\\.js[^"\\n]*)"/)[1]);
          const {ConfirmationProvider}=await import('/src/components/ConfirmationProvider.tsx');
          const {default:Add}=await import('/src/components/modals/AddClientModal.tsx');
          const {UploadIntakeModal}=await import('/src/components/modals/DedicatedPaperIntakeModals.tsx');
          document.querySelector('#root').style.display='none';
          const div=document.createElement('div');document.body.append(div);
          const api=React.default||React;const h=api.createElement;
          (DOM.createRoot||DOM.default.createRoot)(div).render(h(ConfirmationProvider,null,h(dedicated?UploadIntakeModal:Add,{isOpen:true,initialMode:'scan',onClose:()=>{window.__closed=true}})));
        }''',dedicated_upload)
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT/'mount-debug.png'),full_page=True)
        assert not errors,errors
        page.locator('#intake-ocr-engine').select_option('offline')
        assert page.get_by_text('Prepare for OCR',exact=True).count()==0
        if not capture:return
        page.get_by_role('button',name='Scan with Camera',exact=True).click()
        page.get_by_role('button',name='Start document camera',exact=True).click()
        page.get_by_role('button',name='Capture photo',exact=True).wait_for()
        page.get_by_role('button',name='Capture photo',exact=True).click()
        page.get_by_role('heading',name='Review crop',exact=True).wait_for()
        assert page.evaluate('window.__stops')>0
    mount()
    page.get_by_alt_text('Selected image sent to OCR').wait_for()
    assert page.get_by_role('slider').count()==0
    assert page.get_by_role('combobox',name='Rotation').count()==0
    for name in ['Brightness','Contrast','Correct perspective with four corners','Adjust image']:
        assert page.get_by_label(name,exact=True).count()==0
    page.get_by_role('button',name='Retake photo',exact=True).click()
    page.get_by_role('button',name='Cancel',exact=True).click()
    page.get_by_role('heading',name='Review crop',exact=True).wait_for()
    page.get_by_role('button',name='Retake photo',exact=True).click()
    page.locator('dialog[open]').get_by_role('button',name='Retake photo',exact=True).click()
    page.get_by_role('button',name='Capture photo',exact=True).click()
    page.get_by_alt_text('Selected image sent to OCR').wait_for()
    page.get_by_label('left crop (%)',exact=True).fill('4')
    page.get_by_role('button',name='Reset crop',exact=True).click()
    assert page.get_by_label('left crop (%)',exact=True).input_value()=='0'
    for side,value in [('left','2'),('top','2'),('right','98'),('bottom','98')]:
        page.get_by_label(side+' crop (%)',exact=True).fill(value)
    boundary=page.get_by_label('Crop boundaries',exact=True)
    boundary.scroll_into_view_if_needed()
    box=boundary.bounding_box()
    x,y=box['x']+box['width']*.5,box['y']+box['height']*.5
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+box['width']*.01,y+box['height']*.01);page.mouse.up()
    assert float(page.get_by_label('left crop (%)',exact=True).input_value())>2
    for side,value in [('left','2'),('top','2'),('right','98'),('bottom','98')]:
        page.get_by_label(side+' crop (%)',exact=True).fill(value)
    page.wait_for_timeout(600)
    preview=page.get_by_alt_text('Selected image sent to OCR')
    preview.wait_for()
    preview.scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'crop-review-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':900})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('heading',name='Review crop',exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'crop-review-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1000})
    def image_bytes(locator):
        return bytes(page.evaluate("async src=>Array.from(new Uint8Array(await(await fetch(src)).arrayBuffer()))",locator.get_attribute('src')))
    expected=image_bytes(preview)
    original=image_bytes(page.get_by_alt_text('Complete original camera capture'))
    page.get_by_role('button',name='Extract information',exact=True).click()
    page.get_by_role('button',name='Save reviewed record',exact=True).wait_for()
    assert state['uploads'][-1]['ocr_image']==expected
    assert state['uploads'][-1]['file']==original
    assert expected[:8]==b'\x89PNG\r\n\x1a\n'
    page.locator('#paper-applicant_personal_circumstances-name').fill('Ana Rivera Corrected')
    page.get_by_role('button',name='Save reviewed record',exact=True).click()
    page.get_by_text('Reviewed intake saved with its original scan.',exact=True).wait_for()
    assert state['saved']['sections']['applicant_personal_circumstances']['name']=='Ana Rivera Corrected'
    assert all(not v for v in state['saved']['sections']['representative_personal_circumstances'].values())
    mount(capture=False,dedicated_upload=True)
    assert page.get_by_role('button',name='Scan with Camera',exact=True).count()==0
    assert page.get_by_text('Review section crops',exact=True).count()==0
    assert page.get_by_role('list',name='Document intake stages').get_by_text('Review crop',exact=True).count()==0
    page.locator('input[type=file]').set_input_files({'name':'synthetic-sheet.png','mimeType':'image/png','buffer':(OUT/'synthetic-sheet.png').read_bytes()})
    page.get_by_role('button',name='Extract information',exact=True).wait_for()
    page.screenshot(path=str(OUT/'restored-upload-screen.png'),full_page=True)
    page.get_by_role('button',name='Extract information',exact=True).click()
    page.get_by_role('button',name='Save reviewed record',exact=True).wait_for()
    assert state['uploads'][-1]['file']==(OUT/'synthetic-sheet.png').read_bytes()
    assert 'ocr_image' not in state['uploads'][-1]
    assert not errors,errors
    browser.close()
print('PASS: crop-only camera review, local synthetic cleanup, reset, retake/cancel, desktop/mobile, exact preview bytes sent to OCR, original retained, mocked OCR review/correction/save.')
