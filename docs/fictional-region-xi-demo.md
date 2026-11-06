# Region XI fictional demonstration refresh

Dataset: `FICTIONAL-XI-20261106-V2`, refreshed November 6, 2026.

## Scope and preservation

The original local manifest identified 100 client/case/intake triples with matching synthetic names and control numbers. Only those confirmed rows were refreshed, in place, preserving their IDs. The other client/case was not changed or presumed synthetic. Targets were checked for linked uploads, reviewed scan records, case submissions/transfers and unrelated cases before proceeding.

A full PostgreSQL custom-format backup and an exact JSON snapshot of the old target rows are in local Git-ignored storage. Protected database rows were fingerprinted before/after the transaction, including user accounts/authentication and document metadata. Upload-file hashes were unchanged. No scans, OCR results, users or authentication settings were created or modified.

Results:

| Item | Count |
|---|---:|
| Client profiles replaced in place | 100 |
| Linked cases replaced in place | 100 |
| Intake/inventory entries refreshed | 100 |
| Additional clients/cases added | 0 / 0 |
| Previous fictional representatives replaced | 25 |
| New fictional representative entries | 42 |
| Previous test history entries replaced | 100 |
| New varied history entries | 518 |
| Criminal / civil | 70 / 30 |
| Pending / terminated | 80 / 20 |
| Urban / rural | 50 / 50 |
| Currently detained | 27 |

Names are invented combinations, not taken from existing client records. Contacts use designated non-dialable `000-...` values and `example.invalid` email domains. Puroks are fictional; barangay/locality/province names and urban/rural labels are verified reference data. No exact household coordinates are assigned. Dataset designations persist in case remarks, classification notes, history remarks and the local removal manifest; control/case numbers are fictional and unique.

Applicants remain in client/Part II fields. Representatives have separate details, intake representative rows and participant snapshots. The 58 unrepresented applicants have empty representative fields. No fake reviewed-paper record is inserted because there is no associated scan. The system has no dedicated independent interview-date field: the interview date is recorded in notes/history and client creation time, while intake form date remains the existing case-received field.

## Reference verification

PSA PSGC barangay tables checked November 6, 2026:

- [Panabo](https://psa.gov.ph/classification/psgc/barangays/1102315000): New Visayas (urban), Mabunao (rural).
- [Tagum](https://psa.gov.ph/classification/psgc/barangays/1102319000): Apokon (urban), Bincungan (rural).
- [Digos](https://psa.gov.ph/classification/psgc/barangays/1102403000): Aplaya (urban), Balabag (rural).
- [Matanao](https://psa.gov.ph/classification/psgc/barangays/1102410000): Camanchiles (urban), Asbang (rural).
- [Mati](https://psa.gov.ph/classification/psgc/barangays/1102509000): Dahican (urban), Dawan (rural).
- [New Bataan](https://psa.gov.ph/classification/psgc/barangays/1108210000): Cabinuangan (urban), Kahayag (rural).
- [Santa Maria](https://psa.gov.ph/classification/psgc/barangays/1108604000): Poblacion (urban), Ogpao (rural).
- [Davao City](https://psa.gov.ph/classification/psgc/barangays/1130700000): Tibungco (urban), Tawan-tawan (rural). Davao City is not assigned a province in these addresses.

Facility existence verified through [PIA (Panabo)](https://pia.gov.ph/news/bjmp-xi-records-lower-jail-congestion-rate), [DOH (Tagum)](https://ntp.doh.gov.ph/view-facility/?id=12498), [DOLE (Digos male dormitory)](https://ro11.dole.gov.ph/news/dole-xi-davao-del-sur-strengthens-livelihood-reintegration-for-pdls-through-multi-sectoral-coordination/), [BJMP letter hosted by DepEd (Digos female dormitory)](https://depeddigoscity.org/storage/wp-content/uploads/2025/10/DM_CID_2025_498.pdf), and [DOLE (Davao City Jail-Annex)](https://ro11.dole.gov.ph/news/persons-deprived-of-liberty-in-davao-city-launched-kaulian-bakeshop-and-cafe-through-dole-livelihood-program/). Fictional cases do not assert that any real individual is detained or involved in proceedings. Court references are fictional demonstration venues, not verified case listings.

## Reproducible checks

From the repository root:

```powershell
.\backend\venv\Scripts\python.exe -m unittest tests.test_region_xi_demo -v
.\backend\venv\Scripts\python.exe scripts/verify_demo_records.py
# With Vite running on 127.0.0.1:5173:
.\backend\venv\Scripts\python.exe scripts/verify_demo_export.py
```

The refresh script previews before applying and refuses already-refreshed batches. The old placeholder seeder refuses to recreate a superseded batch. Exact local records, backup references, source references, XLSX and verification results are under `.local/synthetic-records/FICTIONAL-XI-20261106-V2/` and `.local/backups/`.

Verified: four fixture regression tests; committed DB relationships and date consistency; 100 actual application serializer payloads; actual dashboard/category/monthly/address count functions executed read-only without importing startup code; browser-side CSV and downloaded XLSX data for all 100 fictional cases. Inventory addresses/ages/sex/contact values and urban/rural totals match profiles/cases. Totals including the preserved record are 101 clients, 101 cases, 81 active and 20 terminated.

## Limitations found

**Update:** The city-matching defect below was subsequently fixed. All 100 fictional addresses and all 101 current analytics clients now match offline. See [map matcher verification](map-matcher-fix.md). The following paragraph preserves the initial refresh baseline.

The current city matcher resolves only 12/100 complete fictional addresses against the installed boundaries. Its name-only matching treats the word Davao in province names as a competing Davao City match and cannot disambiguate municipalities named Santa Maria. The backend barangay-coordinate reference additionally covers only Panabo (two matching barangay points). Address analytics retain/count all 101 clients, but map coverage is incomplete. No addresses were shortened or coordinates guessed to conceal this existing application limitation.

Authenticated screen interaction, OCR accuracy, physical camera capture, and restore of the backup into a separate database were not tested. The downloaded workbook was checked for data agreement using the current exporter; no claim is made here that its current formatting is identical to the separate PAO template. No production UI, mapping or export-format code was changed during this data refresh.
