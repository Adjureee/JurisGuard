"""Exercise the real offline map with locally generated fictional client data."""
import json
import re
from pathlib import Path
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from region_xi_demo import BATCH
from verify_demo_records import application_functions
from database import SessionLocal
import models
from sqlalchemy import text
OUT=ROOT/'.local/synthetic-records'/BATCH
rows=json.loads((OUT/'application-payloads.json').read_text())
groups=[{'barangay':r['client']['client_details']['address'],'city':'','total_cases':1,
    'active_cases':1,'terminated_cases':0,'most_common_category':'Client addresses'} for r in rows]
with SessionLocal() as db:
    db.execute(text('SET TRANSACTION READ ONLY'))
    owner=db.get(models.User,rows[0]['record']['created_by_user_id'])
    actual_groups=application_functions()['dashboard_barangay_stats'](owner,db,None,None)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',args=['--enable-unsafe-swiftshader'])
    context=browser.new_context(viewport={'width':1440,'height':1000})
    remote=[]
    def restrict(route):
        if urlparse(route.request.url).hostname not in ('127.0.0.1','localhost'):
            remote.append(route.request.url);route.abort()
        else: route.continue_()
    context.route('**/*',restrict)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:5173/login',wait_until='domcontentloaded')
    result=page.evaluate('''async ({groups, actualGroups}) => {
      const entry=await (await fetch('/src/main.tsx')).text();
      const reactURL=entry.match(/from "([^"\\n]*\\/react\\.js[^"\\n]*)"/)[1];
      const domURL=entry.match(/from "([^"\\n]*\\/react-dom_client\\.js[^"\\n]*)"/)[1];
      const React=await import(reactURL);
      const ReactDOM=await import(domURL);
      const {default:Map}=await import('/src/components/dashboard/ClientAddressMap.tsx');
      const matching=await import('/src/components/dashboard/clientMapData.ts');
      const boundaries=await (await fetch('/maps/philippines-cities.geojson')).json();
      const data=matching.cityClientFeatures(groups,boundaries);
      const totals=data.features.filter(f=>f.properties.clientCount>0)
        .map(f=>({city:f.properties.shapeName,count:f.properties.clientCount}));
      document.querySelector('#root').style.display='none';
      const container=document.createElement('main');document.body.append(container);
      const root=(ReactDOM.createRoot||ReactDOM.default.createRoot)(container);
      const api=React.default||React;
      const h=api.createElement;
      function Harness(){
        const [selected,setSelected]=api.useState('');
        return h('div',{style:{maxWidth:'1200px',margin:'20px auto',padding:'16px'}},
          h('button',{onClick:()=>setSelected(groups.find(g=>g.barangay.includes('Santa Maria')).barangay)},'Select Santa Maria'),
          h('p',null,selected ? 'Selected: '+selected : 'All cities'),
          h(Map,{barangays:groups,selectedBarangay:selected,onSelectBarangay:setSelected}));
      }
      root.render(h(Harness));
      const actual=matching.cityClientFeatures(actualGroups,boundaries);
      return {totals,matched:totals.reduce((n,c)=>n+c.count,0),
        actual_analytics_total:actualGroups.reduce((sum,g)=>sum+g.total_cases,0),
        actual_analytics_matched:actual.features.reduce((sum,f)=>sum+f.properties.clientCount,0)};
    }''',{'groups':groups,'actualGroups':actual_groups})
    assert result['matched']==100 and len(result['totals'])==8
    page.wait_for_timeout(1200)
    assert not errors,errors
    page.screenshot(path=str(OUT/'map-render-debug.png'),full_page=True)
    print('Map status:',page.locator('section[aria-label="Offline client address map"]').inner_text()[:350])
    page.get_by_text(re.compile('100 of 100 clients matched to a city')).wait_for()
    page.get_by_text('Loading offline map…',exact=True).wait_for(state='detached',timeout=30000)
    page.wait_for_timeout(1800)
    page.screenshot(path=str(OUT/'map-fixed-desktop.png'),full_page=True)
    page.get_by_role('button',name='Select Santa Maria',exact=True).click()
    page.get_by_text('Selected:',exact=False).wait_for()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT/'map-fixed-selection.png'),full_page=True)
    page.get_by_role('button',name='Reset view',exact=True).click()
    page.get_by_text('All cities',exact=True).wait_for()
    page.set_viewport_size({'width':390,'height':900})
    page.wait_for_timeout(350)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'map-fixed-mobile.png'),full_page=True)
    assert not errors,errors
    assert not remote,remote
    browser.close()
report={**result,'browser_errors':errors,'remote_requests':len(remote),
    'selection_reset_verified':True,'mobile_no_page_overflow':True}
(OUT/'map-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
