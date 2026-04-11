/**
 * CLI: Perplexity (past) + Gemini (upcoming) для одного артиста.
 * Потрібен scrapling на http://127.0.0.1:8765 і ключі в env сервера.
 */
const API = 'http://127.0.0.1:8765';
const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const u =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  if (u.startsWith('/api/')) return origFetch(API + u, init);
  return origFetch(input as RequestInfo, init);
}) as typeof fetch;

const artist = process.argv[2]?.trim() || 'Loboda';

const { fetchPastConcertsViaPerplexityForTable } = await import(
  '../src/services/perplexity.ts'
);
const { fetchConcertsViaGeminiGoogleSearch } = await import('../src/services/gemini.ts');

console.log('=== Test concerts pipeline ===');
console.log('Artist:', artist);
console.log('API base:', API);
console.log('');

const t0 = Date.now();
console.log('[1/2] Perplexity past (by half-month, sequential)...');
const pplx = await fetchPastConcertsViaPerplexityForTable(artist);
console.log(
  `[1/2] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — past rows: ${pplx.past.length}`
);
if (pplx.error) console.log('[1/2] Perplexity errors:', pplx.error.slice(0, 500));

const t1 = Date.now();
console.log('[2/2] Gemini upcoming (3 year windows)...');
const gem = await fetchConcertsViaGeminiGoogleSearch(artist);
console.log(
  `[2/2] Done in ${((Date.now() - t1) / 1000).toFixed(1)}s — upcoming rows: ${gem.upcoming.length}`
);

console.log('');
console.log('=== Summary ===');
console.log('Past (sample dates):', [...new Set(pplx.past.map((r) => r.date))].sort().slice(0, 15).join(', '), '...');
console.log('Upcoming (sample):', gem.upcoming.slice(0, 8).map((r) => `${r.date} ${r.city} ${r.venue}`.slice(0, 80)));

const total = pplx.past.length + gem.upcoming.length;
console.log(`Total rows: ${total} (past ${pplx.past.length} + upcoming ${gem.upcoming.length})`);
console.log(`Wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
