# Calendar Holiday Records

Holiday records are persisted in `calendar_holiday`. Startup seeds missing official records for 2026 and 2027 and does not overwrite existing rows, so administrator corrections remain in place and startup is safe to repeat.

Authenticated Admins can add a new record or update an existing record with the same stable source key:

```http
PUT /api/holidays/{source_key}
Authorization: Bearer <admin-token>
Content-Type: application/json
```

```json
{
  "source_key": "PH-2027-NEW-YEAR",
  "name": "New Year's Day",
  "date": "2027-01-01",
  "classification": "Regular Holiday",
  "coverage": "National",
  "geographic_scope": "Philippines",
  "reference": "Proclamation No. 1427, s. 2026",
  "source_url": "https://pco.gov.ph/news_releases/pbbm-declares-2027-regular-and-special-holidays/"
}
```

Changing the date under the same source key updates the existing record rather than adding a duplicate. Only add dates and classifications confirmed by an official government issuance. `GET /api/holidays?year=YYYY` returns the persisted records for the calendar; the calendar has no runtime dependency on a public holiday service.
