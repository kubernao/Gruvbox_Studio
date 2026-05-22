import { describe, expect, it } from 'vitest';
import {
  runGrammarCheck,
  runReadabilityCheck,
  runSpellCheck,
} from '../../src/frontend/features/editor/languageReviewService';

describe('languageReviewService', () => {
  it('detects misspelled words with suggestions', async () => {
    const result = await runSpellCheck('teh quick brown fox');
    expect(result.misspellings.length).toBeGreaterThan(0);
    expect(result.misspellings[0]?.term.toLowerCase()).toBe('teh');
  });

  it('returns grammar/style issues from write-good', async () => {
    const result = await runGrammarCheck('There is very many reasons this is really really bad.');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('calculates readability score and grade', async () => {
    const result = await runReadabilityCheck('This is a short sentence. This is another sentence.');
    expect(result.words).toBeGreaterThan(0);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isFinite(result.grade)).toBe(true);
  });
});
