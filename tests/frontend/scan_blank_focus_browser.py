"""Synthetic viewer focus regression; no documents, cloud or database writes."""
import base64
import io
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/scan-blank-focus'
OUT.mkdir(parents=True, exist_ok=True)
picture = Image.new('RGB', (800,600), 'white')
draw = ImageDraw.Draw(picture)
draw.text((200,210), 'Edad:', fill='black')
draw.line((300,235,450,235), fill='black')
buffer = io.BytesIO(); picture.save(buffer, 'PNG')
url = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width':1280,'height':850})
    page.goto('http://127.0.0.1:5173/login')
    page.evaluate('''async url => {
      const entry=await(await fetch('/src/main.tsx')).text();
      const React=await import(entry.match(/from "([^"\\n]*\\/react\\.js[^"\\n]*)"/)[1]);
      const DOM=await import(entry.match(/from "([^"\\n]*\\/react-dom_client\\.js[^"\\n]*)"/)[1]);
      const {ScanViewer}=await import('/src/features/documentExtraction/ScanViewer.tsx');
      document.querySelector('#root').style.display='none';
      const div=document.createElement('div');div.style.height='95vh';document.body.append(div);
      (DOM.createRoot||DOM.default.createRoot)(div).render((React.default||React).createElement(ScanViewer,{
        url,label:'Part II-A — Edad',evidence:{page:1,bbox:[300,200,450,240],location_kind:'label_answer_area'}}));
    }''', url)
    for name,width,height in [('desktop',1280,850),('mobile',390,844)]:
        page.set_viewport_size({'width':width,'height':height})
        highlight=page.locator('[data-source-highlight]')
        highlight.wait_for()
        page.wait_for_function('''() => {
          const h=document.querySelector('[data-source-highlight]').getBoundingClientRect();
          const v=document.querySelector('[aria-label^="Scan viewport"]').getBoundingClientRect();
          return Math.abs((h.left+h.right-v.left-v.right)/2)<5 && Math.abs((h.top+h.bottom-v.top-v.bottom)/2)<5;
        }''')
        assert highlight.evaluate("e=>getComputedStyle(e).backgroundColor") == 'rgba(0, 0, 0, 0)'
        assert page.get_by_text('approximate answer area',exact=False).count() == 1
        page.screenshot(path=str(OUT/f'{name}.png'))
    page.get_by_role('button',name='Hide highlight',exact=True).click()
    assert page.locator('[data-source-highlight]').count() == 0
    page.get_by_role('button',name='Show highlight',exact=True).click()
    page.locator('[data-source-highlight]').wait_for()
    browser.close()
print('PASS: blank answer area centered desktop/mobile; transparent highlight and visibility controls.')
