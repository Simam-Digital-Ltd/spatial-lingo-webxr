import type { LessonPack, SemanticLabel } from '@spatial-lingo/core';

/**
 * Learned-word persistence, in `localStorage`.
 *
 * Until this existed, a refresh threw away every word — which is a strange
 * thing for a *learning* app to do, and the most visible gap on a link people
 * are invited to try. Deliberately the smallest possible mechanism: no
 * account, no network, no service, nothing that needs a privacy answer beyond
 * "it stays in your browser".
 *
 * The parsing is a pure function so the awkward cases — corrupt JSON, a stored
 * list from a different language pack, a pack that has since lost an entry —
 * are tested in Node rather than discovered in a browser.
 */

/** Storage key. Versioned, so a future format change cannot misread this one. */
const STORAGE_KEY = 'spatial-lingo:progress:v1';

export interface StoredProgress {
  /** BCP-47 tag of the pack the words were learned in. */
  language: string;
  learned: SemanticLabel[];
}

/**
 * Parse stored JSON into a label list, keeping only what the pack still has.
 *
 * Returns an empty list for anything unusable rather than throwing. A visitor
 * whose stored progress is corrupt should get a fresh start, not a broken page
 * — this runs during boot, before there is any UI to report an error in.
 */
export function parseProgress(raw: string | null, pack: LessonPack): SemanticLabel[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Partial<StoredProgress>;

  // Progress is per language. Restoring Spanish words into a French pack would
  // credit words the learner has never seen.
  if (record.language !== pack.language) return [];
  if (!Array.isArray(record.learned)) return [];

  const known = new Set(pack.entries.map((entry) => entry.label));
  const seen = new Set<string>();
  const labels: SemanticLabel[] = [];
  for (const label of record.learned) {
    if (typeof label !== 'string') continue;
    if (!known.has(label) || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** Serialise a label list for storage. */
export function serializeProgress(pack: LessonPack, learned: readonly SemanticLabel[]): string {
  const payload: StoredProgress = { language: pack.language, learned: [...learned] };
  return JSON.stringify(payload);
}

/**
 * `localStorage` wrapper that never throws.
 *
 * Storage access itself can throw — Safari private browsing, a blocked
 * third-party context, a full quota — and none of those are worth taking the
 * app down for. Every failure degrades to "this session will not be
 * remembered", which is exactly the behaviour that shipped before this file
 * existed.
 */
export class ProgressStore {
  readonly #pack: LessonPack;
  readonly #storage: Storage | null;

  constructor(pack: LessonPack, storage: Storage | null = safeStorage()) {
    this.#pack = pack;
    this.#storage = storage;
  }

  load(): SemanticLabel[] {
    if (!this.#storage) return [];
    try {
      return parseProgress(this.#storage.getItem(STORAGE_KEY), this.#pack);
    } catch {
      return [];
    }
  }

  save(learned: readonly SemanticLabel[]): void {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(STORAGE_KEY, serializeProgress(this.#pack, learned));
    } catch {
      // Quota or a blocked store. Nothing to do and nothing worth saying.
    }
  }

  clear(): void {
    if (!this.#storage) return;
    try {
      this.#storage.removeItem(STORAGE_KEY);
    } catch {
      // As above.
    }
  }
}

/** `localStorage`, or null where touching it throws or it does not exist. */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
