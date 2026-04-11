import { describe, expect, it } from 'vitest';
import { parsePeriodDatesForWeather, parseTourDatesFromText } from './tourDateParse';

describe('parseTourDatesFromText', () => {
  it('parses DMY and ISO', () => {
    expect(parseTourDatesFromText('15.09.2026 2026-10-01')).toEqual(['2026-09-15', '2026-10-01']);
  });
});

describe('parsePeriodDatesForWeather', () => {
  it('expands Ukrainian month + year', () => {
    const d = parsePeriodDatesForWeather('вересень 2026');
    expect(d.length).toBeGreaterThanOrEqual(3);
    expect(d.every((x) => x.startsWith('2026-09'))).toBe(true);
  });

  it('merges explicit dates with month period', () => {
    const d = parsePeriodDatesForWeather('01.09.2026 вересень 2026');
    expect(d.includes('2026-09-01')).toBe(true);
  });
});
