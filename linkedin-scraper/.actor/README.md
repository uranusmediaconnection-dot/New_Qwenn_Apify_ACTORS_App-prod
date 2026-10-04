# LinkedIn Lead Scraper (Public Profiles)

Apify Actor that extracts public firmographic and profile data from LinkedIn URLs.

- Targets **public pages only** (`linkedin.com/in/...` and `linkedin.com/company/...`) — no login, no session cookies, lowest ban risk.
- Parses `application/ld+json` structured data first, then falls back to visible DOM elements (`h1`, `.text-body-medium`, `main`).
- Uses **residential proxies** and `maxConcurrency: 1` to stay under LinkedIn's anti-bot radar.

## Input

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `urls` | array | yes | Public LinkedIn profile/company URLs |

```json
{
  "urls": [
    "https://www.linkedin.com/in/williamhgates/",
    "https://www.linkedin.com/company/microsoft/"
  ]
}
```

## Output

Each dataset item contains: `url`, `name`, `headline`, `location`, `raw_html_snippet`.

## Local development

```bash
apify run
```

## Notes

Authenticated surfaces (people search, employee lists) require logged-in sessions and
carry a high risk of account restriction — deliberately out of scope. See
`docs/research-report.md` at the repository root for the full risk analysis.
