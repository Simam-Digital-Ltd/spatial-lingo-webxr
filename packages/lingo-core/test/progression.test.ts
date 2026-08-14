import { describe, expect, it } from 'vitest';
import { progressionFor } from '../src/progression.js';

describe('progressionFor', () => {
  it.each([
    [0, 0, 1],
    [1, 1, 2],
    [2, 1, 1],
    [3, 2, 3],
    [5, 2, 1],
    [6, 3, 4],
    [9, 3, 1],
    [10, 4, null],
    [25, 4, null],
  ])('%i words -> tier %i, %s to next', (learned, tier, toNext) => {
    const state = progressionFor(learned);
    expect(state.tier).toBe(tier);
    expect(state.learnedCount).toBe(learned);
    expect(state.wordsToNextTier).toBe(toNext);
  });

  it('rejects a negative count', () => {
    expect(() => progressionFor(-1)).toThrow(/negative/);
  });
});
