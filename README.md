# Apify Lead Generation & Scraping Pipeline

Monorepo containing three standalone, production-ready [Apify](https://apify.com/actors) Actors
for scalable lead generation, firmographic enrichment, and contact discovery.
**Each scraper lives in its own top-level folder** and can be developed, run, and deployed
independently.

## Repository Structure

```
.
├── google-maps-leads-searcher/ # Actor 1 — "Google Maps Leads Searcher"
│   ├── .actor/
│   │   ├── actor.json          # Actor metadata (spec v1, version MAJOR.MINOR)
│   │   ├── input_schema.json   # Input UI/validation for the Apify console
│   │   └── README.md           # Actor store page
│   ├── src/main.js             # Crawler logic (PlaywrightCrawler)
│   ├── Dockerfile              # apify/actor-node-playwright-chrome:18
│   └── package.json
├── linkedin-leads-collector/   # Actor 2 — "LinkedIn Leads Collector" (same layout)
├── email-extractor/            # Actor 3 — business email extractor (same layout)
├── docs/
│   └── research-report.md      # Full implementation research & design documentation
├── scripts/
│   └── deploy_actors.sh        # Original bootstrap script (reference)
└── .github/workflows/deploy.yml# CI/CD: deploys all actors to Apify on every push to main
```

## Actors

| Folder | Apify Actor | What it does |
| :--- | :--- | :--- |
| `google-maps-leads-searcher/` | **Google Maps Leads Searcher** ([console](https://console.apify.com/actors/Z8cXZbclb7QT7VzpT)) | Feed scrolling + place detail pages → name, category, address, phone, website, rating, reviews, hours, coordinates. Consent handling, CAPTCHA session rotation, per-query budgets |
| `linkedin-leads-collector/` | **LinkedIn Leads Collector** ([console](https://console.apify.com/actors/GXqLkazwz2AZIEBw0)) | Public profiles/companies via 3 extraction layers (JSON-LD → OpenGraph → DOM). Auth-wall detection + retry on fresh IPs, per-URL status reporting |
| `email-extractor/` | Email Extractor | Same-origin domain crawl that renders JS to find dynamic/obfuscated business emails, deduplicated |

## Prerequisites

- Apify account (free tier works for development)
- Node.js v18+
- Apify CLI: `npm install -g apify-cli`

## Local Development

Each actor folder is a self-contained Apify project:

```bash
cd google-maps-leads-searcher   # or linkedin-leads-collector / email-extractor
apify login                # one-time (or export APIFY_TOKEN=...)
apify run                  # runs locally against ./storage
```

Sample input goes in `storage/key_value_stores/default/INPUT.json`, e.g.:

```json
{ "searchStringsArray": ["Plumbers in New York"], "maxResults": 100 }
```

## Deployment

### Option A — CI/CD via GitHub Actions (configured)

1. Add your Apify API token to this repository:
   **Settings → Secrets and variables → Actions → New repository secret**, name it `APIFY_TOKEN`.
2. Every push to `main` automatically runs `apify push` for all three actors
   (matrix build, see `.github/workflows/deploy.yml`). Actors are created on your
   Apify account automatically on first deploy.

### Option B — Manual push

```bash
cd linkedin-leads-collector && apify push
cd ../google-maps-leads-searcher && apify push
cd ../email-extractor && apify push
```

### Option C — Link the repository in the Apify Console

1. Apify Console → **Actors → My Actors → Create new → Source: GitHub Repository**.
2. Connect your GitHub account and select `New_Qwenn_Apify_ACTORS_App-prod`.
3. Set the actor's source directory to its folder (e.g. `google-maps-leads-searcher`).
4. Builds then trigger automatically on every push.

## Publishing status

All three actors are **published (public)** on Apify Store under the `sitcod3.lab`
developer account:

- https://apify.com/sitcod3.lab/google-maps-leads-searcher
- https://apify.com/sitcod3.lab/linkedin-leads-collector
- https://apify.com/sitcod3.lab/email-extractor

They currently show **Pay per usage** (clients pay platform costs only) until
pay-per-event monetization is switched on in the Console (Publishing → Monetization)
with the event names/prices below.

## Monetization (Pay-Per-Event)

All three actors ship with **pay-per-event charging hooks** (`Actor.charge`) and only
charge for successful results:

| Actor | Event | Charged when | Price (PPE setting) | Free tier |
| :--- | :--- | :--- | :--- | :--- |
| Google Maps Leads Searcher | `RESULT` | one place saved with `status: "ok"` | **$0.0025** ($2.50 / 1,000 places) | 2,500 results/month |
| LinkedIn Leads Collector | `PROFILE_SCRAPED` | one URL collected with `status: "ok"` | $0.01 ($10.00 / 1,000 profiles) | enable as desired |
| Business Email Extractor | `EMAIL_FOUND` | one unique email saved | $0.002 ($2.00 / 1,000 emails) | enable as desired |

Pricing method (validated against 2026 market rates): pay-per-event at **$2.50 per
1,000 leads** sits inside the $1.40–$12 band of comparable lead-gen actors
(automly LinkedIn Employees $1.50–$6, code_crafter Leads Finder $1.50, HarvestAPI
LinkedIn $3–$12, scrapyx B2B Leads $1.40), comfortably covers ~$1–2/1k proxy+compute
cost, and yields ~$2.00/1k net after Apify's 20% developer payout fee. A 2,500-result
free tier maximizes trial conversions without material revenue loss. Do **not** go
below $1.50/1k (unsustainable once residential proxy is counted); above ~$6/1k this
actor loses to cheaper generic Maps scrapers.

`partial` / `blocked` / `failed` / `no-results` records are never charged. Charges are
no-ops until each actor's monetization is enabled in the Apify Console
(**Publishing → Monetization → Pay per event**, define the event names above, pick the
primary event). For Google Maps Leads Searcher set: Paid actor **ON**, pricing model
**Pay per event**, event `RESULT` at **$0.0025**, free monthly usage **2,500 events**.
Publishing to the Store additionally requires the output schema (already
in `.actor/output_schema.json` for every actor) and a completed Publishing checklist.

## Actor Quality Assets (per actor, in `.actor/`)

- `input_schema.json` — console input form (stringList/proxy editors, sections, prefills)
- `dataset_schema.json` — item validation + Console **Output views** (`leads`/`emails` + `diagnostics`)
- `output_schema.json` — run output links for Console + AI-agent/MCP integration (required for Store)
- `README.md` — full client manual: quick start, pricing, API examples, pipeline chaining, troubleshooting, legal

Runtime diagnostics in each run's key-value store: `METRICS` (counters incl. charged events),
`FAILED_REQUESTS` (re-runnable URLs), `BLOCKED_SCREENSHOT_*` (what the target site showed when blocking).

## Operational Notes

- **Proxies**: all actors default to the Apify Proxy `RESIDENTIAL` group — datacenter IPs
  are blocked almost instantly by Google Maps and LinkedIn.
- **Concurrency**: deliberately low (Maps: 3, LinkedIn: 1, Email: 5) to mimic human
  pacing; raising it increases ban risk more than throughput.
- **LinkedIn scope**: public pages only (`/in/...`, `/company/...`). Authenticated
  surfaces (people search, employee lists) are intentionally not scraped — they carry a
  high risk of account restriction.
- **Pipeline**: run `google-maps-leads-searcher` → collect `website` values → feed them
  to `email-extractor` as `startUrls` for an end-to-end lead list.
- **Status fields**: every dataset item carries a `status` (`ok` / `partial` / `blocked`
  / `failed` / `no-results`) so incomplete scrapes are visible instead of silently lost.
- **Compass-style input aliases** (Maps): `searchQueries`, `maxPlacesPerQuery`,
  `maxCrawledPlacesPerSearch`, `scrapeDetails`, `proxyConfig` and direct `placeUrls`
  are accepted via `src/input-normalizer.js`.
- **enqueueLinks strategy**: Maps detail requests are enqueued with `strategy: 'all'` —
  Google's `consent.google.com` redirects cross hostnames and would otherwise be
  silently skipped by Crawlee's default SameHostname strategy.
- Full design rationale, anti-bot analysis, and alternatives: [`docs/research-report.md`](docs/research-report.md).
