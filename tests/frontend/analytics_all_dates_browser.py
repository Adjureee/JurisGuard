"""Synthetic regression: recent-period map versus All dates. No database writes."""
from datetime import datetime, timezone
from pathlib import Path
import re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.local/analytics-all-dates'
OUT.mkdir(parents=True,exist_ok=True)
requests=[]
recent=[dict(barangay='Purok 1, Brgy. Central, Mati City, Davao Oriental',city='',total_cases=1,
    active_cases=1,terminated_cases=0,most_common_category='Client addresses')]
all_groups=[*recent,dict(barangay='Purok 2, Brgy. Apokon, Tagum City, Davao del Norte',city='',total_cases=50,
    active_cases=50,terminated_cases=0,most_common_category='Client addresses'),
    dict(barangay='Purok 3, Brgy. Aplaya, Digos City, Davao del Sur',city='',total_cases=50,
    active_cases=50,terminated_cases=0,most_common_category='Client addresses')]

def api(route):
    parsed=urlparse(route.request.url)
    if not parsed.path.startswith('/api/'):
        route.continue_();return
    headers={'access-control-allow-origin':'http://127.0.0.1:5173',
        'access-control-allow-headers':'*','access-control-allow-methods':'GET,OPTIONS'}
    if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
    query=parse_qs(parsed.query)
    requests.append((parsed.path,query))
    groups=recent if query.get('date_from') else all_groups
    count=sum(g['total_cases'] for g in groups)
    responses={
        'me':dict(user_id=999,role='admin',full_name='Fictional Attorney',email='attorney@example.invalid',approval_status='approved',profile_completed=True),
        'overview':dict(total_clients=101,total_cases=101,active_cases=81,terminated_cases=20,
            clients_in_range=count,cases_in_range=count,range_active_cases=count,range_terminated_cases=0),
        'monthly-trends':[{'month':'2026-10','total_cases':count}],
        'case-categories':[{'category':'Criminal','total_cases':count}],
        'barangay-stats':groups,
        'heatmap':dict(center={'lat':7,'lng':125},points=[],barangays=groups),
        'terminated-cases':dict(total=0,closure_rate=0,by_reason=[],monthly=[]),
        'intake-load':dict(weekly=[],hourly=[],average_daily_intake=0,total_weekly_cases=count),
        'ocr-analytics':dict(total_scans=0,successful_extractions=0,failed_scans=0,document_types=[],trends=[],recent=[],status_breakdown=[]),
    }
    route.fulfill(status=200,headers=headers,json=responses.get(parsed.path.rsplit('/',1)[-1],[]))

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',args=['--enable-unsafe-swiftshader'])
    context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Manila')
    context.add_init_script("sessionStorage.setItem('jurisguard_token','synthetic-period-test')")
    context.route('**/api/**',api)
    page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.clock.install(time=datetime(2026,11,6,4,tzinfo=timezone.utc))
    page.goto('http://127.0.0.1:5173/analytics',wait_until='domcontentloaded')
    page.get_by_text(re.compile('1 of 1 clients matched to a city')).wait_for(timeout=30000)
    assert page.get_by_role('button',name='Last 30 Days',exact=True).get_attribute('aria-pressed')=='true'
    page.get_by_role('heading',name='Where registered clients live').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'last-30-days.png'),full_page=True)
    marker=len(requests)
    page.get_by_role('button',name='All dates',exact=True).click()
    page.get_by_text(re.compile('101 of 101 clients matched to a city')).wait_for(timeout=30000)
    assert page.get_by_role('button',name='All dates',exact=True).get_attribute('aria-pressed')=='true'
    for endpoint in ('overview','monthly-trends','case-categories','barangay-stats','heatmap','terminated-cases','intake-load','ocr-analytics'):
        assert any(path.endswith('/'+endpoint) and 'date_from' not in q and 'date_to' not in q for path,q in requests[marker:]),endpoint
    assert page.get_by_text(re.compile('Clients registered: All dates')).count()==1
    page.get_by_role('heading',name='Where registered clients live').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'all-dates.png'),full_page=True)
    page.get_by_role('button',name='Last 30 Days',exact=True).click()
    page.get_by_text(re.compile('1 of 1 clients matched to a city')).wait_for()
    assert not errors,errors
    browser.close()
print('PASS: Last 30 Days shows one client; All dates shows 101; all relevant requests and map period labels update consistently.')
