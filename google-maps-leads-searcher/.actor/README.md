# 📍 Google Maps Leads Searcher

Extract **business leads from Google Maps** at scale — names, categories, addresses,
**phone numbers**, **websites**, ratings, review counts, opening hours, plus codes and
GPS coordinates. Built for local lead generation, market research and outbound prospecting.

**No Google Places API key needed.** Results are scraped from the live Maps UI with real
Chromium browsers, residential proxies and human-like pacing.

---

## ✅ What you get

| Field | Example |
|---|---|
| `name` | Bright Smile Dental |
| `category` | Dental clinic |
| `address` | 1200 S Lamar Blvd, Austin, TX 78704 |
| `phone` | +1 512-555-0142 |
| `website` | https://brightsmile.example |
| `rating` / `reviewsCount` | 4.8 / 342 |
| `openingHours` | Open ⋅ Closes 5 PM |
| `latitude` / `longitude` | 30.2500 / -97.7500 |
| `placeUrl` | Canonical Google Maps place link |
| `status` | `ok`, `partial`, `no-results` or `failed` — every record is honest about its quality |

Console **Output views**: *Leads* (contact-ready table) and *Diagnostics* (statuses & errors).
Key-value store: `METRICS` (run counters), `FAILED_REQUESTS` (re-runnable list),
`BLOCKED_SCREENSHOT_*` (what Google showed us, if ever blocked).

---

## 🚀 Quick start (2 minutes)

1. Open the **Input** tab.
2. In **Search queries**, add one query per line — `keyword in city` works best:
   ```
   dentists in Austin TX
   plumbers in Denver CO
   yoga studios in Portland OR
   ```
3. Set **Max results per query** (default 50).
4. Keep **Open each place** ON — that's what yields phone + website.
5. Proxy: leave **RESIDENTIAL** selected. ⚠️ Without it Google blocks datacenter IPs almost instantly.
6. Click **Start** → open the **Output** tab → export CSV/JSON/Excel.

> 💡 Query format matters: `dentists in downtown Austin TX` beats `dentists` — always include a location.

---

## 💰 Pricing (pay per event)

You pay only for **successfully scraped leads**:

| Event | Charged when | Price |
|---|---|---|
| `SCRAPE_RESULT` | One place saved with `status: "ok"` | **$5.00 per 1,000 places** ($0.005 each) |

- `partial`, `no-results` and `failed` records are **never charged**.
- Platform usage (compute + proxy) is included in your Apify plan usage — set a
  **Max total charge** on the run to cap spend; the actor respects it automatically.
- Typical proxy/compute cost: ~$1–2 per 1,000 places with details, ~$0.40 list-only.

**Cost levers:** turn *Open each place* off (3–5× cheaper), keep concurrency at 3,
split huge areas into narrower queries instead of raising limits.

---

## 📈 Getting more than ~120 results per search

Google caps a single query at ~120 listings. Split the geography — the actor
**de-duplicates by place URL**, so overlapping areas are never double-charged:

```
dentists in downtown Austin TX
dentists in north Austin TX
dentists in round rock TX
```

You can also pass **Direct place URLs** (`placeUrls`) to scrape specific places
without searching — perfect for re-running only the leads that failed last time
(copy them from the `FAILED_REQUESTS` record or the Diagnostics view).

---

## 🔌 API / programmatic use

```js
import { ApifyClient } from 'apify-client';
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const run = await client.actor('Sitcod3.Lab/google-maps-leads-searcher').call({
    searchStringsArray: ['dentists in Austin TX'],
    maxResults: 80,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems({ view: 'leads' });
console.log(items);
```

```python
from apify_client import ApifyClient
client = ApifyClient("YOUR_TOKEN")
run = client.actor("Sitcod3.Lab/google-maps-leads-searcher").call(
    run_input={"searchStringsArray": ["plumbers in Denver CO"], "maxResults": 50})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["name"], item["phone"], item["website"])
```

Compatible input aliases (for easy migration from other Maps actors):
`searchQueries`/`queries`, `maxPlacesPerQuery`/`maxCrawledPlacesPerSearch`,
`scrapeDetails`, `proxyConfig`.

### 🔗 Pipeline: leads → emails

```js
const maps  = await client.actor('Sitcod3.Lab/google-maps-leads-searcher').call({ searchStringsArray: ['dentists in Austin TX'] });
const leads = (await client.dataset(maps.defaultDatasetId).listItems()).items;
const sites = leads.filter(l => l.website).map(l => ({ url: l.website }));
const mail  = await client.actor('Sitcod3.Lab/email-extractor').call({ startUrls: sites });
```

---

## 🛡️ Anti-blocking (what runs under the hood)

- **Residential proxies** (Apify Proxy RESIDENTIAL group) with automatic fallback chain
- **Session pool** — a session that hits a CAPTCHA (`/sorry/`) page is retired, the request retried on a fresh IP (up to 4×), and a screenshot is saved for diagnostics
- **Real browser fingerprints** (Crawlee fingerprint generator) — no `navigator.webdriver` leaks
- **Cookie-consent auto-accept** for EU exit IPs
- **Human-like pacing**: low concurrency + randomized delays between page loads
- `retryOnBlocked` for automatic 403/429 recovery

---

## ⚠️ Limitations & honesty

- ~2–5% of places may fail per run (Google rotates its markup and rate limits).
  Failures are recorded with `status: "failed"` — re-run them via `placeUrls`.
- Some businesses hide the phone behind "Request a call" — those show `null`, never fake data.
- Not an official Google Places API replacement; no Place ID stability guarantee.
- Expect ~10–20 places/minute with details on residential proxies (slower by design = fewer blocks).

## 🩺 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no-results` for a valid query | Consent page / unlucky exit IP | Set proxy **country** (e.g. US) and re-run |
| Many `failed` items | Rate limiting | Lower `maxResults`, add narrower queries, keep concurrency ≤3 |
| `phone`/`website` all null | *Open each place* is off | Turn it on |
| Run stopped early | Max total charge reached | Raise the run's spending cap |

## ⚖️ Legal & ethical use

This actor scrapes **publicly listed business information only** — no logins, no private
data. You are responsible for complying with Google's Terms of Service and with
GDPR/CCPA/CAN-SPAM when storing or contacting leads. Do not use scraped contacts for
unsolicited email where opt-in consent is required.

## 🆘 Support

Found a bug or a layout change? Open an issue on this actor's page or contact the
developer with your **Run ID** and the `METRICS` record — markup updates ship fast.
