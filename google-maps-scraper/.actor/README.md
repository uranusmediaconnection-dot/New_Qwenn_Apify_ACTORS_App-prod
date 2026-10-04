# Google Maps Scraper

Apify Actor that extracts business listings from Google Maps search results.

- Uses `PlaywrightCrawler` (real Chromium) so the TLS/browser fingerprint matches a genuine user.
- Routes traffic through **Apify residential proxies** (`RESIDENTIAL` group) — datacenter IPs get blocked almost instantly by Google Maps.
- Keeps `maxConcurrency: 3` to mimic human pacing and stay under rate limits.
- Auto-scrolls the results feed (`div[role="feed"]`) to load listings beyond the initial page.

## Input

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `searchStringsArray` | array | yes | Search queries, e.g. `["Plumbers in New York"]` |
| `maxResults` | integer | no | Cap on results (default `100`) |

```json
{
  "searchStringsArray": ["Plumbers in New York", "Electricians in Boston"],
  "maxResults": 100
}
```

## Output

Each dataset item contains: `name`, `category`, `address`, `website`.

## Local development

```bash
apify run
```

## Notes

Google Maps caps the UI at ~120 results per query. For exhaustive coverage of a large
area, split it into smaller geographic queries (grid partitioning) and merge results —
see `docs/research-report.md` at the repository root.
