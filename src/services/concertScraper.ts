import { fetchConcertsViaGeminiGoogleSearch, type GeminiConcertRow } from './gemini';

export interface ConcertEvent {
  date: string | null;
  city: string;
  country: string;
  venue: string;
  url: string;
  source: string;
  days_ago: number | null;
  days_until: number | null;
}

export interface ConcertData {
  artist: string;
  past: ConcertEvent[];
  upcoming: ConcertEvent[];
  sources_checked: string[];
  errors: string[];
}

const MIN_EVENTS_BEFORE_GEMINI = 5;
/** Якщо найновіша дата з парсерів старіша за N днів (і немає майбутніх дат) — додатково тягнемо Gemini (свіжі тури часто ще не в setlist.fm). */
const STALE_SCRAPER_DAYS = 90;
/** У таблиці показуємо лише події з цієї дати (включно); старіші залишаються в даних парсера для логіки Gemini, потім відсікаються. */
const DISPLAY_FROM_ISO_DATE = '2024-01-01';

/** Експортовано для unit-тестів. */
export function filterConcertsForDisplay(data: ConcertData): ConcertData {
  const min = DISPLAY_FROM_ISO_DATE;
  const past = (data.past || []).filter((e) => Boolean(e.date && e.date >= min));
  const upcoming = (data.upcoming || []).filter((e) => Boolean(e.date && e.date >= min));
  return { ...data, past, upcoming };
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function computeDaysFromToday(iso: string | null): { ago: number | null; until: number | null } {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { ago: null, until: null };
  const t = new Date(iso + 'T12:00:00').getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now.getTime() - t) / 86400000);
  if (diffDays >= 0) return { ago: diffDays, until: null };
  return { ago: null, until: -diffDays };
}

function geminiRowToEvent(row: GeminiConcertRow): ConcertEvent {
  const { ago, until } = computeDaysFromToday(row.date);
  return {
    date: row.date,
    city: row.city,
    country: row.country,
    venue: row.venue,
    url: row.url,
    source: 'Gemini · Google Search',
    days_ago: ago,
    days_until: until,
  };
}

function eventDedupKey(e: ConcertEvent): string {
  return `${e.date || ''}|${e.city.toLowerCase()}|${e.venue.toLowerCase().slice(0, 40)}|${e.url.slice(0, 80)}`;
}

/** Експортовано для unit-тестів. */
export function dedupeEvents(events: ConcertEvent[]): ConcertEvent[] {
  const seen = new Set<string>();
  const out: ConcertEvent[] = [];
  for (const e of events) {
    const k = eventDedupKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function newestIsoDateInPayload(data: ConcertData): string | null {
  let best = '';
  for (const e of [...(data.past || []), ...(data.upcoming || [])]) {
    if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date > best) best = e.date;
  }
  return best || null;
}

/** true якщо немає майбутніх дат у відповіді й остання минула дата занадто давня */
function scraperLooksStale(data: ConcertData): boolean {
  const hasUpcoming = (data.upcoming || []).some((e) => e.date && e.date > todayIso());
  if (hasUpcoming) return false;
  const best = newestIsoDateInPayload(data);
  if (!best) return true;
  const today = todayIso();
  if (best > today) return false;
  const bt = new Date(best + 'T12:00:00').getTime();
  const tt = new Date(today + 'T12:00:00').getTime();
  const daysBehind = Math.floor((tt - bt) / 86400000);
  return daysBehind > STALE_SCRAPER_DAYS;
}

function splitPastUpcoming(events: ConcertEvent[]): {
  past: ConcertEvent[];
  upcoming: ConcertEvent[];
} {
  const t = todayIso();
  const past: ConcertEvent[] = [];
  const upcoming: ConcertEvent[] = [];
  for (const e of events) {
    if (!e.date) {
      past.push(e);
      continue;
    }
    if (e.date <= t) past.push(e);
    else upcoming.push(e);
  }
  past.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { past, upcoming };
}

export async function fetchConcerts(artist: string): Promise<ConcertData> {
  let data: ConcertData;

  try {
    const res = await fetch('/api/concerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Scraper ${res.status}: ${text}`);
    }

    data = await res.json();
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('NetworkError')
    ) {
      data = {
        artist,
        past: [],
        upcoming: [],
        sources_checked: [],
        errors: ['Скрапер недоступний. Задеплойте сервер (Railway) або npm run server локально.'],
      };
    } else {
      throw err;
    }
  }

  const scrapedTotal = (data.past?.length || 0) + (data.upcoming?.length || 0);
  const sources = [...(data.sources_checked || [])];
  const errors = [...(data.errors || [])];

  const needGeminiSparse = scrapedTotal < MIN_EVENTS_BEFORE_GEMINI;
  const needGeminiStale = scraperLooksStale(data);

  if (needGeminiSparse || needGeminiStale) {
    let gemEvents: ConcertEvent[] = [];
    let gemError = '';
    try {
      console.log(
        '[concertScraper] Gemini supplement:',
        needGeminiSparse ? 'sparse' : '',
        needGeminiStale ? 'stale_dates' : '',
        'scraperTotal=',
        scrapedTotal
      );
      const gem = await fetchConcertsViaGeminiGoogleSearch(artist.trim());
      gemEvents = [...gem.past, ...gem.upcoming].map(geminiRowToEvent);
      console.log('[concertScraper] Gemini returned', gemEvents.length, 'events');
    } catch (e: any) {
      gemError = e?.message || String(e);
      console.error('[concertScraper] Gemini fallback error:', gemError);
    }

    const merged = dedupeEvents([...(data.past || []), ...(data.upcoming || []), ...gemEvents]);
    const { past, upcoming } = splitPastUpcoming(merged);

    if (!sources.includes('Gemini · Google Search')) {
      sources.push('Gemini · Google Search');
    }

    if (gemEvents.length > 0) {
      if (needGeminiSparse) {
        errors.push(
          'Мало даних з парсерів — додано події через Gemini + Google Search (site:setlist.fm, bandsintown, songkick).'
        );
      } else {
        errors.push(
          'Останні концерти в парсерах застарілі або без майбутніх дат — додано свіжіші дати через Gemini + Google Search.'
        );
      }
    } else if (gemError) {
      errors.push(`Gemini Google Search: ${gemError.slice(0, 200)}`);
    } else if (scrapedTotal === 0) {
      errors.push(
        'Парсер і Gemini не повернули структуровані події — перевірте написання імені артиста або спробуйте англійську назву (наприклад Boombox).'
      );
    }

    const mergedData: ConcertData = {
      artist: data.artist || artist,
      past,
      upcoming,
      sources_checked: sources,
      errors,
    };
    const shown = filterConcertsForDisplay(mergedData);
    const totalBefore = past.length + upcoming.length;
    if (shown.past.length + shown.upcoming.length === 0 && totalBefore > 0) {
      shown.errors.push(
        'Усі знайдені концерти раніше за 2024 рік; у таблиці показуються лише події з 01.01.2024. Спробуйте іншу назву або перевірте джерела.'
      );
    }
    return shown;
  }

  const out = filterConcertsForDisplay({
    ...data,
    sources_checked: sources,
    errors,
  });
  const rawTotal = (data.past?.length || 0) + (data.upcoming?.length || 0);
  if (out.past.length + out.upcoming.length === 0 && rawTotal > 0) {
    out.errors.push(
      'Усі знайдені концерти раніше за 2024 рік; у таблиці показуються лише події з 01.01.2024.'
    );
  }
  return out;
}
