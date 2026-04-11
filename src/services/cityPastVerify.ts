import {
  dedupeEvents,
  filterConcertsForDisplay,
  normalizeForConcertDedup,
  perplexityRowToEvent,
  splitPastUpcoming,
  type ConcertData,
  type ConcertEvent,
} from './concertScraper';
import { fromStoredPastEvent, loadCachedPastForArtist, persistPastCacheForArtist } from './concertPastCache';
import { fetchLastPastConcertInCityViaPerplexity } from './perplexity';
import { isoDateLocalToday } from '../utils/dates';

function cityCore(s: string): string {
  return (s || '').split(',')[0].trim();
}

/**
 * Відомі синоніми міст (після normalizeForConcertDedup) → спільний ключ,
 * щоб «Варшава» / Warszawa / Warsaw рахувалися одним містом.
 */
const CITY_BUCKET_ALIASES: Record<string, string> = {
  warsaw: 'pl_waw',
  warszawa: 'pl_waw',
  varshava: 'pl_waw',
  gdansk: 'pl_gdn',
  wroclaw: 'pl_wro',
  vratslav: 'pl_wro',
  krakow: 'pl_krk',
  kyiv: 'ua_iev',
  kiev: 'ua_iev',
};

export function cityBucketForMatch(label: string): string {
  const n = normalizeForConcertDedup(cityCore(label));
  return CITY_BUCKET_ALIASES[n] || n;
}

/** Чи є вже минула подія (≤ сьогодні) в цьому місті за даними таблиці + кешу. */
export function pastHasVerifiedEventInCity(past: ConcertEvent[], userCity: string): boolean {
  const want = cityBucketForMatch(userCity);
  const today = isoDateLocalToday();
  return past.some((e) => {
    if (!e.date || e.date > today) return false;
    const got = cityBucketForMatch(e.city);
    if (want && got && want === got) return true;
    const gw = normalizeForConcertDedup(cityCore(e.city));
    const uw = normalizeForConcertDedup(cityCore(userCity));
    if (gw && uw && (gw === uw || gw.includes(uw) || uw.includes(gw))) return true;
    return false;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Після вибору міст: для кожного міста перевіряємо, чи є в злитих даних (UI + кеш) минулий концерт артиста.
 * Якщо ні — один запит Perplexity на останній шоу в місті; результат зливається в кеш і в таблицю.
 */
export async function verifyLastPastConcertPerSelectedCity(params: {
  artist: string;
  cities: string[];
  concertData: ConcertData | null;
  onProgress?: (msg: string) => void;
  onTokens?: (prompt: number, completion: number) => void;
}): Promise<{
  concertData: ConcertData;
  fetchedForCities: string[];
  skippedCities: string[];
}> {
  const { artist, cities, onProgress, onTokens } = params;
  const a = artist.trim();
  const baseData: ConcertData =
    params.concertData ??
    ({
      artist: a,
      past: [],
      upcoming: [],
      sources_checked: [],
      errors: [],
    } as ConcertData);

  const { stored } = await loadCachedPastForArtist(a);
  const cachedEvents = stored.map(fromStoredPastEvent);
  const merged = dedupeEvents([...baseData.past, ...baseData.upcoming, ...cachedEvents]);
  const { past } = splitPastUpcoming(merged);

  const skippedCities: string[] = [];
  const fetchedForCities: string[] = [];
  const newEvents: ConcertEvent[] = [];

  for (const rawCity of cities) {
    const city = rawCity.trim();
    if (!city) continue;

    if (pastHasVerifiedEventInCity(past, city)) {
      skippedCities.push(city);
      continue;
    }

    onProgress?.(`Крок 2: останній концерт у «${city}» — перевірка джерел…`);
    const { row, error } = await fetchLastPastConcertInCityViaPerplexity(a, city, onTokens);
    await sleep(2000);

    if (row) {
      const ev = perplexityRowToEvent(row);
      const tagged: ConcertEvent = {
        ...ev,
        source: 'Perplexity · Sonar (крок 2 · місто)',
      };
      newEvents.push(tagged);
      past.push(tagged);
      past.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      fetchedForCities.push(city);
    } else if (error) {
      console.warn('[cityPastVerify]', city, error);
    }
  }

  const baseAll = dedupeEvents([
    ...baseData.past,
    ...baseData.upcoming,
    ...cachedEvents,
    ...newEvents,
  ]);
  const { past: fullPast, upcoming } = splitPastUpcoming(baseAll);

  await persistPastCacheForArtist(a, fullPast);

  const mergedData: ConcertData = {
    ...baseData,
    past: fullPast,
    upcoming,
  };
  const shown = filterConcertsForDisplay(mergedData);

  if (newEvents.length > 0) {
    const note = `Крок 2: додано ${newEvents.length} ряд(ок) минулих концертів по обраних містах (узгоджено з кешем).`;
    shown.errors = [...(shown.errors || []), note];
  }

  return { concertData: shown, fetchedForCities, skippedCities };
}
