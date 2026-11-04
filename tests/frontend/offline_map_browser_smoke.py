"""Synthetic map smoke test; no legal records or login credentials."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/offline-map-review'
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', args=['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    external, errors, missing = [], [], []
    def route(request_route):
        url = request_route.request.url
        if not url.startswith(('http://localhost:5173', 'blob:', 'data:')):
            external.append(url)
            request_route.abort()
        else:
            request_route.continue_()
    page.route('**/*', route)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: print('Console:', message.text[:450], flush=True) if message.type == 'error' else None)
    page.on('response', lambda response: missing.append(response.url) if response.status >= 400 and '/maps/' in response.url else None)
    page.goto('http://localhost:5173')
    page.evaluate('''async () => {
      const ReactModule = await import('/node_modules/.vite/deps/react.js');
      const React = ReactModule.default ?? ReactModule;
      const DomModule = await import('/node_modules/.vite/deps/react-dom_client.js');
      const {createRoot} = DomModule.default ?? DomModule;
      const {default: Map} = await import('/src/components/dashboard/ClientAddressMap.tsx');
      const componentSource = await (await fetch('/src/components/dashboard/ClientAddressMap.tsx')).text();
      const dependency = componentSource.split('"').find(value=>value.startsWith('/node_modules/') && value.includes('/maplibre-gl.js'));
      const lib = await import(dependency);
      const prototype = (lib.Map ?? lib.default.Map).prototype;
      const addSource = prototype.addSource;
      prototype.addSource = function(id, ...args) { if(id === 'counts') window.__syntheticMap = this; return addSource.call(this, id, ...args); };
      document.getElementById('root').remove();
      const host=document.createElement('div'); document.body.append(host);
      host.style.cssText='max-width:1100px;margin:24px auto;padding:16px';
      const groups=[{barangay:'Brgy Central Mati City',total_cases:3,active_cases:3,terminated_cases:0,most_common_category:'Client addresses'}];
      createRoot(host).render(React.createElement(Map,{barangays:groups,selectedBarangay:groups[0].barangay}));
    }''')
    try:
        page.get_by_text('3 of 3 clients matched to a city').wait_for(timeout=20000)
    except Exception:
        print('Browser errors:', errors, 'body:', page.locator('body').inner_text()[:1500], flush=True)
        raise
    try:
        page.wait_for_function("!document.body.innerText.includes('Loading offline map')", timeout=20000)
    except Exception:
        print('Map load errors:', errors, 'missing:', missing[:5], 'external:', external[:5], flush=True)
        page.screenshot(path=str(OUT / 'loading.png'))
        raise
    page.wait_for_timeout(5000)
    page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(1000)
    page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
    page.get_by_role('button', name='Reset view').click()
    page.wait_for_timeout(1000)
    page.evaluate('''() => {
      const map=window.__syntheticMap;
      if(map.getLayer('client-cities') || map.getLayer('client-outlines')) throw Error('Unselected city shading still exists');
      map.getSource('counts').setData({type:'FeatureCollection',features:[3,7,11].map((count,index)=>({type:'Feature',geometry:{type:'Point',coordinates:[126.1+index*.01,6.9+index*.01]},properties:{count,city:'Synthetic city '+index}}))});
      map.jumpTo({center:[126.11,6.91],zoom:4});
    }''')
    page.wait_for_function("window.__syntheticMap.querySourceFeatures('counts').some(f=>f.properties.cluster && f.properties.clientTotal===21 && f.properties.point_count===3)", timeout=20000)
    page.evaluate("window.__syntheticMap.jumpTo({center:[126.11,6.91],zoom:14})")
    page.wait_for_function("new Set(window.__syntheticMap.querySourceFeatures('counts').filter(f=>!f.properties.cluster).map(f=>f.properties.city)).size===3", timeout=20000)
    assert not missing, missing[:5]
    assert not errors, errors
    assert not external, external[:5]
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    print('PASS: neutral cities; cluster sums clients (21), not city count (3); zoom separates cities; offline desktop/mobile/reset')
    browser.close()
