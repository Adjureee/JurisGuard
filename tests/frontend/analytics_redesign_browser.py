"""Analytics visual/regression checks with synthetic API responses only."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[2] / '.local/analytics-review'
OUT.mkdir(parents=True, exist_ok=True)
mode = sys.argv[1] if len(sys.argv) > 1 else 'after'
requests = []
state = {'empty': False, 'fail': False}


def api(route):
    if not urlparse(route.request.url).path.startswith('/api/'):
        route.continue_()
        return
    cors = {'access-control-allow-origin':'http://localhost:5173','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'}
    if route.request.method == 'OPTIONS':
        route.fulfill(status=204, headers=cors)
        return
    path = urlparse(route.request.url).path
    query = parse_qs(urlparse(route.request.url).query)
    requests.append((path, query))
    if path.endswith('/auth/me'):
        data = dict(user_id=9001, email='synthetic@example.test', role='admin', approval_status='approved', full_name='Synthetic Attorney', profile_completed=True, mfa_enabled=False)
    elif '/dashboard/' in path:
        if state['fail']:
            route.fulfill(status=503, json={'detail': 'Synthetic service unavailable'}, headers=cors)
            return
        year = query.get('date_from', [''])[0].endswith('01-01')
        n = 0 if state['empty'] else (20 if year else 8)
        groups = [] if not n else [dict(barangay='Central Mati City', city='Mati',total_cases=n, active_cases=n,terminated_cases=0,most_common_category='Client addresses',latitude=None,longitude=None)]
        responses = {
          'overview': dict(total_clients=20,total_cases=30,active_cases=25,terminated_cases=5,cases_in_range=n,clients_in_range=n,range_active_cases=max(n-2,0),range_terminated_cases=min(n,2),ocr_scanned_documents=4),
          'monthly-trends': [] if not n else [{'month':'2026-10','total_cases':n}],
          'case-categories': [] if not n else [{'category':'Criminal','total_cases':n-2},{'category':'Civil','total_cases':2}],
          'barangay-stats': groups,
          'heatmap': {'center':{'lat':12,'lng':123},'points':[],'barangays':groups},
          'terminated-cases': {'total':min(n,2),'closure_rate':25,'by_reason':[] if not n else [{'reason':'Dismissed','total_cases':2}],'monthly':[] if not n else [{'month':'2026-10','total_cases':2}]},
          'intake-load': {'weekly':[{'day':day,'total_cases':n if day=='Monday' else 0} for day in ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']],'hourly':[],'average_daily_intake':1.14,'total_weekly_cases':n,'busiest_day':{'day':'Monday','total_cases':n},'busiest_hour':None},
          'ocr-analytics': {'total_scans':4,'successful_extractions':3,'failed_scans':1,'trends':[{'month':'2026-10','total_scans':4}],'document_types':[],'recent':[]},
          'recent-activities': [],
        }
        data = responses.get(path.rsplit('/',1)[-1], [])
    else:
        data = []
    route.fulfill(json=data, headers=cors)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1440,'height':1000})
    page.add_init_script("sessionStorage.setItem('jurisguard_token','synthetic-test-token')")
    page.route('**/api/**',api)
    page.goto('http://localhost:5173/analytics')
    try:
        page.get_by_role('heading',name='Analytics',exact=True).wait_for() if mode!='before' else page.get_by_text('Deep Analytics & Export').wait_for()
    except Exception:
        print('URL:', page.url, 'Body:', page.locator('body').inner_text()[:2000], 'Requests:',requests[:5],flush=True)
        raise
    page.wait_for_timeout(4500)
    page.screenshot(path=str(OUT / f'{mode}-desktop.png'),full_page=True)
    if mode!='before':
        with page.expect_download() as chart:
            page.get_by_role('button',name='Download PNG',exact=True).first.click()
        assert chart.value.suggested_filename.endswith('.png')
        assert page.get_by_text('Legal Service Demand',exact=True).count()==0
        assert page.get_by_text('Case Category Analytics',exact=True).count()==0
        page.get_by_role('button',name='This Year',exact=True).click()
        page.get_by_text('20',exact=True).first.wait_for()
        page.wait_for_timeout(1000)
        summary=page.get_by_label('Period summary')
        assert summary.get_by_text('20',exact=True).count()==2
        page.get_by_role('heading',name='Where registered clients live').scroll_into_view_if_needed()
        page.wait_for_timeout(1000)
        page.screenshot(path=str(OUT / f'{mode}-geography.png'),full_page=True)
        page.get_by_role('heading',name='Analytics',exact=True).scroll_into_view_if_needed()
        for endpoint in ('overview','monthly-trends','case-categories','barangay-stats','heatmap','terminated-cases','intake-load','ocr-analytics'):
            assert any(path.endswith('/'+endpoint) and q.get('date_from',[''])[0].endswith('01-01') for path,q in requests), endpoint
        page.get_by_role('button',name='Export report',exact=True).click()
        page.get_by_role('dialog').wait_for()
        assert page.get_by_role('dialog').get_by_text('Date From',exact=True).count()==0
        assert page.get_by_role('dialog').get_by_text('Month',exact=True).count()==0
        with page.expect_download() as report:
            page.get_by_role('button',name='Export Report',exact=True).click()
        assert report.value.suggested_filename.startswith('jurisguard_analytics_report')
        exported = Path(report.value.path()).read_text(encoding='utf-8-sig')
        assert 'monthly_intake_trends' in exported and 'terminated_case_movement' in exported and 'ocr_volume_trends' in exported
        assert 'October 2026' in exported and '20' in exported
        page.get_by_text('Report exported',exact=True).wait_for(state='hidden')
        page.get_by_role('button',name='Export report',exact=True).click()
        page.get_by_role('dialog').get_by_text('Case Category',exact=True).locator('..').locator('select').select_option('Criminal')
        with page.expect_download() as filtered:
            page.get_by_role('button',name='Export Report',exact=True).click()
        refined=Path(filtered.value.path()).read_text(encoding='utf-8-sig')
        assert 'Criminal' in refined and '18' in refined and 'monthly_intake_trends' not in refined
        page.get_by_text('Report exported',exact=True).wait_for(state='hidden')
        page.set_viewport_size({'width':390,'height':844})
        page.wait_for_timeout(1000)
        page.screenshot(path=str(OUT / f'{mode}-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_label('Start date',exact=True).focus()
        page.keyboard.press('Tab')
        # Native date inputs can have multiple internal segments; both remain keyboard reachable.
        page.get_by_label('End date',exact=True).focus()
        assert page.get_by_label('End date',exact=True).evaluate('(el)=>el===document.activeElement')
        page.get_by_label('Start date',exact=True).fill('2027-01-01')
        assert page.get_by_role('alert').filter(has_text='Start date').count()==1
        state['fail']=True
        page.reload()
        page.get_by_role('alert').filter(has_text='could not').wait_for(timeout=20000)
        state['fail']=False
        state['empty']=True
        page.get_by_role('button',name='Retry',exact=True).click()
        page.get_by_text('No cases received in this period.',exact=True).wait_for(timeout=20000)
        print('PASS: shared range requests and totals, duplicate removal, PNG/report downloads, mobile overflow, invalid dates, error/retry/empty')
    browser.close()
