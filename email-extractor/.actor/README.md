# ✉️ Business Email Extractor

Find **business email addresses on any website** — including the ones hidden from
simple scrapers: JavaScript-rendered addresses, HTML-entity encoding (`&#64;`) and
bracket obfuscation (`sales [at] acme [dot] com`).

Built to sit at the end of a lead-generation pipeline: feed it the websites from the
**Google Maps Leads Searcher** or **LinkedIn Leads Collector** and get contact-ready
leads out.

---

## ✅ What you get

| Field | Example | Notes |
|---|---|---|
| `email` | sales@acme.com | Normalized to lowercase |
| `domain` | acme.com | For merging with your lead list |
| `sourceUrl` | https://acme.com/contact | Exact page where it was found |
| `depth` | 1 | 0 = start page, 1+ = followed links |
| `confidence` | 1.0 | See scoring below |
| `scrapedAt` | 2026-10-05T01:00:00Z | ISO-8601 |

Key-value store: `METRICS` (pages crawled, emails found) and `FAILED_REQUESTS`.

### 🧠 Confidence score

| Score | Meaning |
|---|---|
| **1.0** | Found in a real `mailto:` link — nearly always genuine |
| **0.8** | Plain visible text on the page |
| **0.6** | Recovered from obfuscation/encoding — usually deliberate hiding of a real address, occasionally template noise |

### 🧹 Cleaning rules (what gets filtered)

- Global deduplication across the whole run (you're never charged twice for one email)
- Asset false positives: `sprite.png`, `main.css`, `app.min.js`, font files…
- Platform noise: `@example.com`, `@sentry…`, `wixpress.com`, registrar placeholders
- Optional: role addresses (`info@`, `sales@`, `support@`, …) via **Exclude role emails**

### 🔓 Obfuscation support

- HTML entities: `&#64;`, `&#x40;`, `&commat;`, `&#46;`, `&period;`
- Brackets: `user [at] domain [dot] com`, `(at)`, `{at}`, `<at>` — all variants
- JavaScript-rendered emails: pages are fully rendered, then re-scanned after late injection

---

## 🚀 Quick start

1. **Input** → add start URLs (homepages are enough — contact pages are found automatically).
2. **Crawl depth 2** and **Max pages 100** are good defaults for company sites.
3. **Start** → open **Output** → the *Emails* view → export CSV/JSON/Excel.

Contact / About / Team / Imprint pages are crawled **first** at every depth —
that's where business emails live.

---

## 💰 Pricing (pay per event)

| Event | Charged when | Price |
|---|---|---|
| `EMAIL_FOUND` | One **unique** email saved | **$2.00 per 1,000 emails** ($0.002 each) |

- Duplicates and filtered false positives are never charged.
- Platform usage (compute + proxy) follows your Apify plan; typical crawl of a
  20-page company site costs well under $0.10 in usage.
- Set **Max total charge** per run to cap spend — respected automatically.

---

## 🔗 Best pipeline: Maps → Emails

```js
import { ApifyClient } from 'apify-client';
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const maps  = await client.actor('Sitcod3.Lab/google-maps-leads-searcher').call({
    searchStringsArray: ['dentists in Austin TX'], maxResults: 50,
});
const leads = (await client.dataset(maps.defaultDatasetId).listItems()).items;
const sites = leads.filter(l => l.website).map(l => ({ url: l.website }));

const mail  = await client.actor('Sitcod3.Lab/email-extractor').call({
    startUrls: sites, maxDepth: 2, maxPages: 200,
});
const emails = (await client.dataset(mail.defaultDatasetId).listItems()).items;
// merge on domain → complete lead list with contact email
```

---

## ⚠️ Limitations

- Emails locked behind contact **forms** (no address published) cannot be extracted.
- Very large sites: keep `maxPages` sane; the crawler stops at the cap.
- Some sites block datacenter IPs — keep Apify Proxy (RESIDENTIAL) enabled.

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| 0 emails for a site you know has one | Check it's not behind a form/cookie wall; try depth 3 |
| Too many junk addresses | Enable **Exclude role emails**, filter `confidence >= 0.8` |
| Run hits page cap | Raise **Max pages** or split start URLs across runs |

## ⚖️ Legal & consent warning

Emails published by businesses on their own websites are public business contact data —
but **how you use them** is regulated. Before emailing anyone: check GDPR / CCPA /
CAN-SPAM / CASL requirements in the recipient's jurisdiction; many countries require
opt-in consent or a legitimate interest assessment. Do not use this actor for spam.

## 🆘 Support

Report issues with your **Run ID** and the `METRICS` record.
