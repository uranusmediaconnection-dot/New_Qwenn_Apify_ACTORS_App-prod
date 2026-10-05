/**
 * Google Maps Leads Searcher
 * --------------------------
 * Searches Google Maps for each input query, scrolls the results feed to collect
 * place links, then visits every place detail page to extract business leads:
 * name, category, address, phone, website, rating, reviews, opening hours and
 * coordinates. Direct place URLs are also accepted as input.
 *
 * Production hardening:
 *  - Apify Proxy (RESIDENTIAL group by default) with graceful fallbacks
 *  - Session pool + retryOnBlocked; sessions retired on CAPTCHA / block pages
 *  - Block screenshots and BLOCKED/METRICS diagnostics in the key-value store
 *  - Cookie-consent handling (EU exit IPs)
 *  - Randomized human-like pacing + low default concurrency
 *  - Stable `data-item-id` selectors on detail pages + card-based fallback
 *  - Per-query result budgets and automatic deduplication by place URL
 *  - Pay-per-event hook: SCRAPE_RESULT charged for every `ok` lead
 *  - Dataset + output schemas for Console views and AI-agent integration
 */
import os from 'node:os';
import { Actor } from 'apify';
import { PlaywrightCrawler, createPlaywrightRouter, log } from 'crawlee';
import { normalizeMapsInput } from './input-normalizer.js';

const CHARGE_EVENT = 'SCRAPE_RESULT';
const HARD_MAX_REQUESTS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

await Actor.init();

const input = normalizeMapsInput((await Actor.getInput()) ?? {});

const searchStrings = input.searchStringsArray
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
const placeUrls = input.placeUrls;

if (!searchStrings.length && !placeUrls.length) {
    await Actor.exit('Input is missing search queries ("searchStringsArray") and place URLs ("placeUrls"). Provide at least one, e.g. "Dentists in New York, NY".');
}

const maxResultsPerQuery = clamp(Math.floor(input.maxResults) || 50, 1, 1000);
const language = input.language;
const includePlaceDetails = input.includePlaceDetails;
const maxConcurrency = clamp(Math.floor(input.maxConcurrency) || 3, 1, 10);

/* ------------------------------------------------------------------ */
/* Metrics & diagnostics                                               */
/* ------------------------------------------------------------------ */
const metrics = {
    startedAt: new Date().toISOString(),
    queries: searchStrings.length,
    queriesProcessed: 0,
    directPlaceUrls: placeUrls.length,
    placesSaved: 0,
    okCount: 0,
    partialCount: 0,
    noResultsCount: 0,
    failedCount: 0,
    captchaBlocks: 0,
    chargedEvents: 0,
    finishedAt: null,
};
const failedRequests = [];
let blockShots = 0;

async function saveBlockScreenshot(page, url) {
    if (blockShots >= 3) return;
    blockShots += 1;
    try {
        const buf = await page.screenshot({ type: 'png' });
        await Actor.setValue(`BLOCKED_SCREENSHOT_${blockShots}`, buf, { contentType: 'image/png' });
        log.warning(`CAPTCHA/block page detected for ${url} - screenshot saved as BLOCKED_SCREENSHOT_${blockShots}`);
    } catch { /* best effort */ }
}

/** Push one dataset item first (data safety), then attempt the PPE charge for billable results. */
async function pushItem(item) {
    try {
        await Actor.pushData(item);
    } catch (err) {
        log.error(`pushData rejected (dataset schema?): ${String(err?.message).slice(0, 300)}`);
        metrics.failedCount += 1;
        return;
    }
    if (item.status === 'ok') {
        metrics.okCount += 1;
        metrics.placesSaved += 1;
        try {
            const res = await Actor.charge({ eventName: CHARGE_EVENT });
            if (res && typeof res.chargedCount === 'number') metrics.chargedEvents += res.chargedCount;
        } catch (err) {
            log.debug(`Charge skipped (${String(err?.message).slice(0, 120)})`);
        }
    } else if (item.status === 'partial') {
        metrics.partialCount += 1;
        metrics.placesSaved += 1;
    }
}

async function updateStatus() {
    await Actor.setStatusMessage(
        `Saved ${metrics.placesSaved} place(s), ${metrics.failedCount} failed (${metrics.queriesProcessed}/${searchStrings.length} queries done)`,
    ).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Proxy: residential IPs are mandatory for Google Maps at scale.      */
/* ------------------------------------------------------------------ */
async function buildProxyConfiguration() {
    try {
        const cfg = await Actor.createProxyConfiguration(input.proxyConfiguration);
        if (cfg) return cfg;
    } catch (err) {
        log.warning(`Preferred proxy configuration failed: ${err.message}`);
    }
    try {
        const cfg = await Actor.createProxyConfiguration({ useApifyProxy: true });
        if (cfg) {
            log.warning('Falling back to default Apify Proxy groups (RESIDENTIAL strongly recommended for Google Maps).');
            return cfg;
        }
    } catch { /* account without Apify Proxy */ }
    log.warning('Apify Proxy unavailable - connecting directly. Expect CAPTCHAs/blocks beyond a handful of requests.');
    return undefined;
}

const proxyConfiguration = await buildProxyConfiguration();

/* ------------------------------------------------------------------ */
/* Memory guard: Google Maps tabs are heavy (~300 MB each). Running    */
/* more concurrent pages than the container RAM supports gets the run  */
/* aborted by the OOM killer ("actor stopped"), so cap concurrency to   */
/* what fits in memory. Prefer the Apify-assigned memory               */
/* (MEMORY_MBYTES / APIFY_MEMORY_MBYTES) over host free memory, which  */
/* is unreliable inside containers.                                    */
/* ------------------------------------------------------------------ */
const MEMORY_PER_TAB_MB = 350; // conservative estimate incl. browser pool overhead
const MEMORY_BASELINE_MB = 250; // node + crawlee baseline before opening tabs
const assignedMb = parseInt(process.env.MEMORY_MBYTES ?? process.env.APIFY_MEMORY_MBYTES ?? '', 10);
const availableMb = Number.isFinite(assignedMb) && assignedMb > 0
    ? assignedMb
    : Math.min(os.freemem() / 1024 / 1024, os.totalmem() / 1024 / 1024);
const maxConcurrencyByMemory = Math.max(1, Math.floor((availableMb - MEMORY_BASELINE_MB) / MEMORY_PER_TAB_MB));
const effectiveConcurrency = clamp(Math.min(maxConcurrency, maxConcurrencyByMemory), 1, 10);
if (effectiveConcurrency < maxConcurrency) {
    log.warning(`Limiting concurrency ${maxConcurrency} -> ${effectiveConcurrency}: only ~${Math.round(availableMb)} MB of memory available (OOM protection). Increase actor memory or lower "maxConcurrency".`);
}

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */
const seenUrls = new Set();
const perQueryCount = new Map();

/** Canonical Google Place ID (!19sChIJ...) or feature id (!1s0x..:0x..) from a place URL. */
function parsePlaceId(url) {
    const u = String(url);
    const pid = u.match(/!19s([A-Za-z0-9_-]{10,})/);
    if (pid) return pid[1];
    const ftid = u.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    return ftid ? ftid[1] : null;
}

function parseCoordinates(url) {
    let m = String(url).match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (!m) m = String(url).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : { latitude: null, longitude: null };
}

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */
async function acceptConsentIfPresent(page) {
    try {
        const btn = page.locator('#L2AGLb, button[aria-label*="Accept all"], button[aria-label*="Accept the use"], form[action*="consent"] button').first();
        if (await btn.count()) {
            await btn.click({ timeout: 5000 });
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(1500);
            log.debug('Cookie consent accepted.');
            return true;
        }
        if (page.url().includes('consent.google.com')) {
            log.warning('Consent page detected but no accept button matched.');
        }
    } catch (err) {
        log.debug(`Consent handling failed: ${err.message}`);
    }
    return false;
}

async function checkBlocked(page, session, requestUrl) {
    const url = page.url();
    if (url.includes('/sorry/') || url.includes('/sorryindex')) {
        metrics.captchaBlocks += 1;
        await saveBlockScreenshot(page, requestUrl);
        session?.retire();
        throw new Error(`Google CAPTCHA/block page served for ${requestUrl} - retiring session and retrying`);
    }
}

/* ------------------------------------------------------------------ */
/* Browser-side extraction (serialized into the page - no closures!)   */
/* ------------------------------------------------------------------ */
const extractFeedCards = () => {
    const clean = (s) => { const t = s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); return t || null; };
    const out = [];
    for (const card of document.querySelectorAll('div.Nv2PK')) {
        const a = card.querySelector('a.hfpxzc');
        const ratingAria = card.querySelector('span[role="img"]')?.getAttribute('aria-label') || null;
        let rating = null;
        let reviewsCount = null;
        if (ratingAria) {
            const m = ratingAria.match(/([\d.,]+)\s*stars?/i);
            const r = ratingAria.match(/([\d.,]+)\s*reviews?/i);
            rating = m ? parseFloat(m[1].replace(',', '.')) : null;
            reviewsCount = r ? parseInt(r[1].replace(/[^\d]/g, ''), 10) : null;
        }
        const rows = [...card.querySelectorAll('.W4Efsd')].map((r) => clean(r.innerText)).filter(Boolean);
        let category = null;
        let address = null;
        if (rows.length) {
            const meaningful = rows.filter((r) => !/^[\d.,\s]+\(?[\d.,\s]*\)?$/.test(r));
            const first = (meaningful[0] || '').split('·').map((s) => s.trim()).filter(Boolean);
            category = first[0] || null;
            address = first[1] || meaningful[1] || null;
        }
        const name = clean(a?.getAttribute('aria-label')) || clean(card.querySelector('.qBF1Pd')?.textContent);
        if (a?.href) out.push({ name, placeUrl: a.href, category, address, rating, reviewsCount });
    }
    if (!out.length) {
        // Fallback: markup changed - grab any place anchor inside the results feed
        const seen = new Set();
        for (const a of document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]')) {
            if (!a.href || seen.has(a.href)) continue;
            seen.add(a.href);
            out.push({ name: clean(a.getAttribute('aria-label')), placeUrl: a.href, category: null, address: null, rating: null, reviewsCount: null });
        }
    }
    return out;
};

const extractPlaceDetails = () => {
    const clean = (s) => { const t = s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); return t || null; };
    const name = clean(document.querySelector('h1.DUwDvf')?.textContent) || clean(document.querySelector('h1')?.textContent);
    const addrBtn = document.querySelector('button[data-item-id="address"]');
    let address = addrBtn ? clean(addrBtn.getAttribute('aria-label') || addrBtn.textContent) : null;
    if (address) address = address.replace(/^Address:\s*/i, '');
    const webA = document.querySelector('a[data-item-id="authority"]');
    const website = webA ? webA.href : null;
    const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
    let phone = null;
    if (phoneBtn) {
        phone = (phoneBtn.getAttribute('data-item-id') || '').replace('phone:tel:', '') || null;
        if (!phone) {
            const l = clean(phoneBtn.getAttribute('aria-label') || '');
            phone = l ? l.replace(/^Phone:\s*/i, '') : null;
        }
    }
    const category = clean(document.querySelector('button.DkEaL')?.textContent);
    const ratingText = clean(document.querySelector('div.F7nice span[aria-hidden="true"]')?.textContent);
    const rating = ratingText ? parseFloat(ratingText) || null : null;
    const reviewsAria = document.querySelector('div.F7nice span[aria-label]')?.getAttribute('aria-label') || null;
    const reviewsCount = reviewsAria ? parseInt(reviewsAria.replace(/[^\d]/g, ''), 10) || null : null;
    const plusBtn = document.querySelector('button[data-item-id="oloc"]');
    const plusCode = plusBtn ? clean(plusBtn.getAttribute('aria-label'))?.replace(/^Location:\s*/i, '') : null;
    const hoursBtn = document.querySelector('button[data-item-id^="oh"]');
    const openingHours = hoursBtn ? clean(hoursBtn.getAttribute('aria-label')) : null;
    return { name, category, address, phone, website, rating, reviewsCount, plusCode, openingHours };
};

const feedScrollState = () => {
    const feed = document.querySelector('div[role="feed"]');
    const bodyStart = (document.body.innerText || '').slice(0, 4000);
    return {
        hasFeed: !!feed,
        cardCount: document.querySelectorAll('div.Nv2PK').length,
        endOfList: !!feed && /end of the list/i.test(feed.innerText || ''),
        noResults: /did not match any places|no results found/i.test(bodyStart),
    };
};

/* ------------------------------------------------------------------ */
/* Request handlers                                                    */
/* ------------------------------------------------------------------ */
const router = createPlaywrightRouter();

async function pushDetailItem({ page, pageUrl, query, card, source }) {
    await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {});
    const d = await page.evaluate(extractPlaceDetails);
    const { latitude, longitude } = parseCoordinates(pageUrl);
    await pushItem({
        searchQuery: query ?? null,
        status: (d.name || card?.name) ? 'ok' : 'partial',
        source,
        placeId: parsePlaceId(pageUrl),
        name: d.name || card?.name || null,
        category: d.category || card?.category || null,
        address: d.address || card?.address || null,
        phone: d.phone || null,
        website: d.website || null,
        rating: d.rating ?? card?.rating ?? null,
        reviewsCount: d.reviewsCount ?? card?.reviewsCount ?? null,
        openingHours: d.openingHours || null,
        plusCode: d.plusCode || null,
        latitude,
        longitude,
        placeUrl: pageUrl,
        scrapedAt: new Date().toISOString(),
    });
    if (query) perQueryCount.set(query, (perQueryCount.get(query) ?? 0) + 1);
    await updateStatus();
}

async function handleFeed({ page, request, session, enqueueLinks, log: l }) {
    const { query } = request.userData;
    await acceptConsentIfPresent(page);
    await checkBlocked(page, session, request.url);

    // Single-result queries redirect straight to the place page
    if (page.url().includes('/maps/place/')) {
        await pushDetailItem({ page, pageUrl: page.url(), query, card: null, source: 'direct-redirect' });
        metrics.queriesProcessed += 1;
        return;
    }

    // Wait for the Maps SPA to render results (feed, cards, no-results text or a place redirect)
    await page.waitForFunction(() => {
        const bodyText = ((document.body && document.body.innerText) || '').slice(0, 3000);
        return !!document.querySelector('div[role="feed"]')
            || document.querySelectorAll('div.Nv2PK').length > 0
            || /did not match any places|no results found/i.test(bodyText)
            || window.location.pathname.includes('/maps/place/');
    }, null, { timeout: 45000 }).catch(() => l.warning(`Timed out waiting for Google Maps results to render for "${query}".`));

    await acceptConsentIfPresent(page); // consent can appear after the first render
    await checkBlocked(page, session, request.url);
    if (page.url().includes('consent.google.com')) {
        session?.retire();
        throw new Error(`Stuck on the Google consent page for ${request.url} - retiring session and retrying`);
    }
    if (page.url().includes('/maps/place/')) {
        await pushDetailItem({ page, pageUrl: page.url(), query, card: null, source: 'direct-redirect' });
        metrics.queriesProcessed += 1;
        return;
    }

    // Scroll the results feed until the budget/end is reached
    const deadline = Date.now() + 180000;
    let stable = 0;
    let misses = 0;
    let prevCount = 0;
    while (Date.now() < deadline) {
        const state = await page.evaluate(feedScrollState);
        if (state.endOfList || (state.noResults && state.cardCount === 0)) break;
        if (state.cardCount >= maxResultsPerQuery) break;
        if (!state.hasFeed && state.cardCount === 0) {
            misses += 1;
            if (misses >= 5) break; // results area never appeared
        }
        stable = state.cardCount === prevCount ? stable + 1 : 0;
        prevCount = state.cardCount;
        if (stable >= 4 && state.cardCount > 0) break; // feed stopped growing
        await page.evaluate(() => {
            const feed = document.querySelector('div[role="feed"]');
            if (feed) feed.scrollTop = feed.scrollHeight;
            else window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(1200 + Math.random() * 1600);
    }

    const cards = await page.evaluate(extractFeedCards);
    metrics.queriesProcessed += 1;
    if (!cards.length) {
        const pageTitle = await page.title().catch(() => null);
        const bodySnippet = await page.evaluate(() => ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 300)).catch(() => null);
        l.warning(`No places found for query "${query}" (page title: ${pageTitle}).`);
        metrics.noResultsCount += 1;
        await pushItem({ searchQuery: query, status: 'no-results', placeUrl: request.url, pageTitle, bodySnippet, scrapedAt: new Date().toISOString() });
        return;
    }

    const budget = Math.max(0, maxResultsPerQuery - (perQueryCount.get(query) ?? 0));
    const fresh = cards.filter((c) => c.placeUrl && !seenUrls.has(c.placeUrl)).slice(0, budget);
    if (!fresh.length) {
        l.info(`Query "${query}": ${cards.length} cards seen, all already collected/duplicated.`);
        return;
    }

    if (includePlaceDetails) {
        const cardByUrl = new Map(fresh.map((c) => [c.placeUrl, c]));
        await enqueueLinks({
            urls: fresh.map((c) => c.placeUrl),
            label: 'DETAIL',
            strategy: 'all', // detail URLs may redirect via consent.google.com - never skip on cross-host redirect
            transformRequestFunction: (req) => {
                req.userData = { ...(req.userData ?? {}), query, card: cardByUrl.get(req.url) ?? null };
                return req;
            },
        });
        fresh.forEach((c) => seenUrls.add(c.placeUrl));
        l.info(`Query "${query}": enqueued ${fresh.length} place detail page(s) (of ${cards.length} cards).`);
    } else {
        // Feed-only mode: push what the result cards expose (no phone/website)
        for (const c of fresh) {
            const { latitude, longitude } = parseCoordinates(c.placeUrl);
            await pushItem({
                searchQuery: query,
                status: c.name ? 'ok' : 'partial',
                source: 'feed',
                placeId: parsePlaceId(c.placeUrl),
                name: c.name,
                category: c.category,
                address: c.address,
                phone: null,
                website: null,
                rating: c.rating,
                reviewsCount: c.reviewsCount,
                openingHours: null,
                plusCode: null,
                latitude,
                longitude,
                placeUrl: c.placeUrl,
                scrapedAt: new Date().toISOString(),
            });
            perQueryCount.set(query, (perQueryCount.get(query) ?? 0) + 1);
        }
        fresh.forEach((c) => seenUrls.add(c.placeUrl));
        await updateStatus();
    }
}

async function handleDetail({ page, request, session }) {
    await acceptConsentIfPresent(page);
    await checkBlocked(page, session, request.url);
    if (page.url().includes('consent.google.com')) {
        session?.retire();
        throw new Error(`Stuck on the Google consent page for ${request.url} - retiring session and retrying`);
    }
    await pushDetailItem({
        page,
        pageUrl: request.url,
        query: request.userData.query ?? null,
        card: request.userData.card ?? null,
        source: request.userData.query ? 'detail' : 'direct-url',
    });
}

router.addDefaultHandler((ctx) => handleFeed(ctx));
router.addHandler('FEED', (ctx) => handleFeed(ctx));
router.addHandler('DETAIL', (ctx) => handleDetail(ctx));

/* ------------------------------------------------------------------ */
/* Crawler                                                             */
/* ------------------------------------------------------------------ */
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: router,
    maxConcurrency: effectiveConcurrency,
    maxRequestRetries: 4,
    maxRequestsPerCrawl: Math.min(HARD_MAX_REQUESTS, searchStrings.length * (maxResultsPerQuery + 1) + placeUrls.length + 10),
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 400, // feed scrolling can legitimately take minutes
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: Math.max(5, effectiveConcurrency * 3),
        sessionOptions: { maxErrorScore: 3 },
    },
    retryOnBlocked: true,
    browserPoolOptions: { useFingerprints: true },
    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
            await sleep(800 + Math.random() * 2200); // human-like pacing
            await page.setExtraHTTPHeaders({ 'Accept-Language': `${language},en;q=0.9` }).catch(() => {});
        },
    ],
    postNavigationHooks: [
        async ({ page }) => {
            // Reap orphaned Google Maps popups ("Open in Maps" button opens a
            // second full page load per detail visit). Left open, they leak
            // ~300 MB each and get the run killed by the OOM killer.
            const extraPages = page.context().pages().filter((p) => p !== page);
            for (const p of extraPages) {
                try { await p.close(); } catch { /* already closed */ }
            }
        },
    ],
    failedRequestHandler: async ({ request, log: l }, error) => {
        l.error(`Request failed after all retries: ${request.url} - ${error?.message}`);
        metrics.failedCount += 1;
        failedRequests.push({ url: request.url, query: request.userData?.query ?? null, error: String(error?.message ?? error).slice(0, 300) });
        await pushItem({
            searchQuery: request.userData?.query ?? null,
            status: 'failed',
            placeUrl: request.url,
            error: String(error?.message ?? error).slice(0, 500),
            scrapedAt: new Date().toISOString(),
        });
    },
});

const requests = [
    ...searchStrings.map((query) => ({
        url: `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=${encodeURIComponent(language)}`,
        label: 'FEED',
        userData: { query },
    })),
    ...placeUrls.map((placeUrl) => ({
        url: placeUrl,
        label: 'DETAIL',
        userData: { query: null, card: null },
    })),
];

log.info(
    `Google Maps Leads Searcher starting: ${searchStrings.length} query(ies), ${placeUrls.length} direct place URL(s), `
    + `up to ${maxResultsPerQuery} results per query, details=${includePlaceDetails}, concurrency=${effectiveConcurrency}`
    + `${effectiveConcurrency < maxConcurrency ? ` (capped from ${maxConcurrency} by available memory)` : ''}, `
    + `proxy=${proxyConfiguration ? 'Apify Proxy' : 'direct'}`,
);

try {
    await Actor.setStatusMessage('Crawling Google Maps...');
    await crawler.run(requests);
    metrics.finishedAt = new Date().toISOString();
    await Actor.setValue('METRICS', metrics);
    if (failedRequests.length) await Actor.setValue('FAILED_REQUESTS', failedRequests);
    await Actor.setStatusMessage(
        `Finished: ${metrics.placesSaved} place(s) saved (${metrics.okCount} ok, ${metrics.partialCount} partial), ${metrics.failedCount} failed.`,
        { level: 'SUCCESS' },
    );
    await Actor.exit();
} catch (err) {
    log.exception(err, 'Actor run failed');
    metrics.finishedAt = new Date().toISOString();
    await Actor.setValue('METRICS', metrics).catch(() => {});
    await Actor.fail(`Run failed: ${err.message}`);
}
