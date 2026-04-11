import unidecode from 'unidecode';
import type { ConcertEvent } from './concertScraper';
import { isoDateLocalToday } from '../utils/dates';

/** Версія формату сховища (localStorage + JSON на сервері). */
export const PAST_CACHE_FORMAT_VERSION = 1;
const LS_KEY = 'chaika.pastConcertCache.v1';

export type StoredPastConcertEvent = Pick<
  ConcertEvent,
  'date' | 'city' | 'country' | 'venue' | 'url' | 'source' | 'price_label' | 'event_status'
>;

type CacheEntry = {
  artistDisplay: string;
  past: StoredPastConcertEvent[];
  updatedAt: number;
};

type LocalStore = {
  v: number;
  entries: Record<string, CacheEntry>;
};

/** Той самий нормалізатор, що й для дедупу подій (без імпорту циклу з concertScraper). */
export function artistPastCacheKey(artist: string): string {
  const k = unidecode((artist || '').trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 56);
  return k || '_empty';
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

export function toStoredPastEvent(e: ConcertEvent): StoredPastConcertEvent {
  return {
    date: e.date,
    city: e.city,
    country: e.country,
    venue: e.venue,
    url: e.url,
    source: e.source,
    price_label: e.price_label ?? null,
    event_status: e.event_status ?? null,
  };
}

export function fromStoredPastEvent(s: StoredPastConcertEvent): ConcertEvent {
  const { ago, until } = computeDaysFromToday(s.date);
  return {
    date: s.date,
    city: s.city,
    country: s.country,
    venue: s.venue,
    url: s.url,
    source: s.source,
    price_label: s.price_label ?? null,
    event_status: s.event_status ?? null,
    days_ago: ago,
    days_until: until,
  };
}

function cityCore(city: string): string {
  return (city || '').split(',')[0].trim();
}

function normSeg(s: string): string {
  return unidecode(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 56);
}

function storedRowKey(s: StoredPastConcertEvent): string {
  return `${s.date || ''}|${normSeg(cityCore(s.city))}|${normSeg(s.venue || '')}`;
}

function storedRichness(s: StoredPastConcertEvent): number {
  let n = 0;
  if ((s.venue || '').trim()) n += 3;
  if ((s.price_label || '').trim()) n += 3;
  if ((s.country || '').trim()) n += 1;
  if ((s.city || '').trim()) n += 1;
  if ((s.url || '').trim()) n += 1;
  if ((s.event_status || '').trim()) n += 1;
  if (!s.source.includes('Gemini')) n += 2;
  if (s.source.includes('Perplexity')) n -= 1;
  return n;
}

/** Злиття кількох списків збережених минулих подій у один без дублікатів (багатший рядок перемагає). */
export function mergeStoredPastRows(lists: StoredPastConcertEvent[][]): StoredPastConcertEvent[] {
  const map = new Map<string, StoredPastConcertEvent>();
  for (const list of lists) {
    for (const row of list) {
      if (!row.date || !String(row.date).trim()) continue;
      const k = storedRowKey(row);
      const prev = map.get(k);
      if (!prev || storedRichness(row) > storedRichness(prev)) map.set(k, { ...row });
    }
  }
  return [...map.values()];
}

function readLocalStore(): LocalStore {
  if (typeof localStorage === 'undefined') return { v: PAST_CACHE_FORMAT_VERSION, entries: {} };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { v: PAST_CACHE_FORMAT_VERSION, entries: {} };
    const p = JSON.parse(raw) as LocalStore;
    if (!p || p.v !== PAST_CACHE_FORMAT_VERSION || typeof p.entries !== 'object' || !p.entries) {
      return { v: PAST_CACHE_FORMAT_VERSION, entries: {} };
    }
    return p;
  } catch {
    return { v: PAST_CACHE_FORMAT_VERSION, entries: {} };
  }
}

function writeLocalStore(store: LocalStore): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[concertPastCache] localStorage write failed', e);
  }
}

export function loadLocalPastStored(artist: string): StoredPastConcertEvent[] {
  const key = artistPastCacheKey(artist);
  const store = readLocalStore();
  const ent = store.entries[key];
  if (!ent?.past?.length) return [];
  return ent.past.filter((r) => r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)));
}

async function fetchServerPastStored(key: string): Promise<StoredPastConcertEvent[]> {
  const res = await fetch(`/api/past-concert-cache?key=${encodeURIComponent(key)}`);
  if (res.status === 404) return [];
  if (!res.ok) return [];
  const j = (await res.json()) as { past?: StoredPastConcertEvent[] };
  const past = Array.isArray(j.past) ? j.past : [];
  return past.filter((r) => r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)));
}

/** Завантажити збережені минулі події: localStorage + за наявності бекенду — JSON-файл на сервері. */
export async function loadCachedPastForArtist(artist: string): Promise<{
  stored: StoredPastConcertEvent[];
  fromLocalCount: number;
  fromServerCount: number;
}> {
  const key = artistPastCacheKey(artist);
  const local = loadLocalPastStored(artist);
  let server: StoredPastConcertEvent[] = [];
  try {
    server = await fetchServerPastStored(key);
  } catch {
    /* офлайн або проксі без /api/past-concert-cache */
  }
  const merged = mergeStoredPastRows([local, server]);
  return {
    stored: merged,
    fromLocalCount: local.length,
    fromServerCount: server.length,
  };
}

export function saveLocalPastCache(artistDisplay: string, past: StoredPastConcertEvent[]): void {
  const key = artistPastCacheKey(artistDisplay);
  const store = readLocalStore();
  store.entries[key] = {
    artistDisplay: artistDisplay.trim() || key,
    past,
    updatedAt: Date.now(),
  };
  writeLocalStore(store);
}

async function postServerPastCache(
  key: string,
  artistDisplay: string,
  past: StoredPastConcertEvent[]
): Promise<void> {
  const res = await fetch('/api/past-concert-cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      artistDisplay: artistDisplay.trim() || key,
      past,
    }),
  });
  if (!res.ok) throw new Error(`POST past cache ${res.status}`);
}

/** Зберегти злиті минулі події в localStorage і на сервер (якщо доступний). */
export async function persistPastCacheForArtist(
  artistDisplay: string,
  past: ConcertEvent[]
): Promise<void> {
  const onlyPastToday = past.filter((e) => {
    const d = e.date;
    if (!d) return false;
    return d <= isoDateLocalToday();
  });
  const stored = onlyPastToday.map(toStoredPastEvent);
  const key = artistPastCacheKey(artistDisplay);
  saveLocalPastCache(artistDisplay, stored);
  try {
    await postServerPastCache(key, artistDisplay, stored);
  } catch {
    /* тільки localStorage */
  }
}
