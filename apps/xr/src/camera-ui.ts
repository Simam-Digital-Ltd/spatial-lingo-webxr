import type { LessonPack } from '@spatial-lingo/core';

import {
  ObjectVision,
  describeVisionState,
  undetectableLabels,
  type VisionMatch,
  type VisionState,
} from './vision.js';

/**
 * The camera panel: the DOM half of Phase 3a.
 *
 * Split from `vision.ts` the same way `byok-ui.ts` is split from `gemini.ts`
 * — the rules and the wiring are testable in Node, the element handling is
 * not, and mixing them would make neither checkable.
 *
 * The panel is inert until opened. Nothing requests the camera, downloads a
 * model, or runs inference as a side effect of the page loading, and closing
 * the panel releases the camera rather than merely hiding the preview.
 */

/** Turn a match into the chip text a learner reads. */
export function describeMatch(match: VisionMatch, pack: LessonPack): string {
  if (match.packLabel === null) {
    // Naming what was seen is the point: "not in this pack" alone reads like a
    // failure, while "sofa — not in this pack yet" reads like a working
    // camera and an incomplete lesson, which is the truth.
    return `${match.detectorLabel} — not in this pack yet`;
  }
  const entry = pack.entries.find((candidate) => candidate.label === match.packLabel);
  return entry ? entry.label : match.packLabel;
}

/**
 * A one-line note about what this model structurally cannot see.
 *
 * Shown once, up front, rather than left for the learner to infer from
 * pointing at their window and getting nothing. Returns null when every word
 * in the pack is detectable, so a future pack does not carry a stale caveat.
 */
export function describeBlindSpots(pack: LessonPack): string | null {
  const missing = undetectableLabels(pack);
  if (missing.length === 0) return null;
  return `This model cannot recognise: ${missing.join(', ')}.`;
}

interface CameraElements {
  open: HTMLButtonElement;
  panel: HTMLElement;
  video: HTMLVideoElement;
  status: HTMLElement;
  matches: HTMLElement;
  stop: HTMLButtonElement;
  note: HTMLElement;
}

function elements(doc: Document): CameraElements | null {
  const open = doc.getElementById('camera-open');
  const panel = doc.getElementById('camera');
  const video = doc.getElementById('camera-video');
  const status = doc.getElementById('camera-status');
  const matches = doc.getElementById('camera-matches');
  const stop = doc.getElementById('camera-stop');
  const note = doc.getElementById('camera-note');

  if (
    !(open instanceof HTMLButtonElement) ||
    !panel ||
    !(video instanceof HTMLVideoElement) ||
    !status ||
    !matches ||
    !(stop instanceof HTMLButtonElement) ||
    !note
  ) {
    return null;
  }
  return { open, panel, video, status, matches, stop, note };
}

/** Wires the camera panel to an `ObjectVision`. */
export class CameraPanel {
  readonly #pack: LessonPack;
  readonly #elements: CameraElements | null;
  readonly #vision: ObjectVision;
  #onPick: ((label: string) => void) | null = null;
  #onState: ((state: VisionState) => void) | null = null;

  constructor(pack: LessonPack, doc: Document = document) {
    this.#pack = pack;
    this.#elements = elements(doc);
    this.#vision = new ObjectVision(
      pack,
      (state) => this.#renderState(state),
      (matches) => this.#renderMatches(matches),
    );

    const el = this.#elements;
    if (!el) return;

    // The control only exists if the API behind it does. A button that opens
    // a panel to say "unsupported" is worse than no button.
    if (!ObjectVision.isSupported()) return;
    el.open.hidden = false;

    const blindSpots = describeBlindSpots(pack);
    if (blindSpots) el.note.textContent = `${el.note.textContent?.trim()} ${blindSpots}`;

    el.open.addEventListener('click', () => void this.open());
    el.stop.addEventListener('click', () => this.close());
  }

  /** Notified when a learner taps a detected word they want the lesson for. */
  onPick(listener: (label: string) => void): void {
    this.#onPick = listener;
  }

  /** Notified on every lifecycle transition — used by the `?debug` readout. */
  onState(listener: (state: VisionState) => void): void {
    this.#onState = listener;
  }

  async open(): Promise<void> {
    const el = this.#elements;
    if (!el) return;
    el.panel.classList.add('active');
    await this.#vision.start(el.video);
  }

  close(): void {
    this.#vision.stop();
    this.#elements?.panel.classList.remove('active');
  }

  #renderState(state: VisionState): void {
    this.#onState?.(state);
    const el = this.#elements;
    if (!el) return;
    el.status.textContent = describeVisionState(state);
    // A dead end should not keep claiming to be a live camera panel.
    if (state === 'denied' || state === 'failed' || state === 'unsupported') {
      el.matches.replaceChildren();
    }
  }

  #renderMatches(matches: readonly VisionMatch[]): void {
    const el = this.#elements;
    if (!el) return;

    const chips = matches.map((match) => {
      const chip = document.createElement('li');
      chip.textContent = describeMatch(match, this.#pack);
      chip.className = match.packLabel === null ? 'unknown' : 'known';
      if (match.packLabel !== null) {
        const label = match.packLabel;
        chip.addEventListener('click', () => this.#onPick?.(label));
      }
      return chip;
    });

    el.matches.replaceChildren(...chips);
  }
}
