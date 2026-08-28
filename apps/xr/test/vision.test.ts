import { loadPack, type LessonPack } from '@spatial-lingo/core';
import { describe, expect, it } from 'vitest';

import starterPack from '@spatial-lingo/core/data/starter-pack.es.json' with { type: 'json' };
import {
  DETECTOR_ALIASES,
  bestPackMatch,
  describeVisionState,
  packLabelFor,
  shouldRunInference,
  summariseDetections,
  toDetections,
  undetectableLabels,
  type Detection,
  type VisionState,
} from '../src/vision.js';

const pack: LessonPack = loadPack(starterPack);

describe('packLabelFor', () => {
  it('maps COCO class names onto the pack words they mean', () => {
    expect(packLabelFor('dining table', pack)).toBe('table');
    expect(packLabelFor('potted plant', pack)).toBe('plant');
    expect(packLabelFor('bed', pack)).toBe('bed');
  });

  // The pack teaches one word for the category, so every screen-ish class
  // resolves to it rather than to three different lessons.
  it('folds several detector classes onto one pack word', () => {
    expect(packLabelFor('tv', pack)).toBe('screen');
    expect(packLabelFor('laptop', pack)).toBe('screen');
    expect(packLabelFor('monitor', pack)).toBe('screen');
  });

  it('does not depend on the model labelling things in any particular case', () => {
    expect(packLabelFor('Dining Table', pack)).toBe('table');
    expect(packLabelFor('  TV  ', pack)).toBe('screen');
  });

  it('returns null for a class the pack does not teach', () => {
    expect(packLabelFor('giraffe', pack)).toBeNull();
    expect(packLabelFor('', pack)).toBeNull();
  });
});

describe('undetectableLabels', () => {
  // This is the honest limit worth asserting rather than discovering in a
  // demo: the detector's vocabulary and the pack's vocabulary only overlap
  // partly, and these words are structurally unreachable for this model.
  it('names the pack words this model can never find', () => {
    const undetectable = undetectableLabels(pack);
    expect(undetectable).toContain('window');
    expect(undetectable).toContain('wall');
    expect(undetectable).toContain('lamp');
    expect(undetectable).toContain('wall art');
  });

  it('does not list words the model can find', () => {
    const undetectable = undetectableLabels(pack);
    for (const detectable of ['table', 'couch', 'bed', 'plant', 'screen']) {
      expect(undetectable).not.toContain(detectable);
    }
  });

  it('covers every pack word, one way or the other', () => {
    const detectable = pack.entries
      .map((entry) => entry.label)
      .filter((label) => (DETECTOR_ALIASES[label]?.length ?? 0) > 0);
    expect(detectable.length + undetectableLabels(pack).length).toBe(pack.entries.length);
  });
});

describe('summariseDetections', () => {
  const detection = (label: string, score: number): Detection => ({ label, score });

  it('orders matches by confidence, best first', () => {
    const matches = summariseDetections(
      [detection('bed', 0.6), detection('dining table', 0.9)],
      pack,
    );
    expect(matches.map((match) => match.packLabel)).toEqual(['table', 'bed']);
  });

  it('drops anything under the confidence floor', () => {
    expect(summariseDetections([detection('bed', 0.2)], pack)).toEqual([]);
  });

  it('honours a caller-supplied floor', () => {
    expect(summariseDetections([detection('bed', 0.6)], pack, 0.8)).toEqual([]);
    expect(summariseDetections([detection('bed', 0.6)], pack, 0.4)).toHaveLength(1);
  });

  // The miss is more interesting than the hit: it tells the learner the
  // camera works and the word is simply not in this lesson yet.
  it('keeps things the model saw but the pack does not teach', () => {
    const matches = summariseDetections([detection('giraffe', 0.9)], pack);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.packLabel).toBeNull();
    expect(matches[0]?.detectorLabel).toBe('giraffe');
  });

  it('collapses repeats of the same pack word into one row', () => {
    const matches = summariseDetections(
      [detection('chair', 0.9), detection('couch', 0.8), detection('bench', 0.7)],
      pack,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.packLabel).toBe('couch');
  });

  it('collapses repeats of the same unknown class too', () => {
    const matches = summariseDetections(
      [detection('giraffe', 0.9), detection('giraffe', 0.8)],
      pack,
    );
    expect(matches).toHaveLength(1);
  });

  it('does not mutate the detections it was given', () => {
    const detections = [detection('bed', 0.6), detection('dining table', 0.9)];
    summariseDetections(detections, pack);
    expect(detections.map((item) => item.label)).toEqual(['bed', 'dining table']);
  });

  it('returns nothing for an empty frame', () => {
    expect(summariseDetections([], pack)).toEqual([]);
  });
});

describe('bestPackMatch', () => {
  it('skips unknown classes to find a teachable word', () => {
    const matches = summariseDetections(
      [{ label: 'giraffe', score: 0.99 }, { label: 'bed', score: 0.7 }],
      pack,
    );
    expect(bestPackMatch(matches)?.packLabel).toBe('bed');
  });

  it('is null when nothing in frame is in the pack', () => {
    expect(bestPackMatch(summariseDetections([{ label: 'giraffe', score: 0.9 }], pack))).toBeNull();
  });
});

// The MediaPipe result shape is nested and optional at every level, and is
// the most likely thing to break on a library upgrade — so it is normalised
// in one tested place rather than destructured at the call site.
describe('toDetections', () => {
  it('flattens the top category of each detection', () => {
    expect(
      toDetections({
        detections: [
          { categories: [{ categoryName: 'bed', score: 0.8 }] },
          { categories: [{ categoryName: 'tv', score: 0.6 }] },
        ],
      }),
    ).toEqual([
      { label: 'bed', score: 0.8 },
      { label: 'tv', score: 0.6 },
    ]);
  });

  it('survives every level of the shape being absent', () => {
    expect(toDetections({})).toEqual([]);
    expect(toDetections({ detections: [] })).toEqual([]);
    expect(toDetections({ detections: [{}] })).toEqual([]);
    expect(toDetections({ detections: [{ categories: [] }] })).toEqual([]);
  });

  it('drops a category missing a name or a score rather than inventing one', () => {
    expect(toDetections({ detections: [{ categories: [{ score: 0.9 }] }] })).toEqual([]);
    expect(toDetections({ detections: [{ categories: [{ categoryName: 'bed' }] }] })).toEqual([]);
  });
});

describe('shouldRunInference', () => {
  it('always runs the first pass', () => {
    expect(shouldRunInference(0, null)).toBe(true);
  });

  it('refuses until the interval has elapsed', () => {
    expect(shouldRunInference(1000, 900, 400)).toBe(false);
    expect(shouldRunInference(1300, 1000, 400)).toBe(false);
    expect(shouldRunInference(1500, 1000, 400)).toBe(true);
  });

  it('runs exactly on the boundary', () => {
    expect(shouldRunInference(1400, 1000, 400)).toBe(true);
  });
});

describe('describeVisionState', () => {
  // Each state has a different cause and a different fix; a single "camera
  // unavailable" line would hide which one happened.
  it('says something distinct for every state', () => {
    const states: VisionState[] = [
      'idle',
      'requesting-camera',
      'loading-model',
      'running',
      'unsupported',
      'denied',
      'failed',
    ];
    const messages = states.map(describeVisionState);
    expect(new Set(messages).size).toBe(states.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });

  it('tells the learner the rest of the app still works when the camera is refused', () => {
    expect(describeVisionState('denied')).toContain('still works');
  });
});
