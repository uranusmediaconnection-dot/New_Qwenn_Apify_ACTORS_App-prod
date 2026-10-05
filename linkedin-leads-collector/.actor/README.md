# 💼 LinkedIn Leads Collector

Collect lead data from **public LinkedIn pages** — profiles (`/in/...`) and companies
(`/company/...`) — **without logging in**. Names, headlines, locations, about text,
company websites and follower counts, extracted through three redundant layers so a
single LinkedIn layout change never breaks your run.

---

## ✅ What you get

| Field | Person pages | Company pages |
|---|---|---|
| `name` | Full name | Company name |
| `type` | `person` | `company` |
| `headline` | Profile headline | — |
| `location` | Public location | HQ locality |
| `about` | Public about text | Company description |
| `website` | — | External website |
| `followers` | — | Follower count |
| `status` | `ok` / `partial` / `blocked` / `failed` — every URL gets an honest verdict | |

**Extraction layers** (most stable first): ① JSON-LD structured data →
② OpenGraph meta tags → ③ rendered DOM fallbacks.

Console **Output views**: *Leads* and *Diagnostics*. Key-value store: `METRICS`,
`FAILED_REQUESTS`, and up to 3 `BLOCKED_SCREENSHOT_*` images showing exactly what
LinkedIn served when a URL stayed blocked.

---

## 🚀 Quick start

1. Open the **Input** tab.
2. Paste public LinkedIn URLs — one per line:
   ```
   https://www.linkedin.com/in/williamhgates/
   https://www.linkedin.com/company/microsoft/
   ```
3. Keep **Max concurrency = 1** (LinkedIn is extremely sensitive to traffic bursts).
4. Proxy: leave **RESIDENTIAL** selected.
5. **Start** → check the *Leads* view in **Output** → export CSV/JSON/Excel.

> ⚠️ Only public pages work. People-search, employee lists and any page requiring a
> login are **not supported** — attempting them risks *your* LinkedIn account, and this
> actor refuses to use cookies/sessions by design.

---

## 💰 Pricing (pay per event)

| Event | Charged when | Price |
|---|---|---|
| `PROFILE_SCRAPED` | One URL collected with `status: "ok"` | **$10.00 per 1,000 profiles** ($0.01 each) |

- `partial`, `blocked` and `failed` URLs are **never charged** — you only pay for data.
- Set **Max total charge** on your run to cap spending; the actor respects it automatically.

---

## 🔐 Why URLs come back `blocked` (honesty section)

LinkedIn serves logged-out visitors a sign-in wall on a share of pages — the exact share
depends on the profile's privacy settings, region and LinkedIn's current risk controls. When it
happens, this actor:

1. Retires the browser session and **retries on a fresh residential IP** (up to 5×).
2. Dismisses the contextual sign-in **modal** when the profile is behind it.
3. If the wall persists, records `status: "blocked"` with a screenshot — **you are not charged**,
   and the URL lands in `FAILED_REQUESTS` so you can retry it in a later run (different IPs,
   different outcome — blocked is usually temporary).

Company pages are blocked far less often than person pages. For highest yield, run large
lists across multiple runs rather than one giant run.

---

## 🔌 API / programmatic use

```js
import { ApifyClient } from 'apify-client';
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const run = await client.actor('Sitcod3.Lab/linkedin-leads-collector').call({
    urls: ['https://www.linkedin.com/company/microsoft/'],
});
const { items } = await client.dataset(run.defaultDatasetId).listItems({ view: 'leads' });
console.log(items);
```

Input aliases accepted via API: `startUrls` (array of strings or `{url}` objects).

### 🔗 Pipeline: company pages → website emails

```js
const li    = await client.actor('Sitcod3.Lab/linkedin-leads-collector').call({ urls: companyPages });
const leads = (await client.dataset(li.defaultDatasetId).listItems()).items;
const sites = leads.filter(l => l.website).map(l => ({ url: l.website }));
const mail  = await client.actor('Sitcod3.Lab/email-extractor').call({ startUrls: sites });
```

---

## 🛡️ Anti-blocking (under the hood)

- Residential proxies (Apify Proxy) with automatic fallback chain
- `maxConcurrency: 1` by default + randomized 2–6 s pauses between pages
- Session pool: any sign-in-wall response retires the session; retries get fresh IPs
- Real browser fingerprints via Crawlee's fingerprint generator
- `retryOnBlocked` for automatic 403/429/999 recovery

## ⚠️ Limitations

- Public data only: emails, phone numbers and experience lists behind login are out of scope.
- LinkedIn's markup changes often; the 3-layer cascade absorbs most changes, but report
  persistent `partial` results — fixes ship fast.
- Very large lists: keep batches ≤ 500 URLs per run for best block rates.

## ⚖️ Legal & compliance

This actor accesses **publicly available information without authentication** and stores
no LinkedIn credentials. You remain responsible for complying with LinkedIn's Terms of
Service and data-protection law (GDPR/CCPA) in your jurisdiction when storing or
contacting individuals. Do not use collected data for unsolicited messaging where
opt-in consent is required.

## 🆘 Support

Include your **Run ID** and the `METRICS` record when reporting an issue — it tells us
exactly which layer failed and how many IPs were tried.
