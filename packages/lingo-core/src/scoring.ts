import type { VocabularyEntry } from './types.js';

export type AttemptVerdict = 'correct' | 'close' | 'incorrect';

export interface AttemptResult {
  verdict: AttemptVerdict;
  /** 0–1, where 1 is an exact match after normalisation. */
  similarity: number;
  /** The word the learner was asked to say. */
  expected: string;
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalise(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function similarityOf(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Score a spoken attempt against the target word.
 * The article is optional: both "mesa" and "la mesa" score as correct.
 */
export function scoreAttempt(entry: VocabularyEntry, spoken: string): AttemptResult {
  const heard = normalise(spoken);
  const expected = normalise(entry.word);

  if (heard.length === 0) {
    return { verdict: 'incorrect', similarity: 0, expected: entry.word };
  }

  const candidates = [expected];
  if (entry.article) {
    candidates.push(normalise(`${entry.article} ${entry.word}`));
  }

  const similarity = Math.max(...candidates.map((candidate) => similarityOf(heard, candidate)));
  const verdict: AttemptVerdict =
    similarity >= 0.99 ? 'correct' : similarity >= 0.7 ? 'close' : 'incorrect';

  return { verdict, similarity, expected: entry.word };
}
