import type { VocabularyEntry } from '@spatial-lingo/core';

import { ApiKeyStore, DEFAULT_MODEL, looksLikeKey } from './api-key.js';
import type { GeminiClient, GradeOutcome } from './gemini.js';

/**
 * The two pieces of interface that bring-your-own-key needs: somewhere to put
 * the key, and something worth having once it is there.
 *
 * Kept out of `hud.ts` deliberately. The HUD renders lesson state and must
 * keep working with no key, no network and no model — this file is the whole
 * of the optional layer, and deleting it would leave the app exactly as it was
 * before any of this existed.
 */

/** Feedback line for a grading outcome. Pure, so the wording is tested. */
export interface ChallengeView {
  tone: 'correct' | 'wrong' | 'error';
  message: string;
}

export function describeOutcome(outcome: GradeOutcome): ChallengeView {
  switch (outcome.status) {
    case 'graded':
      return {
        tone: outcome.verdict.correct ? 'correct' : 'wrong',
        message: outcome.verdict.feedback,
      };
    case 'no-key':
      return { tone: 'error', message: 'Connect a Gemini key to check sentences.' };
    case 'rejected':
      return { tone: 'error', message: outcome.reason };
    case 'failed':
      return { tone: 'error', message: outcome.reason };
  }
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`[spatial-lingo] missing element #${id}`);
  return element as T;
}

/** The bring-your-own-key dialog. */
export class SettingsDialog {
  readonly #root = must('settings');
  readonly #open = must<HTMLButtonElement>('settings-open');
  readonly #key = must<HTMLInputElement>('api-key');
  readonly #model = must<HTMLInputElement>('api-model');
  readonly #status = must('settings-status');
  readonly #store: ApiKeyStore;
  #onChange: (() => void) | null = null;

  constructor(store: ApiKeyStore) {
    this.#store = store;

    this.#open.addEventListener('click', () => this.show());
    must('settings-close').addEventListener('click', () => this.hide());
    must('settings-save').addEventListener('click', () => this.#save());
    must('settings-forget').addEventListener('click', () => this.#forget());

    // Clicking the backdrop closes; clicking the card must not.
    this.#root.addEventListener('click', (event) => {
      if (event.target === this.#root) this.hide();
    });
    // The canvas listens on window for orbit and selection, so keystrokes and
    // drags inside the dialog have to stop here or they spin the room.
    this.#root.addEventListener('keydown', (event) => event.stopPropagation());
    this.#root.addEventListener('pointerdown', (event) => event.stopPropagation());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.#root.classList.contains('open')) this.hide();
    });

    this.#refresh();
  }

  /** Called whenever the stored key changes, so the app can re-check it. */
  onChange(listener: () => void): void {
    this.#onChange = listener;
  }

  show(): void {
    this.#refresh();
    this.#root.classList.add('open');
    this.#key.focus();
  }

  hide(): void {
    this.#root.classList.remove('open');
    // The field is repopulated from storage on the next open, so there is no
    // reason to leave a key sitting in a DOM node in the meantime.
    this.#key.value = '';
  }

  #save(): void {
    const key = this.#key.value.trim();
    if (!looksLikeKey(key)) {
      this.#status.textContent = 'That does not look like a key.';
      return;
    }
    this.#store.save(key, this.#model.value.trim() || DEFAULT_MODEL);
    this.#status.textContent = 'Saved to this browser.';
    this.#refresh();
    this.#onChange?.();
  }

  #forget(): void {
    this.#store.forget();
    this.#key.value = '';
    this.#status.textContent = 'Key removed from this browser.';
    this.#refresh();
    this.#onChange?.();
  }

  #refresh(): void {
    const connected = this.#store.hasKey;
    this.#model.value = this.#store.model;
    this.#key.placeholder = connected ? 'A key is saved — paste to replace' : 'Paste your key';
    this.#open.textContent = connected ? 'Gemini key connected' : 'Connect a Gemini key';
  }
}

/**
 * The sentence challenge.
 *
 * Offered only after a word has been learned, so the model is never asked to
 * do the job the deterministic scorer already does. Skipping is always
 * available and costs nothing — this is a bonus round, not a gate.
 */
export class SentenceChallenge {
  readonly #root = must('challenge');
  readonly #word = must('challenge-word');
  readonly #input = must<HTMLTextAreaElement>('sentence');
  readonly #submit = must<HTMLButtonElement>('challenge-submit');
  readonly #skip = must<HTMLButtonElement>('challenge-skip');
  readonly #feedback = must('challenge-feedback');
  readonly #client: GeminiClient;
  #entry: VocabularyEntry | null = null;
  #busy = false;

  constructor(client: GeminiClient) {
    this.#client = client;

    this.#submit.addEventListener('click', () => void this.#grade());
    this.#skip.addEventListener('click', () => this.hide());
    this.#input.addEventListener('keydown', (event) => {
      // Enter submits, Shift+Enter is a newline — the usual bargain for a
      // textarea people will mostly type one line into.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.#grade();
      }
      event.stopPropagation();
    });
    this.#root.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  /** Offer the challenge for a freshly learned word, if a key is configured. */
  offer(entry: VocabularyEntry): void {
    if (!this.#client.isConfigured) return;
    this.#entry = entry;
    this.#word.textContent = entry.article ? `${entry.article} ${entry.word}` : entry.word;
    this.#input.value = '';
    this.#setFeedback(null);
    this.#root.classList.add('active');
  }

  hide(): void {
    this.#root.classList.remove('active');
    this.#entry = null;
  }

  async #grade(): Promise<void> {
    const entry = this.#entry;
    if (!entry || this.#busy) return;

    const sentence = this.#input.value;
    if (sentence.trim().length === 0) return;

    this.#busy = true;
    this.#submit.disabled = true;
    this.#submit.textContent = 'Checking…';
    this.#setFeedback({ tone: 'error', message: 'Asking Gemini…' });

    const outcome = await this.#client.gradeSentence(entry, sentence);

    this.#busy = false;
    this.#submit.disabled = false;
    this.#submit.textContent = 'Check my sentence';
    this.#setFeedback(describeOutcome(outcome));
  }

  #setFeedback(view: ChallengeView | null): void {
    if (!view) {
      this.#feedback.className = '';
      this.#feedback.textContent = '';
      return;
    }
    this.#feedback.className = `show ${view.tone}`;
    this.#feedback.textContent = view.message;
  }
}
