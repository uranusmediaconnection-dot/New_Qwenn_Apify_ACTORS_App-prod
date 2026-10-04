import { Actor } from 'apify';
import { PlaywrightCrawler, createPlaywrightRouter } from 'crawlee';

await Actor.init();
const input = await Actor.getInput();
const proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] });
const foundEmails = new Set();

const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ enqueueLinks, request, log }) => {
    log.info(`Crawling ${request.url}`);
    await enqueueLinks({
        globs: [`${new URL(request.url).origin}/**`],
        label: 'PAGE'
    });
});

router.addHandler('PAGE', async ({ page, request, pushData, log }) => {
    const content = await page.content();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = content.match(emailRegex) || [];
    
    for (const email of matches) {
        if (!foundEmails.has(email) && !email.includes('@example.com')) {
            foundEmails.add(email);
            await pushData({ url: request.url, email });
        }
    }
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    requestHandler: router,
    maxConcurrency: 5,
    maxRequestsPerCrawl: 100,
});

await crawler.run(input.startUrls);
await Actor.exit();
