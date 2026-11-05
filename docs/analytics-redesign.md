# Analytics page consolidation

## Layout and scope

Preserves the existing PAO purple/slate styling, authenticated routes, permission
queries, service layer, shared panels, local map, report modal and chart PNG
downloads. No case or client records are rewritten.

The top toolbar is the only reporting-period control. Its scope is explicit:
case receipt dates (existing form-date/last-updated fallback), client registration
dates, termination dates and document upload dates. The address list controls
map focus only. Export-specific refinements remain in the existing export modal.
The Analytics export locks its date scope to the page's selected period and hides
the modal's day/month/year controls: monthly aggregates cannot be re-filtered
accurately using arbitrary daily dates. Other callers retain those controls.
Export contents are tested both unrefined and with a category refinement.

The hierarchy is period controls, a four-value summary, received-case trends and
categories, current receipt-cohort status and termination events, client address
geography, then collapsed weekday/hour planning detail. Categories no longer
appear as both Legal Service Demand and a separate pie chart. Repeated totals,
peak metric cards, address chips, explanatory export banner, and the forced
map/sidebar equal-height observer were removed. Distinct weekday/hour and
termination-reason information remains accessible in native disclosure controls.

The document figure counts uploads rather than successful OCR; its label says
Documents uploaded. Not terminated means receipt-cohort cases not marked
terminated. It does not infer a specific pending legal status. Terminations use
termination dates and can concern cases received outside the selected period.

## Data corrections

- Categories, client geography and OCR document aggregates now accept the same
  optional date parameters as trends. Existing callers without dates retain
  all-time behavior; permission scoping remains in place.
- Removed duplicate counting of cases without intake from Uncategorized.
- Added receipt-cohort status counts without changing all-time overview totals.
- Analytics geography exports no longer label client locations with an invented
  Pending/Terminated case status. Aggregate OCR rows do not claim all scans were
  processed successfully.
- Dashboard cache entries are separated by viewer ID, and all reporting aggregates
  reload for the selected period. Failure is surfaced with Retry; the Analytics page hides
  incomplete aggregates and disables export rather than presenting failed
  requests as zero. Invalid date ranges do not trigger new queries or exports.

## Verification

`tests/backend/test_analytics_ranges.py` executes the real query-building
functions against synthetic SQLite rows, covering inclusive end dates, caller
scoping, matching case cohorts and no duplicate Uncategorized count. It loads
functions without importing application startup or writing to the live database.

`tests/frontend/analytics_redesign_browser.py` mocks API data, mounts the normal
authenticated Analytics route in Edge, verifies shared date parameters and
updated summary totals, PNG and report downloads, error/retry/empty states,
invalid ranges and 390px overflow. Screenshots are under ignored
`.local/analytics-review/`: before-desktop, after-desktop, after-geography,
after-mobile. They use synthetic data, not real client records.

TypeScript, targeted frontend lint, frontend build and Python compilation are
also checked. Native spreadsheet formatting and the accuracy/completeness of
historically entered source dates remain outside this layout change.

A read-only live database reconciliation on 2026-11-04 confirmed that the current
30-day category sum equaled the received-case count (1), with 1 registered client
in the same period. No records or credentials were included in screenshots.
