import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();
const input = await Actor.getInput();
const proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] });

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 3,
    async requestHandler({ request, page, log, pushData }) {
        const { query } = request.userData;
        log.info(`Searching Maps for: ${query}`);
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
        
        // Auto-scroll to load more results
        await page.evaluate(async () => {
            const scrollable = document.querySelector('div[role="feed"]');
            if(scrollable) {
                for(let i=0; i<5; i++) {
                    scrollable.scrollTop = scrollable.scrollHeight;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        });

        const places = await page.evaluate(() => {
            const results = [];
            document.querySelectorAll('div.Nv2PK').forEach(el => {
                results.push({
                    name: el.querySelector('div.qBF1Pd')?.textContent,
                    category: el.querySelector('div.W4Efsd')?.textContent,
                    address: el.querySelector('div.W4Efsd:nth-of-type(3)')?.textContent,
                    website: el.querySelector('a.luhxo')?.href
                });
            });
            return results;
        });

        await pushData(places);
    },
    failedRequestHandler({ request, log }) {
        log.error(`Request ${request.url} failed too many times.`);
    },
});

const requests = input.searchStringsArray.map(q => ({ url: 'https://maps.google.com', userData: { query: q } }));
await crawler.run(requests);
await Actor.exit();
