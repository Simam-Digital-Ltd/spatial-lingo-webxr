import { loadPack, type LessonPack } from '@spatial-lingo/core';
import { describe, expect, it } from 'vitest';

import starterPack from '@spatial-lingo/core/data/starter-pack.es.json' with { type: 'json' };
import { describeBlindSpots, describeMatch } from '../src/camera-ui.js';

const pack: LessonPack = loadPack(starterPack);

describe('describeMatch', () => {
  it('shows a pack word as itself', () => {
    expect(describeMatch({ packLabel: 'table', detectorLabel: 'dining table', score: 0.9 }, pack)).toBe(
      'table',
    );
  });

  // "not in this pack" alone reads like a failure. Naming what was actually
  // seen reads like a working camera and an incomplete lesson — the truth.
  it('names what it saw when the pack has no word for it', () => {
    const text = describeMatch({ packLabel: null, detectorLabel: 'giraffe', score: 0.9 }, pack);
    expect(text).toContain('giraffe');
    expect(text).toContain('not in this pack yet');
  });
});

describe('describeBlindSpots', () => {
  it('lists what this model structurally cannot see', () => {
    const note = describeBlindSpots(pack);
    expect(note).not.toBeNull();
    expect(note).toContain('window');
    expect(note).toContain('lamp');
  });

  it('names nothing the model can find', () => {
    expect(describeBlindSpots(pack)).not.toContain('couch');
  });

  // So a future pack whose words are all detectable does not carry a stale
  // caveat about limits it does not have.
  it('is null when every word in the pack is detectable', () => {
    const detectableOnly: LessonPack = loadPack({
      language: 'es',
      languageName: 'Spanish',
      entries: [
        {
          label: 'bed',
          word: 'cama',
          article: 'la',
          phonetic: 'KAH-mah',
          exampleSentence: 'La cama es grande.',
        },
      ],
    });
    expect(describeBlindSpots(detectableOnly)).toBeNull();
  });
});
