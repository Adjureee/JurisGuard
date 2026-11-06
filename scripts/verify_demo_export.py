"""Verify fictional demo data through the existing browser-side XLSX exporter."""
import csv
from io import StringIO
import json
from pathlib import Path
import sys
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from region_xi_demo import BATCH
OUT=ROOT/'.local/synthetic-records'/BATCH
rows=json.loads((OUT/'application-payloads.json').read_text())
assert len(rows)==100 and all('FICTIONAL DEMONSTRATION DATA' in r['record']['cases']['remarks'] for r in rows)

with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge')
    page=browser.new_page(accept_downloads=True)
    page.goto('http://127.0.0.1:5173/login',wait_until='domcontentloaded')
    with page.expect_download() as download:
        result=page.evaluate('''async rows => {
          const service=await import('/src/services/exportService.ts');
          const map=await import('/src/components/dashboard/clientMapData.ts');
          const boundaries=await (await fetch('/maps/philippines-cities.geojson')).json();
          const matched=rows.filter(row=>map.matchAddressCity(row.client.client_details.address,boundaries));
          const filters={status:'All',location_type:'All',gender:'All'};
          const csv=service.buildCriminalCasesCsv(rows,filters);
          const html=service.buildCriminalCasesExcelHtml(rows,filters);
          await service.downloadInventoryWorkbook('fictional-region-xi.xlsx',html);
          return {csv, matched_city_addresses:matched.length, unmatched_city_addresses:100-matched.length};
        }''',rows)
    path=OUT/'fictional-region-xi.xlsx'
    download.value.save_as(path)
    browser.close()

csv_rows=list(csv.reader(StringIO(result.pop('csv'))))
header=next(row for row in csv_rows if 'CONTROL NUMBER' in row)
data=[row for row in csv_rows if row and row[0].startswith('DXI26-')]
assert len(data)==100
by_control={r[0]:dict(zip(header,r)) for r in data}
for r in rows:
    actual=by_control[r['record']['intake_record']['control_no']]
    assert actual['ADDRESS']==r['client']['client_details']['address']
    assert actual['CONTACT NUMBER']==r['client']['client_details']['contact_no']
    assert actual['GENDER / SEX']==r['client']['client']['sex']
    assert actual['AGE']==str(r['client']['client']['age'])
assert sum(int(r['URBAN']) for r in by_control.values())==50
assert sum(int(r['RURAL']) for r in by_control.values())==50

sheet=load_workbook(path).active
header_row=next(row[0].row for row in sheet if row[0].value=='CONTROL NUMBER')
excel_headers=[c.value for c in sheet[header_row]]
excel_data={row[0].value:dict(zip(excel_headers,[c.value for c in row])) for row in sheet
    if isinstance(row[0].value,str) and row[0].value.startswith('DXI26-')}
assert len(excel_data)==100
for r in rows:
    actual=excel_data[r['record']['intake_record']['control_no']]
    assert actual['CONTACT NUMBER'] in (r['client']['client_details']['contact_no'],None if not r['client']['client_details']['contact_no'] else r['client']['client_details']['contact_no'])
    assert actual['ADDRESS']==r['client']['client_details']['address']
report={'csv_rows':len(data),'xlsx_rows':len(excel_data),'urban':50,'rural':50,
    'contacts_preserved':True,'client_details_match_inventory':True,**result}
(OUT/'export-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
