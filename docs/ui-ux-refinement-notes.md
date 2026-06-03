# JurisGuard UI/UX Refinement Notes

Date: June 3, 2026

## Scope

This refinement pass focused only on non-dashboard usability improvements. It did not change backend workflows, database structure, permissions, OCR logic, analytics calculations, or routing.

## Implemented Updates

### Table Overflow Standard

- Updated the main application layout to prevent page-level horizontal overflow.
- Kept wide table scrolling inside each table container instead of allowing the full page to scroll sideways.
- Tightened shared page header action containment so toolbars cannot force content-width expansion.
- Applied table containment behavior to:
  - Criminal Cases
  - Terminated Cases
  - Case Submissions / Case Review Center
  - Verification Page
  - Audit Logs Page for both admin and staff views

### Filters

- Added a reusable date classification filter component.
- Date filter options:
  - All Dates
  - Today
  - Last 7 Days
  - Last 30 Days
  - This Month
  - This Year
- Applied date filtering to:
  - Criminal Cases
  - Terminated Cases
  - Case Submissions / Case Review Center
  - Verification Page
  - Audit Logs Page for both admin and staff views
- Added Criminal Cases status filtering:
  - All Cases
  - Pending
  - Active
  - Ongoing
- Removed the duplicate visible "All Locations" label from the Criminal Cases auxiliary location/type filter.

### Client Intake Refinement

- Updated the attached case workflow to present representative handling as two explicit options:
  - Use Representative Details Already Saved
  - Use Different Representative
- When the saved representative option is selected, representative fields remain hidden and stored client representative details are copied into the attached case.
- When a different representative is selected, representative fields are shown for manual entry.
- Updated the Add Client modal so "Detained Since" is hidden by default and only appears when "Detained" is checked.

### Export Standardization

- Confirmed Criminal Cases exports already use the shared PAO inventory export helpers.
- Confirmed Case Review Center report exports already use the same shared PAO inventory export helpers.
- Updated Terminated Cases CSV and Excel exports to reuse the same shared PAO inventory export helpers:
  - `buildCriminalCasesCsv`
  - `buildCriminalCasesExcelHtml`
  - `downloadCsv`
- This keeps column ordering, column naming, CSV structure, Excel HTML structure, and PAO spreadsheet styling consistent across case exports.

### Toast Layering

- Adjusted modal and toast stacking so toast notifications display above active modals.

## Validation

- Frontend TypeScript typecheck should be run with:
  `npm.cmd run typecheck`
- Frontend production build should be run with:
  `npm.cmd run build`
