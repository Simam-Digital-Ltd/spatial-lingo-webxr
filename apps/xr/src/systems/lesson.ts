import { createSystem } from '@iwsdk/core';
import {
  LessonMachine,
  progressionFor,
  type LessonPack,
  type LessonState,
  type SemanticLabel,
} from '@spatial-lingo/core';

/**
 * Select a target and begin listening, guarding against `LessonMachine`'s
 * out-of-phase throws.
 *
 * `targetLabel` never throws — it returns `false` when the machine is busy
 * (mid-lesson) or the label has no vocabulary entry — but `beginListening`
 * throws if called from any phase other than `presenting`. Calling it only
 * when `targetLabel` just returned `true` keeps that invariant: a successful
 * `targetLabel` call always leaves the machine in `presenting`, and nothing
 * else runs synchronously in between to change that.
 *
 * Kept as a standalone function (no System, no World) so it is testable
 * against a real `LessonMachine` without any IWSDK scaffolding.
 */
export function selectTargetSafely(machine: LessonMachine, label: SemanticLabel): boolean {
  if (!machine.targetLabel(label)) return false;
  machine.beginListening();
  return true;
}

/**
 * Submit an attempt, but only while the machine is actually `listening`.
 *
 * `submitAttempt` throws outside that phase — most importantly, if a second
 * `Enter` press lands while `dismiss()`'s post-feedback timeout is still
 * pending, the machine is already in `feedback` and would throw without this
 * guard. Returns whether the attempt was actually submitted, so callers can
 * decide whether to schedule a dismiss timer.
 */
export function submitAttemptSafely(machine: LessonMachine, spoken: string): boolean {
  if (machine.state.phase !== 'listening') return false;
  machine.submitAttempt(spoken);
  return true;
}

/**
 * Dismiss feedback, but only while the machine is actually in `feedback`.
 *
 * `dismissFeedback` throws outside that phase. This matters because the
 * dismiss timeout in `main.ts` is a plain `setTimeout` with no cancellation:
 * if the phase has already moved on (e.g. a rapid click sequence drove
 * another transition first), calling this again must be a safe no-op rather
 * than an uncaught throw that would break the page.
 */
export function dismissFeedbackSafely(machine: LessonMachine): boolean {
  if (machine.state.phase !== 'feedback') return false;
  machine.dismissFeedback();
  return true;
}

/**
 * Pure render: lesson state to the diagnostics readout's HTML.
 *
 * This is the raw machine state, shown in the corner behind `?debug` — the
 * learner-facing UI is built by `Hud` from the same state. Keeping a literal
 * dump of the state machine on screen is what made the phase-guard bugs in
 * `selectTargetSafely` and friends findable at all during the port.
 *
 * Testable without a DOM.
 */
export function renderLessonPanel(state: LessonState): string {
  const progression = progressionFor(state.learnedLabels.length);
  const lines: string[] = [
    `<strong>${state.entry?.word ?? '—'}</strong> (${state.entry?.label ?? 'no target'})`,
    `phase: ${state.phase}`,
    `attempts left: ${state.attemptsRemaining}`,
    `tree tier: ${progression.tier} (${state.learnedLabels.length} learned)`,
  ];
  if (state.lastResult) {
    lines.push(`last: ${state.lastResult.verdict} (${state.lastResult.similarity.toFixed(2)})`);
  }
  return lines.join('<br />');
}

/**
 * The only bridge between the XR layer and the game rules.
 *
 * All lesson logic lives in `@spatial-lingo/core` and is unit-tested in Node.
 * This system just forwards events in and renders state out — the thin-adapter
 * shape the migration guide argues for. The phase guards that keep it from
 * driving the machine into a throw live in the standalone functions above,
 * not here, so they can be unit-tested against a real `LessonMachine` without
 * touching IWSDK.
 */
export class LessonSystem extends createSystem({}) {
  readonly #listeners = new Set<(state: LessonState) => void>();
  #machine: LessonMachine | null = null;

  start(pack: LessonPack): void {
    const machine = new LessonMachine(pack);
    this.#machine = machine;
    machine.subscribe((state) => this.#render(state));
  }

  /** Selects a target and begins listening. Returns whether it took effect. */
  selectTarget(label: SemanticLabel): boolean {
    const machine = this.#machine;
    if (!machine) return false;
    return selectTargetSafely(machine, label);
  }

  /** Submits a typed attempt. Returns whether it was actually submitted. */
  submit(spoken: string): boolean {
    const machine = this.#machine;
    if (!machine) return false;
    return submitAttemptSafely(machine, spoken);
  }

  /** Dismisses feedback. Returns whether it was actually dismissed. */
  dismiss(): boolean {
    const machine = this.#machine;
    if (!machine) return false;
    return dismissFeedbackSafely(machine);
  }

  /** Subscribe to lesson state. Replays the current state immediately. */
  onState(listener: (state: LessonState) => void): void {
    this.#listeners.add(listener);
    const machine = this.#machine;
    if (machine) listener(machine.state);
  }

  #render(state: LessonState): void {
    for (const listener of this.#listeners) listener(state);
    const panel = document.getElementById('diagnostics');
    if (panel) panel.innerHTML = renderLessonPanel(state);
  }
}
