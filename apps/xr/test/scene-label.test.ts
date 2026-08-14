import { describe, expect, it } from 'vitest';
import type { LessonPack } from '@spatial-lingo/core';
import { resolveLessonTarget } from '../src/systems/scene-label.js';

const pack: LessonPack = {
  language: 'es',
  languageName: 'Spanish',
  entries: [
    { label: 'table', word: 'mesa', article: 'la', phonetic: 'MEH-sah', exampleSentence: 'La mesa es grande.' },
    { label: 'couch', word: 'sofá', article: 'el', phonetic: 'so-FAH', exampleSentence: 'El sofá es cómodo.' },
  ],
};

describe('resolveLessonTarget', () => {
  it('resolves a bounded mesh with a known label', () => {
    expect(resolveLessonTarget(true, 'table', pack)).toEqual({ label: 'table', word: 'mesa' });
  });

  it('rejects a bounded mesh with an unknown label', () => {
    expect(resolveLessonTarget(true, 'lamp', pack)).toBeNull();
  });

  it('rejects a non-bounded mesh even with a known label (the room-shell "global mesh" case)', () => {
    expect(resolveLessonTarget(false, 'table', pack)).toBeNull();
  });

  it('rejects an empty label', () => {
    expect(resolveLessonTarget(true, '', pack)).toBeNull();
  });

  it('rejects a non-string label', () => {
    expect(resolveLessonTarget(true, 42, pack)).toBeNull();
    expect(resolveLessonTarget(true, null, pack)).toBeNull();
    expect(resolveLessonTarget(true, undefined, pack)).toBeNull();
  });

  it('rejects when no pack is loaded', () => {
    expect(resolveLessonTarget(true, 'table', null)).toBeNull();
  });
});
