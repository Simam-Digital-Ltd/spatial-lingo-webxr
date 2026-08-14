import { describe, expect, it } from 'vitest';
import { normalise, scoreAttempt } from '../src/scoring.js';
import type { VocabularyEntry } from '../src/types.js';

const mesa: VocabularyEntry = {
  label: 'table', word: 'mesa', article: 'la',
  phonetic: 'MEH-sah', exampleSentence: 'El libro esta sobre la mesa.',
};

describe('normalise', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalise('LÁMPARA')).toBe('lampara');
  });
  it('strips punctuation and collapses whitespace', () => {
    expect(normalise('  la   mesa!  ')).toBe('la mesa');
  });
});

describe('scoreAttempt', () => {
  it('accepts the exact word', () => {
    expect(scoreAttempt(mesa, 'mesa').verdict).toBe('correct');
  });
  it('accepts the word with its article', () => {
    expect(scoreAttempt(mesa, 'la mesa').verdict).toBe('correct');
  });
  it('ignores case and diacritics', () => {
    expect(scoreAttempt(mesa, 'MESA').verdict).toBe('correct');
  });
  it('marks a near miss as close', () => {
    expect(scoreAttempt(mesa, 'meza').verdict).toBe('close');
  });
  it('marks an unrelated word as incorrect', () => {
    expect(scoreAttempt(mesa, 'ventana').verdict).toBe('incorrect');
  });
  it('marks empty input as incorrect', () => {
    const result = scoreAttempt(mesa, '');
    expect(result.verdict).toBe('incorrect');
    expect(result.similarity).toBe(0);
  });
  it('reports the expected word', () => {
    expect(scoreAttempt(mesa, 'mesa').expected).toBe('mesa');
  });
});
