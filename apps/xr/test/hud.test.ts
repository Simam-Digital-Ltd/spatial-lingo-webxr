import { LessonMachine, loadPack, type LessonPack } from '@spatial-lingo/core';
import { describe, expect, it } from 'vitest';

import type { Capabilities } from '../src/capabilities.js';
import { describeDevice, describeFeedback, describeProgress } from '../src/hud.js';

const pack: LessonPack = loadPack({
  language: 'es',
  languageName: 'Spanish',
  entries: [
    {
      label: 'table',
      word: 'mesa',
      article: 'la',
      phonetic: 'MEH-sah',
      exampleSentence: 'El libro esta sobre la mesa.',
    },
    {
      label: 'couch',
      word: 'sofa',
      article: 'el',
      phonetic: 'so-FAH',
      exampleSentence: 'El gato duerme en el sofa.',
    },
  ],
});

function machineOn(label: string): LessonMachine {
  const machine = new LessonMachine(pack);
  machine.targetLabel(label);
  machine.beginListening();
  return machine;
}

describe('describeFeedback', () => {
  it('says nothing outside the feedback phase', () => {
    const machine = machineOn('table');
    expect(describeFeedback(machine.state)).toEqual({
      tone: 'none',
      message: '',
      sentence: null,
    });
  });

  it('reports a correct answer with its example sentence', () => {
    const machine = machineOn('table');
    machine.submitAttempt('mesa');
    const view = describeFeedback(machine.state);
    expect(view.tone).toBe('correct');
    expect(view.sentence).toBe('El libro esta sobre la mesa.');
  });

  it('never leaks the answer while tries remain', () => {
    const machine = machineOn('table');
    machine.submitAttempt('completely wrong');
    const view = describeFeedback(machine.state);
    expect(view.tone).toBe('wrong');
    expect(view.message).not.toContain('mesa');
    expect(view.message).toContain('2 tries left');
  });

  it('reveals the answer once the last try is spent', () => {
    const machine = machineOn('table');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (machine.state.phase === 'feedback') machine.dismissFeedback();
      if (machine.state.phase !== 'listening') break;
      machine.submitAttempt('completely wrong');
    }
    const view = describeFeedback(machine.state);
    expect(view.tone).toBe('wrong');
    expect(view.message).toContain('mesa');
  });

  it('singularises the last remaining try', () => {
    const machine = machineOn('table');
    machine.submitAttempt('nope');
    machine.dismissFeedback();
    machine.submitAttempt('nope');
    expect(describeFeedback(machine.state).message).toContain('1 try left');
  });

  it('distinguishes a near miss from a wrong answer', () => {
    const machine = machineOn('table');
    // One transposed character: close enough to score `close`, not `correct`.
    machine.submitAttempt('mesaa');
    const view = describeFeedback(machine.state);
    expect(view.tone).toBe('close');
    expect(view.sentence).toBeNull();
  });
});

describe('describeProgress', () => {
  it('starts empty at tier 0', () => {
    const view = describeProgress(0, 13);
    expect(view.tier).toBe(0);
    expect(view.percent).toBe(0);
    expect(view.note).toContain('1 more');
  });

  it('fills to 100% and stops growing at the final tier', () => {
    const view = describeProgress(10, 13);
    expect(view.tier).toBe(4);
    expect(view.percent).toBe(100);
    expect(view.note).toContain('fully grown');
  });

  it('stays at 100% past the final threshold', () => {
    expect(describeProgress(13, 13).percent).toBe(100);
  });

  /**
   * The bar measures the current tier's band, not the whole run. Crossing into
   * a new tier must reset it towards empty rather than carrying the old fill
   * across, or the bar and the tree disagree about what just happened.
   */
  it('resets towards empty on entering a new tier', () => {
    const justBefore = describeProgress(2, 13);
    const justAfter = describeProgress(3, 13);
    expect(justAfter.tier).toBe(justBefore.tier + 1);
    expect(justAfter.percent).toBeLessThan(justBefore.percent);
  });

  it('never reports a percentage outside 0–100', () => {
    for (let learned = 0; learned <= 40; learned++) {
      const view = describeProgress(learned, 13);
      expect(view.percent).toBeGreaterThanOrEqual(0);
      expect(view.percent).toBeLessThanOrEqual(100);
    }
  });

  it('reports the tier the tree will actually render', () => {
    expect(describeProgress(1, 13).tier).toBe(1);
    expect(describeProgress(3, 13).tier).toBe(2);
    expect(describeProgress(6, 13).tier).toBe(3);
  });
});

describe('describeDevice', () => {
  const none: Capabilities = {
    cameraAccess: false,
    meshDetection: false,
    planeDetection: false,
    handTracking: false,
    speechRecognition: false,
    immersiveAR: false,
  };

  it('offers no XR route on a plain browser', () => {
    const view = describeDevice(none);
    expect(view.canEnterXR).toBe(false);
    expect(view.headline).toMatch(/browser/i);
  });

  it('never describes the browser tier as degraded', () => {
    // The welcome card is most visitors' first impression, and Tier 4 is the
    // path most of them are on. Apologising for it there would be wrong.
    const view = describeDevice(none);
    expect(`${view.headline} ${view.detail}`).not.toMatch(
      /limited|degraded|unsupported|unfortunately|sorry/i,
    );
  });

  it('offers the XR route on a headset without mesh detection', () => {
    const view = describeDevice({ ...none, immersiveAR: true });
    expect(view.canEnterXR).toBe(true);
    expect(view.detail).toMatch(/stand-in/i);
  });

  it('promises the visitor their own room only when mesh detection is granted', () => {
    const withMesh = describeDevice({ ...none, immersiveAR: true, meshDetection: true });
    expect(withMesh.canEnterXR).toBe(true);
    expect(withMesh.detail).toMatch(/your own room/i);

    const withoutMesh = describeDevice({ ...none, immersiveAR: true });
    expect(withoutMesh.detail).not.toMatch(/your own room/i);
  });
});
