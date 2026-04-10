import { describe, it, expect } from 'vitest';
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

  it('filterConcertsForDisplay drops events before 2024-01-01', () => {
    const data: ConcertData = {
      artist: 'X',
      past: [ev({ date: '2023-01-01' }), ev({ date: '2024-02-01' })],
      upcoming: [],
      sources_checked: [],
      errors: [],
    };
    const f = filterConcertsForDisplay(data);
    expect(f.past.length).toBe(1);
    expect(f.past[0].date).toBe('2024-02-01');
  });
});
