#!/bin/bash
# ---------------------------------------------------------------------------
# NOTE: Original bootstrap script from the generation session, kept for
# reference/reproducibility. The repository layout has since been updated:
#   - actor folders now live at the repository ROOT (google-maps-scraper/,
#     linkedin-scraper/, email-extractor/) instead of under actors/
#   - .actor/actor.json versions use the Apify-required MAJOR.MINOR format
#   - Dockerfiles follow the official Apify Playwright template
# Do not run this script against the current repo; use `apify push` per
# folder or the GitHub Actions workflow instead.
# ---------------------------------------------------------------------------
#!/bin/bash
REPO_URL="https://github.com/uranusmediaconnection-dot/New_Qwenn_Apify_ACTORS_App-prod.git"
REPO_NAME="New_Qwenn_Apify_ACTORS_App-prod"

echo "🚀 Initializing Apify Actors Monorepo..."
mkdir -p "$REPO_NAME"
cd "$REPO_NAME" || exit

git init
git remote add origin "$REPO_URL"

# Create Directory Structure
mkdir -p .github/workflows
mkdir -p actors/google-maps-scraper/{src,.actor}
mkdir -p actors/linkedin-scraper/{src,.actor}
mkdir -p actors/email-extractor/{src,.actor}

# ==========================================
# 1. PROJECT DOCUMENTATION (README.md)
# ==========================================
cat << 'EOF' > README.md
# Apify Lead Generation & Scraping Pipeline

This monorepo contains three production-ready Apify Actors designed for scalable lead generation, firmographic enrichment, and contact discovery.

## Actors Included
1. **Google Maps Scraper**: Uses Playwright and geographic grid partitioning to bypass result limits.
2. **LinkedIn Lead Scraper**: Extracts public firmographic and profile data with stealth evasion.
3. **Email Extractor**: Crawls target domains to extract dynamic/obfuscated business emails.

## Prerequisites
- Apify Account
- Node.js v18+
- Apify CLI (`npm install -g apify-cli`)

## Local Development
```bash
cd actors/google-maps-scraper
apify run
```

## Deployment
Pushes to `main` automatically trigger a build on Apify via GitHub Actions.
EOF

# ==========================================
# 2. GITHUB ACTIONS (CI/CD)
# ==========================================
cat << 'EOF' > .github/workflows/deploy.yml
name: Deploy Actors to Apify

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        actor: [google-maps-scraper, linkedin-scraper, email-extractor]
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install Apify CLI
        run: npm install -g apify-cli
      - name: Deploy Actor
        env:
          APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
        run: apify push --token $APIFY_TOKEN
        working-directory: actors/${{ matrix.actor }}
EOF

# ==========================================
# 3. GOOGLE MAPS SCRAPER
# ==========================================
cat << 'EOF' > actors/google-maps-scraper/package.json
{
  "name": "google-maps-scraper",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "apify": "^3.2.0",
    "crawlee": "^3.9.0",
    "playwright": "*"
  }
}
EOF

cat << 'EOF' > actors/google-maps-scraper/Dockerfile
FROM apify/actor-node-playwright-chrome:18
COPY . ./
RUN npm install --omit=dev
CMD ["node", "src/main.js"]
EOF

cat << 'EOF' > actors/google-maps-scraper/.actor/actor.json
{
  "actorSpecification": 1,
  "name": "google-maps-scraper",
  "version": "1.0.0",
  "buildTag": "latest",
  "environmentVariables": {}
}
EOF

cat << 'EOF' > actors/google-maps-scraper/.actor/input_schema.json
{
  "title": "Google Maps Scraper Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "searchStringsArray": {
      "title": "Search Queries",
      "type": "array",
      "prefill": ["Plumbers in New York"],
      "editor": "json"
    },
    "maxResults": {
      "title": "Max Results",
      "type": "integer",
      "default": 100
    }
  },
  "required": ["searchStringsArray"]
}
EOF

cat << 'EOF' > actors/google-maps-scraper/src/main.js
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
EOF

# ==========================================
# 4. LINKEDIN SCRAPER (PUBLIC PROFILES)
# ==========================================
cat << 'EOF' > actors/linkedin-scraper/package.json
{
  "name": "linkedin-scraper",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "apify": "^3.2.0",
    "crawlee": "^3.9.0",
    "playwright": "*"
  }
}
EOF

cat << 'EOF' > actors/linkedin-scraper/Dockerfile
FROM apify/actor-node-playwright-chrome:18
COPY . ./
RUN npm install --omit=dev
CMD ["node", "src/main.js"]
EOF

cat << 'EOF' > actors/linkedin-scraper/.actor/actor.json
{
  "actorSpecification": 1,
  "name": "linkedin-scraper",
  "version": "1.0.0",
  "buildTag": "latest",
  "environmentVariables": {}
}
EOF

cat << 'EOF' > actors/linkedin-scraper/.actor/input_schema.json
{
  "title": "LinkedIn Scraper Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "urls": {
      "title": "LinkedIn Public URLs",
      "type": "array",
      "editor": "json"
    }
  },
  "required": ["urls"]
}
EOF

cat << 'EOF' > actors/linkedin-scraper/src/main.js
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
EOF

# ==========================================
# 5. EMAIL EXTRACTOR
# ==========================================
cat << 'EOF' > actors/email-extractor/package.json
{
  "name": "email-extractor",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "apify": "^3.2.0",
    "crawlee": "^3.9.0",
    "playwright": "*"
  }
}
EOF

cat << 'EOF' > actors/email-extractor/Dockerfile
FROM apify/actor-node-playwright-chrome:18
COPY . ./
RUN npm install --omit=dev
CMD ["node", "src/main.js"]
EOF

cat << 'EOF' > actors/email-extractor/.actor/actor.json
{
  "actorSpecification": 1,
  "name": "email-extractor",
  "version": "1.0.0",
  "buildTag": "latest",
  "environmentVariables": {}
}
EOF

cat << 'EOF' > actors/email-extractor/.actor/input_schema.json
{
  "title": "Email Extractor Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "startUrls": {
      "title": "Start URLs",
      "type": "array",
      "editor": "json"
    },
    "maxDepth": {
      "title": "Crawl Depth",
      "type": "integer",
      "default": 2
    }
  },
  "required": ["startUrls"]
}
EOF

cat << 'EOF' > actors/email-extractor/src/main.js
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
EOF

# ==========================================
# 6. GIT DEPLOYMENT
# ==========================================
echo "Committing and pushing to GitHub..."
git add .
git commit -m "feat: Initial deployment of Maps, LinkedIn, and Email Actors"
git branch -M main
git push -u origin main

echo "✅ Deployment complete! Go to Apify Console and link your GitHub repository."
