# Apify Lead Generation & Scraping Pipeline

Monorepo containing three standalone, production-ready [Apify](https://apify.com/actors) Actors
for scalable lead generation, firmographic enrichment, and contact discovery.
**Each scraper lives in its own top-level folder** and can be developed, run, and deployed
independently.

## Repository Structure

```
.
├── google-maps-scraper/        # Actor 1 — Google Maps business listings
│   ├── .actor/
│   │   ├── actor.json          # Actor metadata (spec v1, version MAJOR.MINOR)
│   │   ├── input_schema.json   # Input UI/validation for the Apify console
│   │   └── README.md           # Actor store page
│   ├── src/main.js             # Crawler logic (PlaywrightCrawler)
│   ├── Dockerfile              # apify/actor-node-playwright-chrome:18
│   └── package.json
├── linkedin-scraper/           # Actor 2 — public LinkedIn profiles/companies (same layout)
├── email-extractor/            # Actor 3 — domain crawl for business emails (same layout)
├── docs/
│   └── research-report.md      # Full implementation research & design documentation
├── scripts/
│   └── deploy_actors.sh        # Original bootstrap script (reference)
└── .github/workflows/deploy.yml# CI/CD: deploys all actors to Apify on every push to main
```

## Actors

| Folder | Actor | What it does |
| :--- | :--- | :--- |
| `google-maps-scraper/` | Google Maps Scraper | Playwright + residential proxies + auto-scroll to extract business listings (name, category, address, website) |
| `linkedin-scraper/` | LinkedIn Lead Scraper | Public-profile extraction via JSON-LD with stealth settings (name, headline, location) — no login required |
| `email-extractor/` | Email Extractor | Same-origin domain crawl that renders JS to find dynamic/obfuscated business emails, deduplicated |

## Prerequisites

- Apify account (free tier works for development)
- Node.js v18+
- Apify CLI: `npm install -g apify-cli`

## Local Development

Each actor folder is a self-contained Apify project:

```bash
cd google-maps-scraper     # or linkedin-scraper / email-extractor
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
cd linkedin-scraper && apify push
cd ../google-maps-scraper && apify push
cd ../email-extractor && apify push
```

### Option C — Link the repository in the Apify Console

1. Apify Console → **Actors → My Actors → Create new → Source: GitHub Repository**.
2. Connect your GitHub account and select `New_Qwenn_Apify_ACTORS_App-prod`.
3. Set the actor's source directory to its folder (e.g. `google-maps-scraper`).
4. Builds then trigger automatically on every push.

## Operational Notes

- **Proxies**: all actors default to the Apify Proxy `RESIDENTIAL` group — datacenter IPs
  are blocked almost instantly by Google Maps and LinkedIn.
- **Concurrency**: deliberately low (Maps: 3, LinkedIn: 1, Email: 5) to mimic human
  pacing; raising it increases ban risk more than throughput.
- **LinkedIn scope**: public pages only (`/in/...`, `/company/...`). Authenticated
  surfaces (people search, employee lists) are intentionally not scraped — they carry a
  high risk of account restriction.
- **Pipeline**: run `google-maps-scraper` → collect `website` values → feed them to
  `email-extractor` as `startUrls` for an end-to-end lead list.
- Full design rationale, anti-bot analysis, and alternatives: [`docs/research-report.md`](docs/research-report.md).
