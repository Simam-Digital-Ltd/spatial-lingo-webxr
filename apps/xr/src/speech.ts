import type { LessonPack, VocabularyEntry } from '@spatial-lingo/core';

/**
 * Speaking and listening, using only what the browser already ships.
 *
 * The Unity original is a *speaking* exercise: you say the word and Wit.ai
 * transcribes it. This port made you type, which is the single largest
 * divergence from the thing it is a port of. `SpeechRecognition` and
 * `speechSynthesis` close most of that gap with no API key, no server, and no
 * bundle weight — which is why they come before the hosted-service work in
 * `docs/roadmap/00-google-stack.md` rather than after it.
 *
 * Cloud Text-to-Speech would give better, more consistent voices, and the
 * roadmap plans to pre-render them at build time. This is the version that
 * ships today for nothing.
 *
 * Everything here is feature-detected. Neither API is universally implemented
 * — Safari's recognition support has historically differed from Chrome's, and
 * the Quest browser is unverified — so callers get `false` from `isAvailable`
 * and are expected to hide the control rather than show one that does nothing.
 */

/** The constructor, under either its standard or its prefixed name. */
type RecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechWindow {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  speechSynthesis?: SpeechSynthesis;
}

function recognitionConstructor(win: SpeechWindow): RecognitionConstructor | null {
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/**
 * Pick the best available voice for a language tag.
 *
 * Browsers ship wildly different voice lists, and `speechSynthesis` will
 * happily read Spanish in an English voice if asked for a language it has no
 * voice for — which sounds like a bug in the app rather than a gap in the
 * platform. Preferring an exact tag, then the base language, then nothing at
 * all, makes the "no suitable voice" case explicit so the caller can stay
 * quiet instead of mispronouncing the word it is teaching.
 *
 * Pure, so the matching rules are tested without a browser.
 */
export function pickVoice<T extends { lang: string; localService?: boolean }>(
  voices: readonly T[],
  language: string,
): T | null {
  const wanted = language.toLowerCase();
  const base = wanted.split('-')[0] ?? wanted;

  const exact = voices.filter((voice) => voice.lang.toLowerCase().replace('_', '-') === wanted);
  const sameLanguage = voices.filter((voice) => {
    const tag = voice.lang.toLowerCase().replace('_', '-');
    return tag === base || tag.startsWith(`${base}-`);
  });

  const candidates = exact.length > 0 ? exact : sameLanguage;
  if (candidates.length === 0) return null;

  // A local voice avoids a network round trip and keeps working offline.
  return candidates.find((voice) => voice.localService === true) ?? candidates[0] ?? null;
}

/**
 * What to read aloud for an entry.
 *
 * The article is included because "la mesa" is what a learner needs to
 * memorise — the gender is part of the word in a way that `mesa` alone hides.
 */
export function utteranceFor(entry: VocabularyEntry): string {
  return entry.article ? `${entry.article} ${entry.word}` : entry.word;
}

/** Speaks vocabulary words in the pack's language. */
export class Speaker {
  readonly #language: string;
  readonly #synth: SpeechSynthesis | null;
  #voice: SpeechSynthesisVoice | null = null;

  constructor(pack: LessonPack, win: SpeechWindow = window as unknown as SpeechWindow) {
    this.#language = pack.language;
    this.#synth = win.speechSynthesis ?? null;

    if (!this.#synth) return;
    // The voice list is populated asynchronously in most browsers and is empty
    // on the first synchronous read, so refresh on the change event too.
    this.#refreshVoice();
    this.#synth.addEventListener?.('voiceschanged', () => this.#refreshVoice());
  }

  /** Whether there is a synthesiser and a voice that speaks the language. */
  isAvailable(): boolean {
    return this.#synth !== null && this.#voice !== null;
  }

  speak(entry: VocabularyEntry): void {
    const synth = this.#synth;
    if (!synth || !this.#voice) return;
    // Cancel first: tapping two labels quickly should say the second word, not
    // queue it behind the first.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(utteranceFor(entry));
    utterance.voice = this.#voice;
    utterance.lang = this.#voice.lang;
    // Slightly under normal pace. This is a word being taught, not read.
    utterance.rate = 0.9;
    synth.speak(utterance);
  }

  #refreshVoice(): void {
    const voices = this.#synth?.getVoices() ?? [];
    this.#voice = pickVoice(voices, this.#language);
  }
}

export type ListenerState = 'idle' | 'listening';

/**
 * One-shot speech recognition in the pack's language.
 *
 * Single-shot rather than continuous: the learner presses a button, says one
 * word, and gets scored. A continuously open microphone on a public demo is a
 * different privacy conversation, and not one this needs to have.
 */
export class Listener {
  readonly #language: string;
  readonly #construct: RecognitionConstructor | null;
  #active: SpeechRecognitionLike | null = null;

  constructor(pack: LessonPack, win: SpeechWindow = window as unknown as SpeechWindow) {
    this.#language = pack.language;
    this.#construct = recognitionConstructor(win);
  }

  isAvailable(): boolean {
    return this.#construct !== null;
  }

  get state(): ListenerState {
    return this.#active ? 'listening' : 'idle';
  }

  /**
   * Listen for one utterance.
   *
   * `onResult` receives the transcript; `onEnd` always fires, whether the
   * attempt produced a transcript, errored, or timed out, so the caller can
   * put its button back without tracking which of those happened.
   */
  start(onResult: (transcript: string) => void, onEnd: () => void): void {
    const Recognition = this.#construct;
    if (!Recognition || this.#active) return;

    const recognition = new Recognition();
    recognition.lang = this.#language;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (typeof transcript === 'string' && transcript.trim().length > 0) {
        onResult(transcript.trim());
      }
    };
    recognition.onerror = () => {
      // Denied permission, no speech, no microphone. The button resets via
      // onend and the learner can still type — no error state worth adding.
    };
    recognition.onend = () => {
      this.#active = null;
      onEnd();
    };

    this.#active = recognition;
    try {
      recognition.start();
    } catch {
      this.#active = null;
      onEnd();
    }
  }

  stop(): void {
    this.#active?.stop();
  }
}
