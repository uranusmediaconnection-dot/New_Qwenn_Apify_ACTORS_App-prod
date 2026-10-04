import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();
const input = await Actor.getInput();
const proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] });

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 1, // Keep low to avoid bans
    async requestHandler({ page, log, pushData, request }) {
        log.info(`Scraping ${request.url}`);
        await page.goto(request.url, { waitUntil: 'networkidle' });

        const data = await page.evaluate(() => {
            const jsonLd = document.querySelector('script[type="application/ld+json"]');
            let profile = {};
            if (jsonLd) profile = JSON.parse(jsonLd.textContent);
            
            return {
                url: window.location.href,
                name: profile.name || document.querySelector('h1')?.textContent,
                headline: profile.jobTitle || document.querySelector('.text-body-medium')?.textContent,
                location: profile.address?.addressLocality,
                raw_html_snippet: document.querySelector('main')?.innerText?.slice(0, 500)
            };
        });
        await pushData(data);
    },
});

await crawler.run(input.urls);
await Actor.exit();
