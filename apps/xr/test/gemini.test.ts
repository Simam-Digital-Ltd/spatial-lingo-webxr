import { loadPack, type LessonPack, type VocabularyEntry } from '@spatial-lingo/core';
import { describe, expect, it } from 'vitest';

import { ApiKeyStore, DEFAULT_MODEL, looksLikeKey } from '../src/api-key.js';
import { describeOutcome } from '../src/byok-ui.js';
import {
  GeminiClient,
  MAX_SENTENCE_LENGTH,
  buildPrompt,
  buildRequestBody,
  describeHttpFailure,
  endpointFor,
  parseVerdict,
  truncateSentence,
} from '../src/gemini.js';

const pack: LessonPack = loadPack({
  language: 'es',
  languageName: 'Spanish',
  entries: [
    {
      label: 'table',
      word: 'mesa',
      article: 'la',
      phonetic: 'MEH-sah',
      exampleSentence: 'El libro esta sobre la mesa.',
    },
  ],
});
const entry = pack.entries[0] as VocabularyEntry;

/** In-memory `Storage`. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('looksLikeKey', () => {
  it('rejects the obvious non-keys before spending a request on them', () => {
    expect(looksLikeKey('')).toBe(false);
    expect(looksLikeKey('   ')).toBe(false);
    expect(looksLikeKey('too-short')).toBe(false);
    expect(looksLikeKey('has spaces in the middle of it')).toBe(false);
  });

  it('accepts something key-shaped', () => {
    expect(looksLikeKey('AIzaSyD-not-a-real-key-000000000000')).toBe(true);
    expect(looksLikeKey('  AIzaSyD-not-a-real-key-000000000000  ')).toBe(true);
  });
});

describe('ApiKeyStore', () => {
  it('round-trips a key and model', () => {
    const store = new ApiKeyStore(fakeStorage());
    store.save('AIzaSyD-not-a-real-key-000000000000', 'gemini-x');
    expect(store.key).toBe('AIzaSyD-not-a-real-key-000000000000');
    expect(store.model).toBe('gemini-x');
    expect(store.hasKey).toBe(true);
  });

  it('falls back to the default model when none is given', () => {
    const store = new ApiKeyStore(fakeStorage());
    store.save('AIzaSyD-not-a-real-key-000000000000', '   ');
    expect(store.model).toBe(DEFAULT_MODEL);
  });

  it('forgets both the key and the model override', () => {
    const store = new ApiKeyStore(fakeStorage());
    store.save('AIzaSyD-not-a-real-key-000000000000', 'gemini-x');
    store.forget();
    expect(store.key).toBeNull();
    expect(store.hasKey).toBe(false);
    expect(store.model).toBe(DEFAULT_MODEL);
  });

  it('is inert without storage', () => {
    const store = new ApiKeyStore(null);
    expect(() => store.save('AIzaSyD-not-a-real-key-000000000000', 'x')).not.toThrow();
    expect(store.hasKey).toBe(false);
  });
});

describe('truncateSentence', () => {
  it('collapses whitespace and trims', () => {
    expect(truncateSentence('  la   mesa\n es grande  ')).toBe('la mesa es grande');
  });

  it('caps length, which is the cost control and the abuse guard at once', () => {
    const long = 'a'.repeat(MAX_SENTENCE_LENGTH + 500);
    expect(truncateSentence(long)).toHaveLength(MAX_SENTENCE_LENGTH);
  });
});

describe('buildPrompt', () => {
  it('names the language, the word and the sentence, and nothing else', () => {
    const prompt = buildPrompt(pack, entry, 'La mesa es grande.');
    expect(prompt).toContain('Spanish');
    expect(prompt).toContain('mesa');
    expect(prompt).toContain('La mesa es grande.');
  });

  it('does not include the rest of the pack', () => {
    // Every token is paid for on each request. The prompt carries one entry.
    const prompt = buildPrompt(pack, entry, 'La mesa es grande.');
    expect(prompt).not.toContain('exampleSentence');
    expect(prompt.length).toBeLessThan(600);
  });

  it('truncates the sentence it embeds', () => {
    const prompt = buildPrompt(pack, entry, 'x'.repeat(MAX_SENTENCE_LENGTH + 300));
    expect(prompt).not.toContain('x'.repeat(MAX_SENTENCE_LENGTH + 1));
  });
});

describe('buildRequestBody', () => {
  it('constrains the reply to a small JSON schema with an output ceiling', () => {
    const body = buildRequestBody(pack, entry, 'La mesa es grande.') as {
      generationConfig: { responseMimeType: string; maxOutputTokens: number; temperature: number };
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(200);
    // Grading is a judgement, not a creative task: the same sentence should
    // not be marked differently on two attempts.
    expect(body.generationConfig.temperature).toBeLessThan(0.5);
  });
});

describe('endpointFor', () => {
  it('targets the Generative Language API', () => {
    expect(endpointFor('gemini-2.5-flash')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
  });

  it('encodes a model name rather than letting it break out of the path', () => {
    expect(endpointFor('../../evil')).not.toContain('../');
  });
});

describe('parseVerdict', () => {
  const wrap = (text: string): unknown => ({
    candidates: [{ content: { parts: [{ text }] } }],
  });

  it('reads a well-formed verdict', () => {
    const verdict = parseVerdict(wrap('{"correct":true,"feedback":"Nicely done."}'));
    expect(verdict).toEqual({ correct: true, feedback: 'Nicely done.' });
  });

  it('returns null for anything malformed rather than guessing', () => {
    // Model output must never drive game state directly. Being marked wrong
    // because a reply was truncated is the worst failure a learning app has.
    expect(parseVerdict(null)).toBeNull();
    expect(parseVerdict({})).toBeNull();
    expect(parseVerdict({ candidates: [] })).toBeNull();
    expect(parseVerdict(wrap('not json'))).toBeNull();
    expect(parseVerdict(wrap('{"correct":"yes","feedback":"x"}'))).toBeNull();
    expect(parseVerdict(wrap('{"correct":true}'))).toBeNull();
    expect(parseVerdict(wrap('{"correct":true,"feedback":"   "}'))).toBeNull();
  });
});

describe('describeHttpFailure', () => {
  it('says what to actually do about each failure', () => {
    expect(describeHttpFailure(403)).toMatch(/key/i);
    expect(describeHttpFailure(404)).toMatch(/model/i);
    expect(describeHttpFailure(429)).toMatch(/wait|rate/i);
    expect(describeHttpFailure(503)).toMatch(/again/i);
  });
});

describe('GeminiClient', () => {
  const keyed = (): ApiKeyStore => {
    const store = new ApiKeyStore(fakeStorage());
    store.save('AIzaSyD-not-a-real-key-000000000000', DEFAULT_MODEL);
    return store;
  };

  const jsonResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  it('reports no-key rather than calling out with nothing', async () => {
    const store = new ApiKeyStore(fakeStorage());
    let called = false;
    const client = new GeminiClient(pack, store, async () => {
      called = true;
      return jsonResponse({});
    });
    expect(await client.gradeSentence(entry, 'La mesa es grande.')).toEqual({ status: 'no-key' });
    expect(called).toBe(false);
  });

  it('sends the key in a header, never in the URL', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const client = new GeminiClient(pack, keyed(), async (url, init) => {
      seenUrl = String(url);
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"correct":true,"feedback":"Good."}' }] } }],
      });
    });

    await client.gradeSentence(entry, 'La mesa es grande.');
    // URLs land in history, referrers and logs. A credential belongs in none.
    expect(seenUrl).not.toContain('AIza');
    expect(seenHeaders['x-goog-api-key']).toBe('AIzaSyD-not-a-real-key-000000000000');
  });

  it('grades a sentence', async () => {
    const client = new GeminiClient(pack, keyed(), async () =>
      jsonResponse({
        candidates: [
          { content: { parts: [{ text: '{"correct":false,"feedback":"Try la, not el."}' }] } },
        ],
      }),
    );
    expect(await client.gradeSentence(entry, 'El mesa es grande.')).toEqual({
      status: 'graded',
      verdict: { correct: false, feedback: 'Try la, not el.' },
    });
  });

  it('rejects an empty sentence without a request', async () => {
    let called = false;
    const client = new GeminiClient(pack, keyed(), async () => {
      called = true;
      return jsonResponse({});
    });
    const outcome = await client.gradeSentence(entry, '  ');
    expect(outcome.status).toBe('rejected');
    expect(called).toBe(false);
  });

  it('fails softly when the network throws', async () => {
    const client = new GeminiClient(pack, keyed(), async () => {
      throw new Error('offline');
    });
    const outcome = await client.gradeSentence(entry, 'La mesa es grande.');
    expect(outcome.status).toBe('failed');
  });

  it('fails softly on an HTTP error', async () => {
    const client = new GeminiClient(pack, keyed(), async () => jsonResponse({}, 403));
    const outcome = await client.gradeSentence(entry, 'La mesa es grande.');
    expect(outcome).toEqual({ status: 'failed', reason: describeHttpFailure(403) });
  });

  it('treats an unparseable reply as a service failure, not a wrong answer', async () => {
    const client = new GeminiClient(pack, keyed(), async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: 'sorry, I cannot' }] } }] }),
    );
    const outcome = await client.gradeSentence(entry, 'La mesa es grande.');
    expect(outcome.status).toBe('failed');
  });
});

describe('describeOutcome', () => {
  it('maps a pass and a fail to the right tone', () => {
    expect(
      describeOutcome({ status: 'graded', verdict: { correct: true, feedback: 'Great.' } }),
    ).toEqual({ tone: 'correct', message: 'Great.' });
    expect(
      describeOutcome({ status: 'graded', verdict: { correct: false, feedback: 'Not quite.' } }),
    ).toEqual({ tone: 'wrong', message: 'Not quite.' });
  });

  it('never shows a service problem as a wrong answer', () => {
    expect(describeOutcome({ status: 'failed', reason: 'Gemini is down.' }).tone).toBe('error');
    expect(describeOutcome({ status: 'no-key' }).tone).toBe('error');
    expect(describeOutcome({ status: 'rejected', reason: 'Too short.' }).tone).toBe('error');
  });
});
