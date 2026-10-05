/**
 * Business Email Extractor
 * ------------------------
 * Crawls target websites and extracts business email addresses, including ones that
 * are JavaScript-rendered, HTML-entity encoded (&#64;) or obfuscated ("user [at]
 * domain [dot] com"). Depth-aware same-origin crawling with contact-page prioritization.
 *
 * Production features:
 *  - Renders pages with Playwright, then waits briefly for late JS injection
 *  - Decodes HTML entities + bracket obfuscation before matching
 *  - Respects maxDepth (default 2) and maxPages (default 100) budgets
 *  - Deduplicates globally; filters image/asset false positives and example.com
 *  - Confidence scoring (mailto link > plain text > de-obfuscated)
 *  - Pay-per-event hook: EMAIL_FOUND charged for every unique email
 *  - METRICS / FAILED_REQUESTS diagnostics in the key-value store
 */
import { Actor } from 'apify';
import { PlaywrightCrawler, createPlaywrightRouter, log } from 'crawlee';

const CHARGE_EVENT = 'EMAIL_FOUND';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

await Actor.init();

const input = (await Actor.getInput()) ?? {};

const rawStartUrls = Array.isArray(input.startUrls) ? input.startUrls : [];
const startUrls = rawStartUrls
    .map((u) => (typeof u === 'string' ? u.trim() : String(u?.url ?? '').trim()))
    .filter(Boolean);

if (!startUrls.length) {
    await Actor.exit('Input is missing "startUrls" - provide at least one website to crawl, e.g. [{ "url": "https://example-company.com" }].');
}

const maxDepth = clamp(Math.floor(Number(input.maxDepth)) || 2, 1, 5);
const maxPages = clamp(Math.floor(Number(input.maxPages)) || 100, 1, 1000);
const maxConcurrency = clamp(Math.floor(Number(input.maxConcurrency)) || 5, 1, 20);
const excludeRoleEmails = input.excludeRoleEmails === true;

const ROLE_PREFIXES = new Set(['info', 'sales', 'support', 'contact', 'admin', 'office', 'hello', 'help', 'service', 'team', 'hr', 'jobs', 'careers', 'marketing', 'press', 'media', 'noreply', 'no-reply', 'donotreply', 'webmaster', 'postmaster', 'abuse', 'privacy', 'legal', 'billing', 'accounts']);

/* ------------------------------------------------------------------ */
/* Proxy                                                               */
/* ------------------------------------------------------------------ */
async function buildProxyConfiguration() {
    try {
        const cfg = await Actor.createProxyConfiguration(
            input.proxyConfiguration ?? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        );
        if (cfg) return cfg;
    } catch (err) {
        log.warning(`Preferred proxy configuration failed: ${err.message}`);
    }
    try {
        const cfg = await Actor.createProxyConfiguration({ useApifyProxy: true });
        if (cfg) { log.warning('Falling back to default Apify Proxy groups.'); return cfg; }
    } catch { /* no Apify Proxy */ }
    log.warning('Apify Proxy unavailable - connecting directly.');
    return undefined;
}
const proxyConfiguration = await buildProxyConfiguration();

/* ------------------------------------------------------------------ */
/* State, metrics and charging                                         */
/* ------------------------------------------------------------------ */
const foundEmails = new Set();
const metrics = {
    startedAt: new Date().toISOString(),
    startUrls: startUrls.length,
    pagesCrawled: 0,
    emailsFound: 0,
    chargedEvents: 0,
    failedCount: 0,
    finishedAt: null,
};
const failedRequests = [];

/** Decode HTML entities and bracket obfuscation used to hide emails from bots. */
function decodeObfuscation(text) {
    return String(text)
        // numeric + named entities for the characters that matter
        .replace(/&#0*64;?/g, '@')
        .replace(/&#x0*40;?/gi, '@')
        .replace(/&commat;/gi, '@')
        .replace(/&#0*46;?/g, '.')
        .replace(/&#x0*2e;?/gi, '.')
        .replace(/&period;/gi, '.')
        .replace(/&amp;/gi, '&')
        // [at] (at) {at} <at> and [dot] (dot) {dot} <dot>
        .replace(/[\s]*[\[\(\{<]\s*at\s*[\]\)\}>][\s]*/gi, '@')
        .replace(/[\s]*[\[\(\{<]\s*dot\s*[\]\)\}>][\s]*/gi, '.');
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|woff2?|ttf|eot|mp4|webm|avif)(\?|$)/i;

function isPlausible(email) {
    const lower = email.toLowerCase();
    if (lower.includes('@example.com') || lower.includes('@sentry') || lower.includes('@2x')) return false;
    if (ASSET_EXT.test(lower)) return false;
    if (/(wixpress|sentry-next|godaddy|registrar-servers)\.com$/.test(lower)) return false;
    const local = lower.split('@')[0];
    if (!local || local.length > 64) return false;
    if (excludeRoleEmails && ROLE_PREFIXES.has(local)) return false;
    return true;
}

function confidence(email, context) {
    if (context.mailto.has(email)) return 1.0;      // explicit mailto: link
    if (context.raw.has(email)) return 0.8;          // plain visible email
    return 0.6;                                      // recovered from obfuscation/encoding
}

async function pushEmail(email, sourceUrl, depth, conf) {
    const item = {
        email,
        domain: email.split('@')[1] ?? null,
        sourceUrl,
        depth,
        confidence: conf,
        scrapedAt: new Date().toISOString(),
    };
    try {
        await Actor.pushData(item);
    } catch (err) {
        log.error(`pushData rejected: ${String(err?.message).slice(0, 200)}`);
        return;
    }
    metrics.emailsFound += 1;
    try {
        const res = await Actor.charge({ eventName: CHARGE_EVENT });
        if (res && typeof res.chargedCount === 'number') metrics.chargedEvents += res.chargedCount;
    } catch (err) {
        log.debug(`Charge skipped (${String(err?.message).slice(0, 120)})`);
    }
}

/** Extract emails from one page's HTML + rendered text. Returns count found. */
async function harvest(page, request, depth) {
    const html = await page.content().catch(() => '');
    const renderedText = await page.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
    const mailto = new Set((html.match(/mailto:([^"'?>\s]+)/gi) || []).map((m) => decodeObfuscation(m.replace(/^mailto:/i, '')).toLowerCase().replace(/\.$/, '')));
    const decoded = `${decodeObfuscation(html)}\n${decodeObfuscation(renderedText)}`;
    const raw = new Set([...(html.match(EMAIL_RE) || []), ...(renderedText.match(EMAIL_RE) || [])].map((m) => m.toLowerCase().replace(/\.$/, '')));
    const context = { mailto, raw };
    const candidates = new Set();
    for (const source of [html, decoded, renderedText]) {
        for (const m of source.match(EMAIL_RE) || []) candidates.add(m.toLowerCase().replace(/\.$/, ''));
    }
    let found = 0;
    for (const email of candidates) {
        if (foundEmails.has(email) || !isPlausible(email)) continue;
        foundEmails.add(email);
        await pushEmail(email, request.url, depth, confidence(email, context));
        found += 1;
    }
    if (found) {
        await Actor.setStatusMessage(`Found ${metrics.emailsFound} unique email(s) so far (${metrics.pagesCrawled} pages crawled)`).catch(() => {});
    }
    return found;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */
const router = createPlaywrightRouter();

async function enqueueChildren({ enqueueLinks, request, depth }) {
    if (depth >= maxDepth) return;
    const origin = new URL(request.url).origin;
    const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withDepth = (req) => {
        req.userData = { ...(req.userData ?? {}), depth: depth + 1 };
        return req;
    };
    try {
        // Phase 1: contact-ish pages first (forefront of the queue)
        await enqueueLinks({
            regexps: [new RegExp(`^${escapedOrigin}/.*(contact|about|team|imprint|impressum|support|company|people|partners)`, 'i')],
            label: 'PAGE',
            forefront: true,
            transformRequestFunction: withDepth,
        });
        // Phase 2: everything else on the same origin (duplicates are skipped automatically)
        await enqueueLinks({
            globs: [`${origin}/**`],
            label: 'PAGE',
            transformRequestFunction: withDepth,
        });
    } catch (err) {
        log.debug(`enqueueLinks: ${err.message}`);
    }
}

router.addDefaultHandler(async (ctx) => {
    const { page, request, log: l } = ctx;
    metrics.pagesCrawled += 1;
    l.info(`Crawling start URL ${request.url}`);
    // give late JS email injection a moment
    await page.waitForFunction(
        () => /[\w.+-]+@[\w-]+\.[a-z]{2,}|\[at\]|\(at\)|&#0*64/i.test((document.body && document.body.innerText) || document.documentElement.innerHTML || ''),
        null,
        { timeout: 4000 },
    ).catch(() => {});
    await harvest(page, request, 0);
    await enqueueChildren({ ...ctx, depth: 0 });
});

router.addHandler('PAGE', async (ctx) => {
    const { page, request, log: l } = ctx;
    const depth = Number(request.userData?.depth) || 1;
    metrics.pagesCrawled += 1;
    l.debug(`Crawling ${request.url} (depth ${depth})`);
    await sleep(200 + Math.random() * 600);
    await page.waitForFunction(
        () => /[\w.+-]+@[\w-]+\.[a-z]{2,}|\[at\]|\(at\)|&#0*64/i.test((document.body && document.body.innerText) || document.documentElement.innerHTML || ''),
        null,
        { timeout: 3000 },
    ).catch(() => {});
    await harvest(page, request, depth);
    await enqueueChildren({ ...ctx, depth });
});

/* ------------------------------------------------------------------ */
/* Crawler                                                             */
/* ------------------------------------------------------------------ */
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: router,
    maxConcurrency,
    maxRequestsPerCrawl: maxPages,
    maxRequestRetries: 3,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 150,
    useSessionPool: true,
    sessionPoolOptions: { maxPoolSize: Math.max(5, maxConcurrency * 2), sessionOptions: { maxErrorScore: 3 } },
    retryOnBlocked: true,
    browserPoolOptions: { useFingerprints: true },
    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
            await sleep(500 + Math.random() * 1000);
        },
    ],
    failedRequestHandler: async ({ request, log: l }, error) => {
        l.error(`Request failed after all retries: ${request.url} - ${error?.message}`);
        metrics.failedCount += 1;
        failedRequests.push({ url: request.url, error: String(error?.message ?? error).slice(0, 300) });
    },
});

log.info(
    `Business Email Extractor starting: ${startUrls.length} start URL(s), maxDepth=${maxDepth}, `
    + `maxPages=${maxPages}, concurrency=${maxConcurrency}, proxy=${proxyConfiguration ? 'Apify Proxy' : 'direct'}`,
);

try {
    await Actor.setStatusMessage(`Crawling ${startUrls.length} website(s) for emails...`);
    await crawler.run(startUrls);
    metrics.finishedAt = new Date().toISOString();
    await Actor.setValue('METRICS', metrics);
    if (failedRequests.length) await Actor.setValue('FAILED_REQUESTS', failedRequests);
    await Actor.setStatusMessage(
        `Finished: ${metrics.emailsFound} unique email(s) from ${metrics.pagesCrawled} page(s).`,
        { level: 'SUCCESS' },
    );
    await Actor.exit();
} catch (err) {
    log.exception(err, 'Actor run failed');
    metrics.finishedAt = new Date().toISOString();
    await Actor.setValue('METRICS', metrics).catch(() => {});
    await Actor.fail(`Run failed: ${err.message}`);
}
