import { describe, it, expect } from 'vitest';
import { concertArchiveStartIsoDate } from '../utils/dates';
import {
  dedupeEvents,
  filterConcertsForDisplay,
  type ConcertData,
  type ConcertEvent,
} from './concertScraper';

function ev(partial: Partial<ConcertEvent>): ConcertEvent {
  return {
    date: '2024-06-01',
    city: 'Warsaw',
    country: 'PL',
    venue: 'Arena',
    url: 'https://example.com/a',
    source: 'test',
    price_label: null,
    event_status: null,
    days_ago: 10,
    days_until: null,
    ...partial,
  };
}

describe('concertScraper helpers', () => {
  it('dedupeEvents removes duplicate keys', () => {
    const a = ev({ url: 'https://example.com/e1' });
    const b = ev({ url: 'https://example.com/e1' });
    const c = ev({ city: 'Berlin', venue: 'Club', url: 'https://other' });
    expect(dedupeEvents([a, b, c]).length).toBe(2);
  });

  it('dedupeEvents merges same show from different URLs (Gemini vs scraper)', () => {
    const a = ev({
      url: 'https://worldafisha.com/x',
      city: 'Almaty',
      country: 'Kazakhstan',
      venue: 'Halyk Arena',
      source: 'worldafisha.com',
    });
    const b = ev({
      url: 'https://other.com/y',
      city: 'Almaty',
      country: '',
      venue: 'Halyk Arena',
      source: 'Gemini · Google Search',
    });
    const r = dedupeEvents([a, b]);
    expect(r.length).toBe(1);
    expect(r[0].source).toBe('worldafisha.com');
  });

  it('dedupeEvents merges Cyrillic and Latin city for same date and venue', () => {
    const a = ev({
      city: 'Алматы, Казахстан',
      venue: 'Hall',
      url: 'https://a',
      source: 'worldafisha.com',
    });
    const b = ev({
      city: 'Almaty',
      country: 'Kazakhstan',
      venue: 'Hall',
      url: 'https://b',
      source: 'Gemini · Google Search',
    });
    expect(dedupeEvents([a, b]).length).toBe(1);
  });

  it('filterConcertsForDisplay drops events before archive start', () => {
    const min = concertArchiveStartIsoDate();
    const y = parseInt(min.slice(0, 4), 10);
    const before = `${y - 1}-06-01`;
    const within = `${y}-06-01`;
    const data: ConcertData = {
      artist: 'X',
      past: [ev({ date: before }), ev({ date: within })],
      upcoming: [],
      sources_checked: [],
      errors: [],
    };
    const f = filterConcertsForDisplay(data);
    expect(f.past.length).toBe(1);
    expect(f.past[0].date).toBe(within);
  });
});
