import type { LessonPack, VocabularyEntry } from '@spatial-lingo/core';

import type { ApiKeyStore } from './api-key.js';

/**
 * The one thing the deterministic scorer genuinely cannot do.
 *
 * Comparing a typed word against an expected word is what `scoreAttempt`
 * already does — correctly, instantly, offline, and for free. Sending that to
 * a language model would be paying for a worse version of a solved problem,
 * which is why nothing here runs on the single-word path.
 *
 * Judging whether a *sentence a learner wrote themselves* uses a word
 * correctly is a different problem, and it is the one the Unity original
 * handed to Llama. This is that, on Gemini, called straight from the browser
 * with the learner's own key.
 *
 * Every design choice below is about spending as few tokens as possible:
 * one vocabulary entry rather than the pack, no conversation history, a
 * response schema with a hard output ceiling, and a truncated input that is
 * also the abuse guard. See `docs/roadmap/00-google-stack.md`.
 */

/** Longest sentence accepted. Cost control and prompt-stuffing guard at once. */
export const MAX_SENTENCE_LENGTH = 200;

/** Ceiling on the model's reply. A verdict and one short line need very few. */
const MAX_OUTPUT_TOKENS = 120;

export interface SentenceVerdict {
  /** Whether the sentence uses the target word correctly. */
  correct: boolean;
  /** One short line for the learner. Never more than a sentence or two. */
  feedback: string;
}

export type GradeOutcome =
  | { status: 'graded'; verdict: SentenceVerdict }
  | { status: 'no-key' }
  | { status: 'rejected'; reason: string }
  | { status: 'failed'; reason: string };

/** Trim a learner's sentence to the accepted length. */
export function truncateSentence(text: string, max: number = MAX_SENTENCE_LENGTH): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/**
 * The instruction sent with every grading call.
 *
 * Deliberately terse. Every word here is paid for on each request, and a long
 * persona preamble buys nothing for a task this narrow. It names the language,
 * the target word, and the two fields wanted back — nothing else, because
 * there is nothing else the model needs to know.
 */
export function buildPrompt(
  pack: LessonPack,
  entry: VocabularyEntry,
  sentence: string,
): string {
  return [
    `A learner of ${pack.languageName} was asked to write a sentence using "${entry.word}" (${entry.label}).`,
    `They wrote: "${truncateSentence(sentence)}"`,
    `Is "${entry.word}" used correctly and does the sentence make sense?`,
    'Reply with correct (boolean) and feedback: one short encouraging line for the learner,',
    `in English, naming the fix if there is one. Under 25 words.`,
  ].join('\n');
}

/** Request body, shaped so the reply is parseable JSON rather than prose. */
export function buildRequestBody(
  pack: LessonPack,
  entry: VocabularyEntry,
  sentence: string,
): unknown {
  return {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(pack, entry, sentence) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          correct: { type: 'BOOLEAN' },
          feedback: { type: 'STRING' },
        },
        required: ['correct', 'feedback'],
      },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Grading is a judgement, not a creative task. Low temperature keeps the
      // same sentence from being marked differently on two attempts.
      temperature: 0.2,
    },
  };
}

/**
 * Pull a verdict out of a Gemini response, or null if it is not one.
 *
 * Returns null rather than throwing or guessing. Model output must never
 * drive game state directly: a malformed reply is treated as "the service did
 * not answer", not as "the learner was wrong". Being marked incorrect because
 * a response was truncated is the worst possible failure for a learning app.
 */
export function parseVerdict(payload: unknown): SentenceVerdict | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const text = (parts[0] as { text?: unknown })?.text;
  if (typeof text !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { correct?: unknown; feedback?: unknown };
  if (typeof record.correct !== 'boolean') return null;
  if (typeof record.feedback !== 'string' || record.feedback.trim().length === 0) return null;

  return { correct: record.correct, feedback: record.feedback.trim() };
}

/** Endpoint for a model id. Exported so the tests can assert the shape. */
export function endpointFor(model: string): string {
  const encoded = encodeURIComponent(model);
  return `https://generativelanguage.googleapis.com/v1beta/models/${encoded}:generateContent`;
}

/**
 * Grades sentences by calling Gemini directly from the browser.
 *
 * The key goes in the `x-goog-api-key` header rather than the query string:
 * URLs end up in history, in referrers, and in any logging in between, and a
 * credential does not belong in any of them.
 */
export class GeminiClient {
  readonly #pack: LessonPack;
  readonly #keys: ApiKeyStore;
  readonly #fetch: typeof fetch;

  constructor(pack: LessonPack, keys: ApiKeyStore, fetchImpl?: typeof fetch) {
    this.#pack = pack;
    this.#keys = keys;
    // Wrapped rather than captured. Storing `globalThis.fetch` directly and
    // calling it off a field detaches it from its receiver, which some engines
    // reject outright, and it would also freeze the reference at construction
    // time — which breaks any environment that installs or replaces `fetch`
    // after boot.
    this.#fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  get isConfigured(): boolean {
    return this.#keys.hasKey;
  }

  async gradeSentence(entry: VocabularyEntry, sentence: string): Promise<GradeOutcome> {
    const key = this.#keys.key;
    if (!key) return { status: 'no-key' };

    const cleaned = truncateSentence(sentence);
    if (cleaned.length < 3) {
      return { status: 'rejected', reason: 'Write a full sentence first.' };
    }

    let response: Response;
    try {
      response = await this.#fetch(endpointFor(this.#keys.model), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(buildRequestBody(this.#pack, entry, cleaned)),
      });
    } catch {
      // Offline, blocked, or the browser refused the cross-origin request.
      return { status: 'failed', reason: 'Could not reach Gemini. Check your connection.' };
    }

    if (!response.ok) {
      return { status: 'failed', reason: describeHttpFailure(response.status) };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: 'failed', reason: 'Gemini sent a reply that could not be read.' };
    }

    const verdict = parseVerdict(payload);
    if (!verdict) {
      return { status: 'failed', reason: 'Gemini sent an unexpected reply. Try again.' };
    }
    return { status: 'graded', verdict };
  }
}

/**
 * Turn a status code into something a learner can act on.
 *
 * Generic failure text is what makes people give up on a feature. Each of
 * these has a different fix, and the message says which.
 */
export function describeHttpFailure(status: number): string {
  if (status === 400) return 'Gemini rejected the request. The key may be malformed.';
  if (status === 401 || status === 403) return 'That key was refused. Check it and try again.';
  if (status === 404) return 'That model name was not found. Try a different one in settings.';
  if (status === 429) return 'Rate limited by Gemini. Wait a moment and try again.';
  if (status >= 500) return 'Gemini is having trouble. Try again shortly.';
  return `Gemini returned an error (${status}).`;
}
