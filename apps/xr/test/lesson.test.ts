import { describe, expect, it } from 'vitest';
import { LessonMachine, type LessonPack } from '@spatial-lingo/core';
import {
  dismissFeedbackSafely,
  renderLessonPanel,
  selectTargetSafely,
  submitAttemptSafely,
} from '../src/systems/lesson.js';

const pack: LessonPack = {
  language: 'es',
  languageName: 'Spanish',
  entries: [
    { label: 'table', word: 'mesa', article: 'la', phonetic: 'MEH-sah', exampleSentence: 'La mesa es grande.' },
    { label: 'couch', word: 'sofá', article: 'el', phonetic: 'so-FAH', exampleSentence: 'El sofá es cómodo.' },
  ],
};

describe('selectTargetSafely', () => {
  it('starts a lesson from idle and reaches listening', () => {
    const machine = new LessonMachine(pack);
    expect(selectTargetSafely(machine, 'table')).toBe(true);
    expect(machine.state.phase).toBe('listening');
    expect(machine.state.entry?.label).toBe('table');
  });

  it('rejects an unknown label without throwing', () => {
    const machine = new LessonMachine(pack);
    expect(selectTargetSafely(machine, 'lamp')).toBe(false);
    expect(machine.state.phase).toBe('idle');
  });

  it('does not restart a lesson already in progress', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    expect(selectTargetSafely(machine, 'couch')).toBe(false);
    expect(machine.state.entry?.label).toBe('table');
    expect(machine.state.phase).toBe('listening');
  });

  it('does not throw when selecting mid-feedback (rapid click guard)', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    machine.submitAttempt('nope');
    expect(machine.state.phase).toBe('feedback');
    expect(() => selectTargetSafely(machine, 'couch')).not.toThrow();
    expect(selectTargetSafely(machine, 'couch')).toBe(false);
  });

  it('can start a new lesson once the previous one completes', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    machine.submitAttempt('mesa');
    machine.dismissFeedback();
    expect(machine.state.phase).toBe('complete');
    expect(selectTargetSafely(machine, 'couch')).toBe(true);
    expect(machine.state.phase).toBe('listening');
  });
});

describe('submitAttemptSafely', () => {
  it('submits while listening', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    expect(submitAttemptSafely(machine, 'mesa')).toBe(true);
    expect(machine.state.phase).toBe('feedback');
    expect(machine.state.lastResult?.verdict).toBe('correct');
  });

  it('is a no-op before a target is selected (idle phase)', () => {
    const machine = new LessonMachine(pack);
    expect(() => submitAttemptSafely(machine, 'mesa')).not.toThrow();
    expect(submitAttemptSafely(machine, 'mesa')).toBe(false);
    expect(machine.state.phase).toBe('idle');
  });

  it('guards against a second submit landing during feedback (rapid Enter presses)', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'mesa');
    expect(machine.state.phase).toBe('feedback');
    expect(() => submitAttemptSafely(machine, 'mesa')).not.toThrow();
    expect(submitAttemptSafely(machine, 'mesa')).toBe(false);
  });
});

describe('dismissFeedbackSafely', () => {
  it('returns to listening on an incorrect attempt with attempts remaining', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'nope');
    expect(dismissFeedbackSafely(machine)).toBe(true);
    expect(machine.state.phase).toBe('listening');
    expect(machine.state.attemptsRemaining).toBe(2);
  });

  it('completes on a correct attempt', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'mesa');
    expect(dismissFeedbackSafely(machine)).toBe(true);
    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual(['table']);
  });

  it('completes once attempts are exhausted', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'nope');
    dismissFeedbackSafely(machine);
    submitAttemptSafely(machine, 'nope');
    dismissFeedbackSafely(machine);
    submitAttemptSafely(machine, 'nope');
    expect(dismissFeedbackSafely(machine)).toBe(true);
    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual([]);
  });

  it('is a no-op outside the feedback phase (a stray or duplicate timeout)', () => {
    const machine = new LessonMachine(pack);
    expect(() => dismissFeedbackSafely(machine)).not.toThrow();
    expect(dismissFeedbackSafely(machine)).toBe(false);

    selectTargetSafely(machine, 'table');
    expect(dismissFeedbackSafely(machine)).toBe(false);
    expect(machine.state.phase).toBe('listening');
  });

  it('guards a duplicate dismiss when two timers land back to back', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'mesa');
    expect(dismissFeedbackSafely(machine)).toBe(true);
    expect(machine.state.phase).toBe('complete');
    // A second, stale timeout firing after the first must not throw.
    expect(() => dismissFeedbackSafely(machine)).not.toThrow();
    expect(dismissFeedbackSafely(machine)).toBe(false);
  });
});

describe('renderLessonPanel', () => {
  it('renders the idle state with no active entry', () => {
    const machine = new LessonMachine(pack);
    const html = renderLessonPanel(machine.state);
    expect(html).toContain('no target');
    expect(html).toContain('phase: idle');
  });

  it('renders the active word, phase, attempts, and tier', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    const html = renderLessonPanel(machine.state);
    expect(html).toContain('mesa');
    expect(html).toContain('table');
    expect(html).toContain('phase: listening');
    expect(html).toContain('attempts left: 3');
    expect(html).toContain('tree tier: 0 (0 learned)');
  });

  it('includes the last result once an attempt has been scored', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'mesa');
    const html = renderLessonPanel(machine.state);
    expect(html).toContain('last: correct (1.00)');
  });

  it('reflects an incremented tier after completing a lesson', () => {
    const machine = new LessonMachine(pack);
    selectTargetSafely(machine, 'table');
    submitAttemptSafely(machine, 'mesa');
    dismissFeedbackSafely(machine);
    const html = renderLessonPanel(machine.state);
    expect(html).toContain('tree tier: 1 (1 learned)');
  });
});
