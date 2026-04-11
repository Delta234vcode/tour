import { describe, it, expect } from 'vitest';
import {
  concertArchiveStartIsoDate,
  formatDate,
  getConcertArchiveStartYear,
  ukMonthsPhrase,
  ukDaysPhrase,
  formatTimeSinceConcert,
  calendarMonthsAndDaysBetween,
  isoDateLocalToday,
} from './dates';

describe('dates', () => {
  it('formatDate formats ISO to DD.MM.YYYY', () => {
    expect(formatDate('2024-03-05')).toBe('05.03.2024');
    expect(formatDate(null)).toBe('—');
  });

  it('ukMonthsPhrase pluralizes Ukrainian months', () => {
    expect(ukMonthsPhrase(1)).toContain('місяць');
    expect(ukMonthsPhrase(3)).toContain('місяці');
    expect(ukMonthsPhrase(5)).toContain('місяців');
  });

  it('ukDaysPhrase pluralizes Ukrainian days', () => {
    expect(ukDaysPhrase(1)).toContain('день');
    expect(ukDaysPhrase(3)).toContain('дні');
    expect(ukDaysPhrase(5)).toContain('днів');
  });

  it('calendarMonthsAndDaysBetween returns zero when end before start', () => {
    const a = new Date(2024, 0, 10);
    const b = new Date(2024, 0, 5);
    expect(calendarMonthsAndDaysBetween(a, b)).toEqual({ months: 0, days: 0 });
  });

  it('formatTimeSinceConcert returns null for invalid iso', () => {
    expect(formatTimeSinceConcert('bad')).toBeNull();
  });

  it('isoDateLocalToday matches YYYY-MM-DD', () => {
    expect(isoDateLocalToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getConcertArchiveStartYear is max(2000, year-20)', () => {
    expect(getConcertArchiveStartYear(new Date(2026, 0, 1))).toBe(2006);
    expect(getConcertArchiveStartYear(new Date(2010, 0, 1))).toBe(2000);
  });

  it('concertArchiveStartIsoDate matches archive year', () => {
    expect(concertArchiveStartIsoDate(new Date(2026, 0, 1))).toBe('2006-01-01');
  });
});
