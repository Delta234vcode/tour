import { describe, it, expect, vi } from 'vitest';
import {
  artistPastCacheKey,
  loadCachedPastForArtist,
  mergeStoredPastRows,
  PAST_CACHE_FORMAT_VERSION,
  type StoredPastConcertEvent,
} from './concertPastCache';

describe('concertPastCache', () => {
  it('artistPastCacheKey is stable for spacing and case', () => {
    expect(artistPastCacheKey('LOBODA')).toBe(artistPastCacheKey(' loboda '));
  });

  it('mergeStoredPastRows keeps richer duplicate', () => {
    const a: StoredPastConcertEvent = {
      date: '2024-06-01',
      city: 'Warsaw',
      country: 'PL',
      venue: 'Arena',
      url: 'https://a.example',
      source: 'Perplexity · Sonar',
      price_label: null,
      event_status: null,
    };
    const b: StoredPastConcertEvent = {
      ...a,
      url: 'https://b.example/longer',
      price_label: '€50',
      country: 'Poland',
    };
    const m = mergeStoredPastRows([[a], [b]]);
    expect(m.length).toBe(1);
    expect(m[0].price_label).toBe('€50');
  });

  it('loadCachedPastForArtist merges local and server (fetch 404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 404, ok: false } as Response)
    );
    const storeKey = 'chaika.pastConcertCache.v1';
    localStorage.setItem(
      storeKey,
      JSON.stringify({
        v: PAST_CACHE_FORMAT_VERSION,
        entries: {
          loboda: {
            artistDisplay: 'LOBODA',
            updatedAt: 1,
            past: [
              {
                date: '2024-01-15',
                city: 'Kyiv',
                country: 'UA',
                venue: 'Hall',
                url: 'https://x',
                source: 'Perplexity · Sonar',
                price_label: null,
                event_status: 'completed',
              },
            ],
          },
        },
      })
    );
    const r = await loadCachedPastForArtist('LOBODA');
    expect(r.stored.length).toBe(1);
    expect(r.fromLocalCount).toBe(1);
    localStorage.removeItem(storeKey);
    vi.unstubAllGlobals();
  });
});
