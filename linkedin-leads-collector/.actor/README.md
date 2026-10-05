# LinkedIn Leads Collector

Collects lead data from **public** LinkedIn profile (`/in/...`) and company
(`/company/...`) pages — no login, no session cookies, lowest-risk approach.

## How it works

Each URL is rendered in a real Chromium browser (Playwright) and parsed through
three extraction layers, most stable first:

1. **JSON-LD** structured data (`Person` / `Organization` graphs)
2. **OpenGraph** meta tags (`og:title`, `og:description`)
3. **Visible DOM** fallbacks (`h1`, headline elements, follower counts)

## Output fields

| Field | Description |
| :--- | :--- |
| `type` | `person` or `company` |
| `status` | `ok`, `partial`, `blocked` (auth wall after retries), or `failed` |
| `name` | Full name / company name |
| `headline` | Profile headline or company tagline |
| `location` | Location when publicly exposed |
| `about` | Public about/description text |
| `website` | External website (company pages) |
| `followers` | Follower count (company pages) |
| `url` / `finalUrl` | Requested and resolved URLs |
| `rawText` | Optional 1000-char page text snippet (`includeRawText: true`) |

## Input

```json
{
  "urls": [
    "https://www.linkedin.com/in/williamhgates/",
    "https://www.linkedin.com/company/microsoft/"
  ],
  "maxConcurrency": 1,
  "includeRawText": false,
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

## Production features

- **Residential proxies by default**, with automatic fallback if unavailable.
- **Auth-wall detection**: when LinkedIn redirects to `/authwall` or login, the session
  is retired and the URL retried on a fresh IP (up to 5 retries); permanently blocked
  URLs are recorded as `status: "blocked"` instead of silently disappearing.
- **Human-like pacing**: `maxConcurrency: 1` by default plus randomized 2–6 s pauses.
- **Browser fingerprint masking** via Crawlee's fingerprint generator.
- Live status messages and per-URL status reporting in the dataset.

## Limits & good practice

- Only public pages are supported. Authenticated surfaces (people search, employee
  lists, contact info) require logged-in sessions and carry a high risk of account
  restriction — deliberately out of scope.
- LinkedIn aggressively rate-limits even public pages; keep concurrency low and batch
  large URL lists across multiple runs.
- Respect LinkedIn's Terms of Service and applicable data-protection law (GDPR/CCPA)
  when storing personal data. See `docs/research-report.md` for the full risk analysis.
