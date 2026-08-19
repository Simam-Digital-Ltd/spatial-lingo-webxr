import { progressionFor, type LessonPack, type LessonState } from '@spatial-lingo/core';

import { resolveTier, type Capabilities } from './capabilities.js';

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

/**
 * Whether it is safe to offer to say the word out loud.
 *
 * Playing the target word is the same as printing it: it hands over the
 * answer. `describeFeedback` is careful never to leak the word while tries
 * remain, and an audio button would walk straight around that. So the offer
 * only appears once the answer is already on screen — after a correct answer,
 * or after the last try has been spent and the word has been revealed.
 */
export function shouldOfferAudio(state: LessonState): boolean {
  if (!state.entry) return false;
  if (state.phase !== 'feedback' && state.phase !== 'complete') return false;
  if (state.lastResult?.verdict === 'correct') return true;
  return state.attemptsRemaining <= 0;
}

interface HudElements {
  lesson: HTMLElement;
  promptWord: HTMLElement;
  promptHint: HTMLElement;
  attempt: HTMLInputElement;
  submit: HTMLButtonElement;
  listen: HTMLButtonElement;
  speak: HTMLButtonElement;
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
  #placeholder = 'Type the word';
  #speakAvailable = false;

  constructor() {
    this.#elements = {
      lesson: mustFind('lesson'),
      promptWord: mustFind('prompt-word'),
      promptHint: mustFind('prompt-hint'),
      attempt: mustFind<HTMLInputElement>('attempt'),
      submit: mustFind<HTMLButtonElement>('submit'),
      listen: mustFind<HTMLButtonElement>('listen'),
      speak: mustFind<HTMLButtonElement>('speak'),
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

  /**
   * Reveal the microphone button and route it to `onListen`.
   *
   * Called only when speech recognition is actually available — the button
   * ships hidden, so a browser without the API simply never sees it.
   */
  enableListening(onListen: () => void): void {
    const { listen } = this.#elements;
    listen.hidden = false;
    listen.addEventListener('click', onListen);
  }

  /** Shows the microphone as open, or not. */
  setListening(listening: boolean): void {
    const { listen, attempt } = this.#elements;
    listen.classList.toggle('active', listening);
    listen.title = listening ? 'Listening…' : 'Say it instead';
    attempt.placeholder = listening ? 'Listening…' : this.#placeholder;
  }

  /**
   * Route the "hear it" button to `onSpeak`, and allow it to appear.
   *
   * Availability is recorded rather than acted on: `render` decides when the
   * button is actually shown, because offering audio too early gives away the
   * answer. See `shouldOfferAudio`.
   */
  enableSpeaking(onSpeak: () => void): void {
    this.#speakAvailable = true;
    this.#elements.speak.addEventListener('click', onSpeak);
  }

  /** Announces what the pack is called, for the placeholder copy. */
  setPack(pack: LessonPack): void {
    // Short enough to survive a 390 px portrait phone without ellipsis.
    this.#placeholder = `Type the ${pack.languageName} word`;
    this.#elements.attempt.placeholder = this.#placeholder;
  }

  render(state: LessonState): void {
    const {
      lesson,
      promptWord,
      promptHint,
      attempt,
      submit,
      listen,
      speak,
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
    listen.disabled = !listening;
    // Focusing the box on a phone opens the on-screen keyboard over the room.
    // Acceptable while typing is the only way in; revisit if that changes.
    if (listening) attempt.focus();

    speak.hidden = !(this.#speakAvailable && shouldOfferAudio(state));

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

export interface DeviceView {
  /** One-line verdict, shown in bold on the welcome card. */
  headline: string;
  /** What that means for what the visitor is about to do. */
  detail: string;
  /** Whether the welcome card should offer a "start in mixed reality" route. */
  canEnterXR: boolean;
}

/**
 * Explain, in the visitor's terms, which capability tier their device landed on.
 *
 * The tier numbers themselves are an implementation detail from the spec's
 * capability table, and they mean nothing to someone who just opened a link. So
 * this says what the device *can do* rather than what it scored, and it never
 * apologises for the browser tier — that path is the one most visitors will
 * take, and it is a complete experience, not a degraded one.
 */
export function describeDevice(capabilities: Capabilities): DeviceView {
  const tier = resolveTier(capabilities);

  if (tier === 4) {
    return {
      headline: 'Running in your browser',
      detail:
        'No headset needed. The room below is rendered live, and the whole lesson loop works with a mouse or a fingertip.',
      canEnterXR: false,
    };
  }

  if (tier === 3) {
    return {
      headline: 'Headset detected',
      detail:
        'Mixed reality is available, but this device does not report room geometry, so the headset view places stand-in objects around you instead of using your furniture.',
      canEnterXR: true,
    };
  }

  return {
    headline: 'Headset with room scan detected',
    detail:
      'You can explore here first, then step into mixed reality and the lesson objects will attach to your own room.',
    canEnterXR: true,
  };
}

/**
 * The welcome screen, which is also the boot screen.
 *
 * It is static markup in `index.html` rather than something built here, so it
 * paints on the first frame — well before the WebGL world is ready. Building
 * the world takes long enough on a cold load that an empty page in the meantime
 * reads as a broken link, and this way the visitor spends that time reading
 * what the project is. The start button stays disabled until `ready()` says
 * there is actually a room behind the card.
 */
export class WelcomeOverlay {
  readonly #root: HTMLElement | null;
  readonly #start: HTMLButtonElement | null;
  readonly #device: HTMLElement | null;
  #dismissed = false;

  constructor() {
    this.#root = document.getElementById('welcome');
    const start = document.getElementById('welcome-start');
    this.#start = start instanceof HTMLButtonElement ? start : null;
    this.#device = document.getElementById('welcome-device');
  }

  /**
   * Enable the card once the world is up, and say what the device can do.
   *
   * `onStart` fires when the visitor dismisses the card, so the caller can
   * focus the room or kick off anything that should wait for a real gesture.
   */
  ready(capabilities: Capabilities, onStart: () => void): void {
    const view = describeDevice(capabilities);
    if (this.#device) {
      this.#device.textContent = '';
      const headline = document.createElement('b');
      headline.textContent = view.headline;
      this.#device.append(headline, ` — ${view.detail}`);
    }

    if (this.#start) {
      this.#start.disabled = false;
      this.#start.textContent = view.canEnterXR ? 'Explore the room' : 'Start exploring';
      this.#start.addEventListener('click', () => {
        this.dismiss();
        onStart();
      });
      this.#start.focus();
    }

    // Escape is the conventional way out of a modal, and a visitor who has
    // already read the card should not have to aim at a button to get past it.
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.#dismissed) {
        this.dismiss();
        onStart();
      }
    });
  }

  dismiss(): void {
    if (this.#dismissed) return;
    this.#dismissed = true;
    const root = this.#root;
    if (!root) return;
    root.classList.add('gone');
    // Removed rather than left transparent: it covers the whole viewport, and
    // an invisible element that still exists is one CSS regression away from
    // swallowing every click in the room.
    setTimeout(() => root.remove(), 600);
  }
}
