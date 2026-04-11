import { describe, expect, it } from 'vitest';
import { pastHasVerifiedEventInCity, cityBucketForMatch } from './cityPastVerify';
import type { ConcertEvent } from './concertScraper';

function ev(partial: Partial<ConcertEvent> & Pick<ConcertEvent, 'date' | 'city'>): ConcertEvent {
  return {
    country: '',
    venue: '',
    url: 'https://example.com/e',
    source: 'test',
    price_label: null,
    event_status: 'completed',
    days_ago: 1,
    days_until: null,
    ...partial,
  };
}

describe('cityPastVerify', () => {
  it('cityBucketForMatch unifies Warsaw spellings', () => {
    expect(cityBucketForMatch('Warsaw')).toBe(cityBucketForMatch('Warszawa'));
    expect(cityBucketForMatch('Варшава')).toBe(cityBucketForMatch('warsaw'));
  });

  it('pastHasVerifiedEventInCity detects past gig in city', () => {
    const today = new Date();
    const y = today.getFullYear();
    const iso = `${y - 1}-06-15`;
    const past: ConcertEvent[] = [
      ev({ date: iso, city: 'Warsaw, Poland', venue: 'Arena' }),
    ];
    expect(pastHasVerifiedEventInCity(past, 'Варшава')).toBe(true);
    expect(pastHasVerifiedEventInCity(past, 'Krakow')).toBe(false);
  });

  it('ignores future dates for city coverage', () => {
    const today = new Date();
    const y = today.getFullYear() + 1;
    const past: ConcertEvent[] = [ev({ date: `${y}-01-01`, city: 'Warsaw', venue: 'X' })];
    expect(pastHasVerifiedEventInCity(past, 'Warsaw')).toBe(false);
  });
});
