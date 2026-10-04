# Business Email Extractor

Apify Actor that crawls target domains to discover business emails.

- `PlaywrightCrawler` renders JavaScript, so dynamically injected and obfuscated addresses are caught in the final page HTML.
- Same-origin crawling via `enqueueLinks` with a glob restricted to the start URL's origin.
- Regex-based extraction with in-memory deduplication; `@example.com` placeholders are filtered out.
- Capped at `maxRequestsPerCrawl: 100` with `maxConcurrency: 5` through **residential proxies**.

## Input

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `startUrls` | array | yes | Pages to crawl, e.g. a company website |
| `maxDepth` | integer | no | Crawl depth (default `2`) |

```json
{
  "startUrls": [{ "url": "https://example-company.com" }],
  "maxDepth": 2
}
```

## Output

Each dataset item contains: `url` (page where the email was found), `email`.

## Local development

```bash
apify run
```

## Notes

Pairs well with the Google Maps Scraper: collect `website` values from Maps results and
feed those domains into this actor as `startUrls` to build a complete lead list.
