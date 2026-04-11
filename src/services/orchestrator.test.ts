import { describe, expect, it } from 'vitest';
import { mergeResearchResults, type ResearchResults } from './orchestrator';

const empty: ResearchResults = {
  concertHistory: '',
  twitterBuzz: '',
  geminiResearch: '',
  claudeHelper: '',
  competitorScan: '',
};

describe('mergeResearchResults', () => {
  it('concatenates two non-empty blocks with separator', () => {
    const a: ResearchResults = { ...empty, concertHistory: 'global' };
    const b: ResearchResults = { ...empty, concertHistory: 'city' };
    const merged = mergeResearchResults(a, b).concertHistory;
    expect(merged).toContain('global');
    expect(merged).toContain('city');
    expect(merged).toContain('---');
  });

  it('returns the only non-empty side when the other is empty', () => {
    expect(mergeResearchResults({ ...empty, geminiResearch: 'x' }, empty).geminiResearch).toBe('x');
    expect(mergeResearchResults(empty, { ...empty, claudeHelper: 'y' }).claudeHelper).toBe('y');
  });
});
