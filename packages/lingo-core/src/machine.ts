import { scoreAttempt, type AttemptResult } from './scoring.js';
import type { LessonPack, SemanticLabel, VocabularyEntry } from './types.js';
import { findEntry } from './vocabulary.js';

export type LessonPhase = 'idle' | 'presenting' | 'listening' | 'feedback' | 'complete';

export interface LessonState {
  phase: LessonPhase;
  entry: VocabularyEntry | null;
  lastResult: AttemptResult | null;
  attemptsRemaining: number;
  learnedLabels: readonly SemanticLabel[];
}

export interface LessonMachineOptions {
  /** Attempts allowed per lesson before it closes unlearned. Defaults to 3. */
  maxAttempts?: number;
  /**
   * Words already learned in an earlier session.
   *
   * Restoring at construction rather than through a `restore()` method is
   * deliberate: `#learned` only ever grows, and every consumer treats it as a
   * high-water mark, so a machine that gains history mid-run would look like
   * several words being learned at once. Anything not in the pack, and any
   * duplicate, is dropped — a stored list outlives the pack that produced it,
   * and a pack can lose entries between visits.
   */
  learnedLabels?: readonly SemanticLabel[];
}

/**
 * The lesson loop as an explicit state machine.
 *
 * Replaces Spatial Lingo's Unity Visual Scripting graph (`AppFlow.asset`), whose
 * transitions were only inspectable inside the Unity editor. This version is
 * plain TypeScript: readable in a diff and testable without a headset.
 */
export class LessonMachine {
  readonly #pack: LessonPack;
  readonly #maxAttempts: number;
  readonly #listeners = new Set<(state: LessonState) => void>();
  readonly #learned: SemanticLabel[] = [];

  #phase: LessonPhase = 'idle';
  #entry: VocabularyEntry | null = null;
  #lastResult: AttemptResult | null = null;
  #attemptsRemaining = 0;

  constructor(pack: LessonPack, options: LessonMachineOptions = {}) {
    this.#pack = pack;
    this.#maxAttempts = options.maxAttempts ?? 3;

    for (const label of options.learnedLabels ?? []) {
      if (this.#learned.includes(label)) continue;
      if (!findEntry(pack, label)) continue;
      this.#learned.push(label);
    }
  }

  get state(): LessonState {
    return {
      phase: this.#phase,
      entry: this.#entry ? { ...this.#entry } : null,
      lastResult: this.#lastResult ? { ...this.#lastResult } : null,
      attemptsRemaining: this.#attemptsRemaining,
      learnedLabels: [...this.#learned],
    };
  }

  /** Begin a lesson for a detected object. Returns false if it cannot start. */
  targetLabel(label: SemanticLabel): boolean {
    const busy = this.#phase !== 'idle' && this.#phase !== 'complete';
    if (busy) return false;

    const entry = findEntry(this.#pack, label);
    if (!entry) return false;

    this.#entry = entry;
    this.#lastResult = null;
    this.#attemptsRemaining = this.#maxAttempts;
    this.#phase = 'presenting';
    this.#emit();
    return true;
  }

  beginListening(): void {
    if (this.#phase !== 'presenting') {
      throw new Error(`beginListening requires phase presenting, got ${this.#phase}`);
    }
    this.#phase = 'listening';
    this.#emit();
  }

  submitAttempt(spoken: string): AttemptResult {
    if (this.#phase !== 'listening') {
      throw new Error(`submitAttempt requires phase listening, got ${this.#phase}`);
    }
    const entry = this.#entry;
    if (!entry) throw new Error('submitAttempt called with no active entry');

    const result = scoreAttempt(entry, spoken);
    this.#lastResult = result;
    if (result.verdict !== 'correct') {
      this.#attemptsRemaining -= 1;
    }
    this.#phase = 'feedback';
    this.#emit();
    return result;
  }

  dismissFeedback(): void {
    if (this.#phase !== 'feedback') {
      throw new Error(`dismissFeedback requires phase feedback, got ${this.#phase}`);
    }
    const passed = this.#lastResult?.verdict === 'correct';

    if (passed) {
      const label = this.#entry?.label;
      if (label && !this.#learned.includes(label)) this.#learned.push(label);
      this.#phase = 'complete';
    } else if (this.#attemptsRemaining > 0) {
      this.#phase = 'listening';
    } else {
      this.#phase = 'complete';
    }
    this.#emit();
  }

  subscribe(listener: (state: LessonState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const snapshot = this.state;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
