import unidecode from 'unidecode';
import { fetchConcertsViaGeminiGoogleSearch, type GeminiConcertRow } from './gemini';
import { fetchPastConcertsViaPerplexityForTable, type PerplexityPastConcertRow } from './perplexity';
import { concertArchiveStartIsoDate, isoDateLocalToday } from '../utils/dates';

export interface ConcertEvent {
  date: string | null;
  city: string;
  country: string;
  venue: string;
  url: string;
  source: string;
  /** Текст ціни з джерела (Ticketmaster priceRanges, worldafisha «Билеты от …»), якщо є */
  price_label?: string | null;
  /** З Gemini: completed | confirmed | announced | on_sale | … */
  event_status?: string | null;
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

/** Фільтр для таблиці: події з дати початку архіву (включно), узгоджено з Gemini / Perplexity. Експортовано для тестів. */
export function filterConcertsForDisplay(data: ConcertData): ConcertData {
  const min = concertArchiveStartIsoDate();
  const past = (data.past || []).filter((e) => Boolean(e.date && e.date >= min));
  const upcoming = (data.upcoming || []).filter((e) => Boolean(e.date && e.date >= min));
  return { ...data, past, upcoming };
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

export function normalizeForConcertDedup(s: string): string {
  return unidecode(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 56);
}

/** Перша частина міста до коми — «Алматы, Казахстан» і «Almaty» збігаються після unidecode. */
function cityCore(city: string): string {
  return (city || '').split(',')[0].trim();
}

function locationBucket(e: ConcertEvent): string {
  return normalizeForConcertDedup(cityCore(e.city));
}

function venueBucket(e: ConcertEvent): string {
  return normalizeForConcertDedup(e.venue || '');
}

function concertRichness(e: ConcertEvent): number {
  let s = 0;
  if ((e.venue || '').trim()) s += 3;
  if ((e.price_label || '').trim()) s += 3;
  if ((e.country || '').trim()) s += 1;
  if ((e.city || '').trim()) s += 1;
  if (!e.source.includes('Gemini')) s += 2;
  if ((e.url || '').trim()) s += 1;
  if ((e.event_status || '').trim()) s += 1;
  if (e.source.includes('Perplexity')) s -= 1;
  return s;
}

function mergeConcertDuplicates(a: ConcertEvent, b: ConcertEvent): ConcertEvent {
  const [win, lose] = concertRichness(a) >= concertRichness(b) ? [a, b] : [b, a];
  return {
    ...win,
    url: win.url || lose.url,
    venue: win.venue || lose.venue,
    country: win.country || lose.country,
    city:
      (win.city || '').length >= (lose.city || '').length ? win.city : lose.city,
    price_label: win.price_label || lose.price_label,
    event_status: (win.event_status || lose.event_status || '').trim() || null,
    source:
      win.source.includes('Gemini') && !lose.source.includes('Gemini')
        ? lose.source
        : win.source.includes('Perplexity') && !lose.source.includes('Perplexity')
          ? lose.source
          : win.source,
  };
}

function perplexityRowToEvent(row: PerplexityPastConcertRow): ConcertEvent {
  const { ago, until } = computeDaysFromToday(row.date);
  const pl = row.price_label?.trim();
  const st = row.event_status?.trim();
  return {
    date: row.date,
    city: row.city,
    country: row.country,
    venue: row.venue,
    url: row.url,
    source: 'Perplexity · Sonar',
    price_label: pl || null,
    event_status: st || 'completed',
    days_ago: ago,
    days_until: until,
  };
}

function geminiRowToEvent(row: GeminiConcertRow): ConcertEvent {
  const { ago, until } = computeDaysFromToday(row.date);
  const pl = row.price_label?.trim();
  const st = row.event_status?.trim();
  return {
    date: row.date,
    city: row.city,
    country: row.country,
    venue: row.venue,
    url: row.url,
    source: 'Gemini · Google Search',
    price_label: pl || null,
    event_status: st || null,
    days_ago: ago,
    days_until: until,
  };
}

/** Ключ без URL — інакше та сама подія з worldafisha та Gemini не зливається. */
export function eventDedupKey(e: ConcertEvent): string {
  return `${e.date || ''}|${locationBucket(e)}|${venueBucket(e)}`;
}

function dedupeLooseSameDayCity(events: ConcertEvent[]): ConcertEvent[] {
  const out: ConcertEvent[] = [];
  for (const e of events) {
    let absorbed = false;
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      if ((e.date || '') !== (o.date || '')) continue;
      if (locationBucket(e) !== locationBucket(o)) continue;
      const ve = venueBucket(e);
      const vo = venueBucket(o);
      if (ve && vo && ve !== vo) continue;
      out[i] = mergeConcertDuplicates(o, e);
      absorbed = true;
      break;
    }
    if (!absorbed) out.push({ ...e });
  }
  return out;
}

/** Експортовано для unit-тестів. */
export function dedupeEvents(events: ConcertEvent[]): ConcertEvent[] {
  const map = new Map<string, ConcertEvent>();
  const order: string[] = [];
  for (const e of events) {
    const k = eventDedupKey(e);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...e });
      order.push(k);
    } else {
      map.set(k, mergeConcertDuplicates(prev, e));
    }
  }
  const merged = order.map((k) => map.get(k)!);
  return dedupeLooseSameDayCity(merged);
}

function splitPastUpcoming(events: ConcertEvent[]): {
  past: ConcertEvent[];
  upcoming: ConcertEvent[];
} {
  const t = isoDateLocalToday();
  const past: ConcertEvent[] = [];
  const upcoming: ConcertEvent[] = [];
  for (const e of events) {
    const { ago, until } = computeDaysFromToday(e.date);
    const row: ConcertEvent = { ...e, days_ago: ago, days_until: until };
    if (!e.date) {
      past.push(row);
      continue;
    }
    if (e.date <= t) past.push(row);
    else upcoming.push(row);
  }
  past.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { past, upcoming };
}

export async function fetchConcerts(artist: string): Promise<ConcertData> {
  /** Без першого етапу HTML/скрапінгу: лише Perplexity (минуле) + Gemini (майбутнє). */
  const data: ConcertData = {
    artist,
    past: [],
    upcoming: [],
    sources_checked: [],
    errors: [],
  };

  const sources = [...(data.sources_checked || [])];
  const errors = [...(data.errors || [])];

  console.log('[concertScraper] AI-only: Perplexity (past by month) + Gemini (upcoming by year windows)');

  const [gemOutcome, pplxOutcome] = await Promise.all([
    (async () => {
      try {
        const gem = await fetchConcertsViaGeminiGoogleSearch(artist.trim());
        const gemEvents = gem.upcoming.map(geminiRowToEvent);
        console.log(
          '[concertScraper] Gemini returned',
          0,
          'past +',
          gem.upcoming.length,
          'upcoming (upcoming-only mode)'
        );
        return { gemEvents, gemError: '' as string };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[concertScraper] Gemini error:', msg);
        return { gemEvents: [] as ConcertEvent[], gemError: msg };
      }
    })(),
    (async () => {
      const r = await fetchPastConcertsViaPerplexityForTable(artist.trim());
      const pplxEvents = r.past.map(perplexityRowToEvent);
      console.log('[concertScraper] Perplexity table returned', pplxEvents.length, 'past');
      return { pplxEvents, pplxError: r.error ?? '' };
    })(),
  ]);

  const { gemEvents, gemError } = gemOutcome;
  const { pplxEvents, pplxError } = pplxOutcome;

  const merged = dedupeEvents([...pplxEvents, ...gemEvents]);
  const { past, upcoming } = splitPastUpcoming(merged);

  if (!sources.includes('Gemini · Google Search')) {
    sources.push('Gemini · Google Search');
  }
  if (!sources.includes('Perplexity · Sonar')) {
    sources.push('Perplexity · Sonar');
  }

  if (pplxEvents.length > 0) {
    errors.push(
      'Минулі концерти (з 2024): Perplexity по місяцях — JSON у таблицю; https URL + майданчик; ціни — лише з джерела (високий ліміт токенів відповіді).'
    );
    if (pplxError) {
      errors.push(`Perplexity (деякі роки): ${pplxError.slice(0, 260)}`);
    }
  } else if (pplxError) {
    errors.push(`Perplexity (таблиця): ${pplxError.slice(0, 220)}`);
  }

  if (gemEvents.length > 0) {
    errors.push(
      'Заплановані концерти: Gemini + Google Search (лише дати після сьогодні; ціни — як на сторінці квитка/ресейлу, та сама валюта, діапазон від–до якщо видно кілька оголошень; без конвертації в USD).'
    );
  } else if (gemError) {
    errors.push(`Gemini Google Search: ${gemError.slice(0, 200)}`);
  }

  const totalAfter = past.length + upcoming.length;
  if (totalAfter === 0) {
    errors.push(
      'Perplexity і Gemini не повернули структуровані події — перевірте написання імені артиста або спробуйте англійську назву (наприклад Boombox).'
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
