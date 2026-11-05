# Dashboard usability review — November 5, 2026

The dashboard now prioritizes current workload, pending report actions, and
scan/manual intake shortcuts using the existing design palette and typography.
Administrator and staff pages share the presentation while using their existing
role-specific service endpoints. Backend permissions and calculations are unchanged.

## Consolidation

- Replaced six tall administrator metric cards with one four-column summary.
  Terminated cases remain visible beneath the total rather than as a separate card.
- Consolidated the repeated report count and recent-submission table into a
  Needs attention queue. Staff see returned reports; administrators see submissions
  awaiting review. Rows link to the existing report page filtered to that title;
  viewing the dashboard does not start a review or change a report status.
- Removed the oversized greeting, unsupported System Secure / Database Live
  badges, and repetitive intelligence text. Detailed trends, categories and
  geography remain in Analytics.
- Removed fixed-height nested scroll areas. Recent activity is limited to five
  entries; report queue to four with a link to the full list. Reminders retain
  add, complete/reopen and confirmed-delete controls in ordinary page flow.
- Added direct keyboard-accessible shortcuts for document intake, manual client
  creation, case creation, and finding records. Existing modal defaults remain
  unchanged when opened from their usual buttons.
- Standardized dashboard dates to en-PH abbreviated month/day/year. Labels follow
  actual calculations: cases dated today use form date; monthly cases use case
  date with last-update fallback. Total cases includes all case types. Staff
  case summaries say available rather than assigned because the existing API's
  collaboration scope includes all cases their role can access.

## Data and states

Administrator rendering fetches overview, activity and reports concurrently,
instead of fetching six analytics datasets. Staff fetch workload and scoped
reports. Failed sections display unavailable dashes/messages, not zero or a
misleading empty queue. Retry and refresh reload data. Workload/submission calls
have bounded timeouts. Skeletons indicate initial loading and refresh.

A read-only call to the existing overview calculation against local PostgreSQL
returned 1 client, 1 case, 1 active, 0 terminated, and 1 case this month. No
production records, account permissions, or database schema were changed.

## Verification

`npm run typecheck` and `npm run build` passed. The build retains its existing
large-bundle / stale Browserslist notices.

Run the synthetic browser checks with Vite already running on localhost:5173:

```powershell
.\backend\venv\Scripts\python.exe tests/dashboard_browser_check.py
```

The test intercepts only backend API requests and writes no database records.
It checks administrator, staff and legal_staff views, known summary values,
zero/empty/error/retry/loading states, report queue counts, desktop/tablet/phone
sizes, no page-width overflow, primary keyboard focus and Enter activation,
44px primary action height, scan upload entry, and local reminder creation and
completion. Browser runtime errors are asserted absent; intentional 503s test
the error state. Hidden mobile sidebar links are excluded from keyboard focus
through visibility, and the sidebar no longer covers the closed mobile layout.

Before/after desktop images and responsive/state captures are local:
`.local/dashboard-review/`. Screenshots use explicitly synthetic accounts/data
for comparison. The read-only database aggregate check is separate. Initial
before captures were taken before edits; running the test's `--before` switch
again now would capture the current code, not reconstruct the old dashboard.

## Remaining limitations

The existing API does not expose a trustworthy unsaved OCR-review queue/count;
the dashboard offers entry to scan and OCR review without claiming that count.
Reminders remain local to this browser/computer, as before. Phone layouts require
normal vertical scrolling. Physical camera capture, OCR accuracy, report approval,
and screen-reader usability were not re-evaluated in this dashboard change.
