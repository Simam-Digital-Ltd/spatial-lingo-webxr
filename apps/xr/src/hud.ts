import { progressionFor, type LessonPack, type LessonState } from '@spatial-lingo/core';

/**
 * The 2D heads-up display: prompt card, attempt box, feedback, progress.
 *
 * Deliberately plain DOM rather than IWSDK's in-world `spatialUI`. On the
 * desktop tier there is no headset to render a world-space panel *to*, and a
 * flat HTML overlay is both cheaper and far more legible on a laptop screen.
 * The headset path gets the same information through the world-space word
 * labels instead.
 *
 * The formatting decisions live in exported pure functions so they can be
 * tested in Node without a DOM; the class below only pushes their output into
 * elements.
 */

export type FeedbackTone = 'correct' | 'close' | 'wrong' | 'none';

export interface FeedbackView {
  tone: FeedbackTone;
  message: string;
  /** Example sentence, shown only once the word has actually been got right. */
  sentence: string | null;
}

/**
 * Turn a lesson state into the feedback line.
 *
 * `attemptsRemaining` has already been decremented by `submitAttempt` when
 * this runs, so it is the count *after* the wrong answer — which is exactly
 * what the learner needs to be told.
 */
export function describeFeedback(state: LessonState): FeedbackView {
  const result = state.lastResult;
  if (!result || state.phase !== 'feedback') {
    return { tone: 'none', message: '', sentence: null };
  }

  if (result.verdict === 'correct') {
    return {
      tone: 'correct',
      message: 'Correct.',
      sentence: state.entry?.exampleSentence ?? null,
    };
  }

  const attemptsLeft = state.attemptsRemaining;
  if (result.verdict === 'close') {
    return {
      tone: 'close',
      message:
        attemptsLeft > 0
          ? `Very close — check the spelling. ${plural(attemptsLeft)} left.`
          : `Very close. The answer was "${state.entry?.word ?? ''}".`,
      sentence: null,
    };
  }

  return {
    tone: 'wrong',
    message:
      attemptsLeft > 0
        ? `Not quite. ${plural(attemptsLeft)} left.`
        : `The answer was "${state.entry?.word ?? ''}".`,
    sentence: null,
  };
}

function plural(count: number): string {
  return count === 1 ? '1 try' : `${count} tries`;
}

export interface ProgressView {
  learned: number;
  total: number;
  tier: number;
  /** Percentage of the way to the next tier, 0–100. 100 at the final tier. */
  percent: number;
  note: string;
}

/** Progress readout for `learned` words out of `total` placed targets. */
export function describeProgress(learned: number, total: number): ProgressView {
  const progression = progressionFor(learned);
  const remaining = progression.wordsToNextTier;

  if (remaining === null) {
    return {
      learned,
      total,
      tier: progression.tier,
      percent: 100,
      note: `Tree tier ${progression.tier} — fully grown`,
    };
  }

  // The bar fills across the current tier's band, not across the whole run.
  // "3 more words" is more motivating than "30% of the way to the end", and it
  // matches how the tree actually grows: one tier at a time.
  //
  // The band edges are walked out of `progressionFor` rather than duplicated
  // here, so the bar can never disagree with the tree about where a tier ends.
  let bandStart = learned;
  while (bandStart > 0 && progressionFor(bandStart - 1).tier === progression.tier) {
    bandStart -= 1;
  }
  const bandEnd = learned + remaining;
  const span = Math.max(bandEnd - bandStart, 1);
  const percent = Math.min(Math.max(((learned - bandStart) / span) * 100, 0), 100);

  return {
    learned,
    total,
    tier: progression.tier,
    percent,
    note: `Tree tier ${progression.tier} — ${remaining} more to grow`,
  };
}

interface HudElements {
  lesson: HTMLElement;
  promptWord: HTMLElement;
  promptHint: HTMLElement;
  attempt: HTMLInputElement;
  submit: HTMLButtonElement;
  feedback: HTMLElement;
  hint: HTMLElement;
  learnedCount: HTMLElement;
  totalCount: HTMLElement;
  tierNote: HTMLElement;
  tierBar: HTMLElement;
}

function mustFind<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`[spatial-lingo] missing HUD element #${id}`);
  return element as T;
}

export class Hud {
  readonly #elements: HudElements;
  #total = 0;

  constructor() {
    this.#elements = {
      lesson: mustFind('lesson'),
      promptWord: mustFind('prompt-word'),
      promptHint: mustFind('prompt-hint'),
      attempt: mustFind<HTMLInputElement>('attempt'),
      submit: mustFind<HTMLButtonElement>('submit'),
      feedback: mustFind('feedback'),
      hint: mustFind('hint'),
      learnedCount: mustFind('learned-count'),
      totalCount: mustFind('total-count'),
      tierNote: mustFind('tier-note'),
      tierBar: mustFind('tier-bar'),
    };
  }

  /** How many targets the room actually placed — the denominator on screen. */
  setTotal(total: number): void {
    this.#total = total;
    this.#elements.totalCount.textContent = String(total);
  }

  /** Wires the attempt box and Check button to `onSubmit`. */
  bindInput(onSubmit: (text: string) => void): void {
    const { attempt, submit } = this.#elements;
    const fire = (): void => {
      const value = attempt.value.trim();
      if (value.length === 0) return;
      attempt.value = '';
      onSubmit(value);
    };
    attempt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') fire();
      // The canvas listens on window for orbit and selection. Without this,
      // every keystroke in the box would also reach those handlers.
      event.stopPropagation();
    });
    submit.addEventListener('click', fire);
    // Pointer events inside the panel must not reach the camera controller,
    // or selecting text in the input would spin the room.
    this.#elements.lesson.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  /** Announces what the pack is called, for the placeholder copy. */
  setPack(pack: LessonPack): void {
    // Short enough to survive a 390 px portrait phone without ellipsis.
    this.#elements.attempt.placeholder = `Type the ${pack.languageName} word`;
  }

  render(state: LessonState): void {
    const {
      lesson,
      promptWord,
      promptHint,
      attempt,
      submit,
      feedback,
      hint,
      learnedCount,
      tierNote,
      tierBar,
    } = this.#elements;

    const active = state.phase === 'presenting' || state.phase === 'listening' || state.phase === 'feedback';
    lesson.classList.toggle('active', active);
    hint.textContent = active
      ? 'Answer above, or click another object to switch'
      : 'Drag to look around · scroll to zoom · click an object to start';

    if (state.entry) {
      promptWord.textContent = state.entry.label;
      promptHint.textContent = `pronounced “${state.entry.phonetic}”`;
    }

    const listening = state.phase === 'listening';
    attempt.disabled = !listening;
    submit.disabled = !listening;
    if (listening) attempt.focus();

    const view = describeFeedback(state);
    feedback.classList.toggle('show', view.tone !== 'none');
    feedback.className = view.tone === 'none' ? '' : `show ${view.tone}`;
    feedback.textContent = view.message;
    if (view.sentence) {
      const sentence = document.createElement('span');
      sentence.className = 'sentence';
      sentence.textContent = view.sentence;
      feedback.append(sentence);
    }

    const progress = describeProgress(state.learnedLabels.length, this.#total);
    learnedCount.textContent = String(progress.learned);
    tierNote.textContent = progress.note;
    tierBar.style.width = `${progress.percent}%`;
  }
}

/** Fades out the boot overlay once there is something behind it to see. */
export function dismissBootOverlay(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 600);
}
