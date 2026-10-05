/**
 * Input compatibility layer.
 * Accepts this actor's own field names plus common aliases used by other
 * Google Maps actors (e.g. compass/crawler-google-places style inputs), so
 * users can switch between actors without reconfiguring.
 */
const firstArray = (...vals) => vals.find((v) => Array.isArray(v) && v.length) ?? [];

export function normalizeMapsInput(input = {}) {
    const searchStringsArray = firstArray(
        input.searchStringsArray,
        input.searchQueries,
        input.queries,
    );

    const placeUrls = firstArray(
        input.placeUrls,
        input.startUrls,
        input.urls,
    ).map((u) => (typeof u === 'string' ? u : String(u?.url ?? ''))).filter(Boolean);

    const maxResults =
        Number(input.maxResults ?? input.maxPlacesPerQuery ?? input.maxCrawledPlacesPerSearch ?? input.maxResultsPerQuery) || 50;

    const includePlaceDetails =
        (input.includePlaceDetails ?? input.scrapeDetails ?? input.scrapeDetailsAndContacts) !== false;

    const language = String(input.language ?? 'en').slice(0, 12);
    const maxConcurrency = Number(input.maxConcurrency) || 3;

    const proxyConfiguration =
        input.proxyConfiguration ??
        input.proxyConfig ??
        { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] };

    return {
        searchStringsArray,
        placeUrls,
        maxResults,
        includePlaceDetails,
        language,
        maxConcurrency,
        proxyConfiguration,
    };
}
