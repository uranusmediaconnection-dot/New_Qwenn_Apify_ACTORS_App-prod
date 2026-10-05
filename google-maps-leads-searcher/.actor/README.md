# Google Maps Leads Searcher

Searches Google Maps and extracts structured business leads — ideal for local lead
generation, market research, and building outbound prospect lists.

## How it works

1. Opens each search query on Google Maps (`searchStringsArray`).
2. Scrolls the results feed to load up to `maxResults` places per query
   (detects the "end of the list" marker automatically).
3. Visits each place's detail page and extracts data using Google's stable
   `data-item-id` attributes.

## Output fields

| Field | Description |
| :--- | :--- |
| `name` | Business name |
| `category` | Primary category (e.g. `Dentist`) |
| `address` | Street address |
| `phone` | Phone number (detail pages) |
| `website` | Business website (detail pages) |
| `rating` / `reviewsCount` | Rating and number of reviews |
| `openingHours` | Current opening-hours summary |
| `plusCode` | Plus code location |
| `latitude` / `longitude` | Coordinates parsed from the place URL |
| `placeUrl` | Canonical Google Maps place URL |
| `searchQuery` | The query that produced the lead |
| `status` | `ok`, `partial`, `no-results`, or `failed` |

## Input

```json
{
  "searchStringsArray": ["Dentists in New York, NY"],
  "maxResults": 50,
  "language": "en",
  "includePlaceDetails": true,
  "maxConcurrency": 3,
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

## Production features

- **Residential proxies by default** (datacenter IPs are blocked instantly by Maps), with
  automatic fallback if the proxy group is unavailable.
- **Session pool** — sessions are retired when Google serves a CAPTCHA (`/sorry/`) page,
  and the request is retried on a fresh IP (up to 4 retries).
- **Cookie-consent handling** for EU exit IPs.
- **Human-like pacing**: low concurrency + randomized delays between navigations.
- **Per-query budgets and deduplication** by place URL across queries.
- **Browser fingerprint masking** via Crawlee's fingerprint generator.
- Live run status messages and a `status` field on every dataset item for observability.

## Limits & good practice

- Google Maps caps a single query at ~120 results. For exhaustive coverage of a big
  city, split it into narrower area queries (grid partitioning) — see
  `docs/research-report.md` in the repository.
- Scraping Google Maps may conflict with Google's Terms of Service; use responsibly
  and review local regulations (GDPR etc.) before processing personal data.
