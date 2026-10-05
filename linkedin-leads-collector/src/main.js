/**
 * LinkedIn Leads Collector
 * ------------------------
 * Collects lead data from PUBLIC LinkedIn profile (/in/...) and company
 * (/company/...) pages. No login and no session cookies are used - the
 * lowest-risk approach for LinkedIn scraping.
 *
 * Extraction layers (most stable first):
 *   1. JSON-LD structured data (Person / Organization graphs)
 *   2. OpenGraph meta tags (og:title / og:description)
 *   3. Visible DOM (h1, headline elements, follower counts)
 *
 * Production hardening:
 *  - Residential proxies with graceful fallbacks
 *  - Session pool; sessions retired on auth-wall / block responses
 *  - Serialized traffic by default (maxConcurrency 1) + human-like pauses
 *  - Per-URL status reporting: ok | partial | blocked | failed
 *  - Live status messages and structured failure records in the dataset
 */
import { Actor } from 'apify';
import { PlaywrightCrawler, createPlaywrightRouter, log } from 'crawlee';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

await Actor.init();

const input = (await Actor.getInput()) ?? {};

const rawUrls = Array.isArray(input.urls) ? input.urls : (Array.isArray(input.startUrls) ? input.startUrls : []);
const urls = rawUrls
    .map((u) => (typeof u === 'string' ? u.trim() : String(u?.url ?? '').trim()))
    .filter(Boolean);

if (!urls.length) {
    await Actor.exit('Input is missing "urls" - provide public LinkedIn profile (/in/...) or company (/company/...) URLs.');
}

const nonLinkedin = urls.filter((u) => !/linkedin\.com/i.test(u));
if (nonLinkedin.length) {
    log.warning(`${nonLinkedin.length} URL(s) are not linkedin.com - they will still be attempted: ${nonLinkedin.slice(0, 3).join(', ')}`);
}

const maxConcurrency = clamp(Math.floor(Number(input.maxConcurrency)) || 1, 1, 5);
const includeRawText = input.includeRawText === true;

/* ------------------------------------------------------------------ */
/* Proxy: residential IPs strongly recommended for LinkedIn.           */
/* ------------------------------------------------------------------ */
async function buildProxyConfiguration() {
    const preferred = input.proxyConfiguration
        ?? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] };
    try {
        const cfg = await Actor.createProxyConfiguration(preferred);
        if (cfg) return cfg;
    } catch (err) {
        log.warning(`Preferred proxy configuration failed: ${err.message}`);
    }
    try {
        const cfg = await Actor.createProxyConfiguration({ useApifyProxy: true });
        if (cfg) {
            log.warning('Falling back to default Apify Proxy groups (RESIDENTIAL strongly recommended for LinkedIn).');
            return cfg;
        }
    } catch { /* account without Apify Proxy */ }
    log.warning('Apify Proxy unavailable - connecting directly. LinkedIn blocks datacenter IPs quickly.');
    return undefined;
}

const proxyConfiguration = await buildProxyConfiguration();

let processed = 0;
async function updateStatus() {
    await Actor.setStatusMessage(`Processed ${processed}/${urls.length} URL(s)`).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Metrics, diagnostics and pay-per-event charging                     */
/* ------------------------------------------------------------------ */
const CHARGE_EVENT = 'PROFILE_SCRAPED';
const metrics = {
    startedAt: new Date().toISOString(),
    urls: urls.length,
    processed: 0,
    okCount: 0,
    partialCount: 0,
    blockedCount: 0,
    failedCount: 0,
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
        log.warning(`Sign-in wall screenshot saved as BLOCKED_SCREENSHOT_${blockShots} (${url})`);
    } catch { /* best effort */ }
}

/** Push one dataset item first (data safety), then attempt the PPE charge for `ok` results. */
async function pushItem(item) {
    try {
        await Actor.pushData(item);
    } catch (err) {
        log.error(`pushData rejected (dataset schema?): ${String(err?.message).slice(0, 300)}`);
        return;
    }
    if (item.status === 'ok') {
        metrics.okCount += 1;
        try {
            const res = await Actor.charge({ eventName: CHARGE_EVENT });
            if (res && typeof res.chargedCount === 'number') metrics.chargedEvents += res.chargedCount;
        } catch (err) {
            log.debug(`Charge skipped (${String(err?.message).slice(0, 120)})`);
        }
    } else if (item.status === 'partial') metrics.partialCount += 1;
    else if (item.status === 'blocked') metrics.blockedCount += 1;
    else if (item.status === 'failed') metrics.failedCount += 1;
}

/* ------------------------------------------------------------------ */
/* Browser-side extraction (serialized into the page - no closures!)   */
/* ------------------------------------------------------------------ */
const extractProfile = () => {
    const clean = (s) => { const t = s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); return t || null; };
    const out = { type: null, name: null, headline: null, location: null, about: null, website: null, followers: null, rawText: null };

    // Layer 1: JSON-LD structured data
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        let json;
        try { json = JSON.parse(script.textContent); } catch { continue; }
        const graphs = Array.isArray(json) ? json : (json && json['@graph'] ? json['@graph'] : [json]);
        for (const g of graphs) {
            if (!g || typeof g !== 'object') continue;
            const types = Array.isArray(g['@type']) ? g['@type'] : [g['@type']];
            const addr = g.address;
            const loc = typeof addr === 'string'
                ? addr
                : addr ? (addr.addressLocality || addr.addressRegion || addr.addressCountry) : null;
            if (types.includes('Person')) {
                out.type = out.type || 'person';
                out.name = out.name || clean(g.name);
                out.headline = out.headline || clean(g.jobTitle);
                out.about = out.about || clean(g.description);
                out.location = out.location || clean(loc);
                if (typeof g.url === 'string' && !/linkedin\.com/i.test(g.url)) out.website = out.website || g.url;
            } else if (types.includes('Organization')) {
                out.type = out.type || 'company';
                out.name = out.name || clean(g.name);
                out.about = out.about || clean(g.description);
                out.location = out.location || clean(loc);
                if (typeof g.url === 'string' && !/linkedin\.com/i.test(g.url)) out.website = out.website || g.url;
            }
        }
    }

    // Layer 2: OpenGraph meta tags
    const meta = (p) => {
        const m = document.querySelector(`meta[property="${p}"]`) || document.querySelector(`meta[name="${p}"]`);
        return m ? clean(m.getAttribute('content')) : null;
    };
    const stripLinkedInSuffix = (s) => (s ? s.replace(/\s*[|-]\s*LinkedIn\s*$/i, '') : s);
    const ogTitle = meta('og:title');
    if (ogTitle) {
        const parts = ogTitle.split(' - ').map((s) => s.trim()).filter(Boolean);
        out.name = out.name || stripLinkedInSuffix(parts[0] || null);
        if (!out.headline && parts.length > 1) out.headline = stripLinkedInSuffix(parts.slice(1).join(' - '));
    }
    if (!out.about) out.about = stripLinkedInSuffix(meta('og:description'));

    // Layer 3: visible DOM
    if (!out.name) out.name = clean(document.querySelector('h1')?.textContent);
    if (!out.headline) out.headline = clean(document.querySelector('.text-body-medium')?.textContent);

    const isCompanyUrl = window.location.pathname.includes('/company/');
    if (!out.type) out.type = isCompanyUrl ? 'company' : 'person';
    if (out.type === 'company' && !out.followers) {
        const f = [...document.querySelectorAll('span')]
            .map((s) => clean(s.textContent))
            .find((t) => t && /^[\d.,\s]+followers$/i.test(t));
        out.followers = f || null;
    }

    const mainText = clean(document.querySelector('main')?.innerText || document.body.innerText || '');
    out.rawText = mainText ? mainText.slice(0, 1000) : null;
    return out;
};

/* ------------------------------------------------------------------ */
/* Request handler                                                     */
/* ------------------------------------------------------------------ */
const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ page, request, session, log: l }) => {
    const url = request.url;
    const finalUrl = page.url();

    // Auth wall / login redirect => blocked: rotate session + IP and retry
    if (/authwall|\/login\/|\/checkpoint\/|\/uas\/login/i.test(finalUrl)) {
        l.warning(`LinkedIn served an auth wall for ${url} - retiring session and retrying with a new proxy IP.`);
        await saveBlockScreenshot(page, url);
        session?.retire();
        throw new Error('AUTHWALL: LinkedIn redirected to the login/auth wall');
    }

    await page.waitForTimeout(800 + Math.random() * 1200); // let the page settle

    // Dismiss the logged-out contextual sign-in modal when present
    try {
        const dismiss = page.locator('button[aria-label="Dismiss"], .contextual-sign-in-modal__button-dismiss, button[data-id="sign-in-form__dismiss"], .modal__dismiss').first();
        if (await dismiss.count()) {
            await dismiss.click({ timeout: 5000 });
            await page.waitForTimeout(1200);
        }
    } catch { /* modal handling is best-effort */ }

    const data = await page.evaluate(extractProfile);
    const pageTitle = await page.title().catch(() => '');

    // Detect sign-in walls served at the original URL (LinkedIn does this for logged-out visitors)
    const wallName = !!data.name && /^(sign up|sign in|join now|join linkedin|log ?in)$/i.test(data.name);
    const wallTitle = /LinkedIn Login|Sign Up \| LinkedIn|Join LinkedIn/i.test(pageTitle || '') && !data.headline && !data.about;
    if (wallName || wallTitle || /authwall|\/login\/|\/checkpoint\/|\/uas\/login/i.test(page.url())) {
        l.warning(`LinkedIn served a sign-in wall for ${url} (title: "${pageTitle}") - retiring session and retrying with a new proxy IP.`);
        await saveBlockScreenshot(page, url);
        session?.retire();
        throw new Error('AUTHWALL: LinkedIn served a sign-in/auth wall');
    }

    processed += 1;
    metrics.processed = processed;
    await updateStatus();

    const status = data.name ? 'ok' : 'partial';
    if (!data.name) l.warning(`No structured data extracted for ${url} (status: partial).`);

    await pushItem({
        url,
        finalUrl,
        type: data.type,
        status,
        name: data.name,
        headline: data.headline,
        location: data.location,
        about: data.about,
        website: data.website,
        followers: data.followers,
        ...(includeRawText ? { rawText: data.rawText } : {}),
        scrapedAt: new Date().toISOString(),
    });
});

/* ------------------------------------------------------------------ */
/* Crawler                                                             */
/* ------------------------------------------------------------------ */
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: router,
    maxConcurrency,
    maxRequestRetries: 5,
    retryOnBlocked: true,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: Math.max(5, maxConcurrency * 5),
        sessionOptions: { maxErrorScore: 2 },
    },
    browserPoolOptions: { useFingerprints: true },
    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
            await sleep(2000 + Math.random() * 4000); // human-like pacing, LinkedIn is sensitive
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }).catch(() => {});
        },
    ],
    failedRequestHandler: async ({ request, log: l }, error) => {
        const msg = String(error?.message ?? error);
        const blocked = msg.includes('AUTHWALL');
        l.error(`Giving up on ${request.url}: ${msg}`);
        processed += 1;
        metrics.processed = processed;
        await updateStatus();
        failedRequests.push({ url: request.url, status: blocked ? 'blocked' : 'failed', error: msg.slice(0, 300) });
        await pushItem({
            url: request.url,
            status: blocked ? 'blocked' : 'failed',
            error: msg.slice(0, 300),
            scrapedAt: new Date().toISOString(),
        });
    },
});

log.info(
    `LinkedIn Leads Collector starting: ${urls.length} URL(s), concurrency=${maxConcurrency}, `
    + `proxy=${proxyConfiguration ? 'Apify Proxy' : 'direct'}, rawText=${includeRawText}`,
);

try {
    await Actor.setStatusMessage(`Collecting ${urls.length} LinkedIn URL(s)...`);
    await crawler.run(urls);
    metrics.finishedAt = new Date().toISOString();
    await Actor.setValue('METRICS', metrics);
    if (failedRequests.length) await Actor.setValue('FAILED_REQUESTS', failedRequests);
    await Actor.setStatusMessage(
        `Finished: ${metrics.okCount} ok, ${metrics.partialCount} partial, ${metrics.blockedCount} blocked, ${metrics.failedCount} failed of ${urls.length} URL(s).`,
        { level: 'SUCCESS' },
    );
    await Actor.exit();
} catch (err) {
    log.exception(err, 'Actor run failed');
    metrics.finishedAt = new Date().toISOString();
    await Actor.setValue('METRICS', metrics).catch(() => {});
    await Actor.fail(`Run failed: ${err.message}`);
}
