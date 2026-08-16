import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonMachine } from '../src/machine.js';
import { loadPack } from '../src/vocabulary.js';
import starter from '../data/starter-pack.es.json' with { type: 'json' };

const pack = loadPack(starter);
let machine: LessonMachine;

beforeEach(() => {
  machine = new LessonMachine(pack);
});

describe('LessonMachine', () => {
  it('starts idle with nothing learned', () => {
    expect(machine.state.phase).toBe('idle');
    expect(machine.state.entry).toBeNull();
    expect(machine.state.learnedLabels).toEqual([]);
  });

  it('presents a lesson for a known label', () => {
    expect(machine.targetLabel('table')).toBe(true);
    expect(machine.state.phase).toBe('presenting');
    expect(machine.state.entry?.word).toBe('mesa');
  });

  it('refuses an unknown label', () => {
    expect(machine.targetLabel('spaceship')).toBe(false);
    expect(machine.state.phase).toBe('idle');
  });

  it('refuses a new target while a lesson is running', () => {
    machine.targetLabel('table');
    expect(machine.targetLabel('couch')).toBe(false);
    expect(machine.state.entry?.word).toBe('mesa');
  });

  it('completes on a correct attempt and records the label', () => {
    machine.targetLabel('table');
    machine.beginListening();
    expect(machine.state.phase).toBe('listening');

    const result = machine.submitAttempt('mesa');
    expect(result.verdict).toBe('correct');
    expect(machine.state.phase).toBe('feedback');

    machine.dismissFeedback();
    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual(['table']);
  });

  it('returns to listening while attempts remain', () => {
    machine.targetLabel('table');
    machine.beginListening();
    machine.submitAttempt('ventana');
    expect(machine.state.attemptsRemaining).toBe(2);

    machine.dismissFeedback();
    expect(machine.state.phase).toBe('listening');
  });

  it('completes without learning after exhausting attempts', () => {
    machine.targetLabel('table');
    machine.beginListening();
    for (let i = 0; i < 3; i++) {
      machine.submitAttempt('ventana');
      machine.dismissFeedback();
    }
    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual([]);
  });

  it('does not record the same label twice', () => {
    for (const _ of [0, 1]) {
      machine.targetLabel('table');
      machine.beginListening();
      machine.submitAttempt('mesa');
      machine.dismissFeedback();
    }
    expect(machine.state.learnedLabels).toEqual(['table']);
  });

  it('throws when submitting an attempt outside listening', () => {
    machine.targetLabel('table');
    expect(() => machine.submitAttempt('mesa')).toThrow(/listening/);
  });

  it('throws when beginListening is called from feedback, leaving phase unchanged', () => {
    machine.targetLabel('table');
    machine.beginListening();
    machine.submitAttempt('ventana');
    expect(machine.state.phase).toBe('feedback');

    expect(() => machine.beginListening()).toThrow(/presenting/);
    expect(machine.state.phase).toBe('feedback');
  });

  it('completes the full correct-answer path via dismissFeedback', () => {
    machine.targetLabel('table');
    machine.beginListening();
    machine.submitAttempt('mesa');
    machine.dismissFeedback();

    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual(['table']);
  });

  it('does not let a caller corrupt internal state through the state snapshot', () => {
    machine.targetLabel('table');
    const snapshot = machine.state;
    snapshot.entry!.word = 'corrupted';

    expect(machine.state.entry?.word).toBe('mesa');
  });

  it('notifies subscribers and can unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = machine.subscribe(listener);

    machine.targetLabel('table');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    machine.beginListening();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
