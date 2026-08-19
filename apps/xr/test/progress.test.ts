import { loadPack, type LessonPack } from '@spatial-lingo/core';
import { describe, expect, it } from 'vitest';

import { ProgressStore, parseProgress, serializeProgress } from '../src/progress.js';

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

describe('parseProgress', () => {
  it('round-trips through serializeProgress', () => {
    const stored = serializeProgress(pack, ['table', 'couch']);
    expect(parseProgress(stored, pack)).toEqual(['table', 'couch']);
  });

  it('returns nothing for absent, empty or corrupt storage', () => {
    expect(parseProgress(null, pack)).toEqual([]);
    expect(parseProgress('', pack)).toEqual([]);
    expect(parseProgress('{not json', pack)).toEqual([]);
    expect(parseProgress('null', pack)).toEqual([]);
    expect(parseProgress('[]', pack)).toEqual([]);
    expect(parseProgress('"table"', pack)).toEqual([]);
  });

  it('refuses progress stored under a different language', () => {
    // Restoring Spanish words into a French pack would credit the learner
    // with words they have never been shown.
    const stored = JSON.stringify({ language: 'fr', learned: ['table'] });
    expect(parseProgress(stored, pack)).toEqual([]);
  });

  it('drops labels the pack no longer contains', () => {
    const stored = JSON.stringify({ language: 'es', learned: ['table', 'helicopter'] });
    expect(parseProgress(stored, pack)).toEqual(['table']);
  });

  it('drops duplicates and non-strings', () => {
    const stored = JSON.stringify({ language: 'es', learned: ['table', 'table', 7, null] });
    expect(parseProgress(stored, pack)).toEqual(['table']);
  });
});

/** In-memory `Storage` good enough for the store's three calls. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('ProgressStore', () => {
  it('saves and loads', () => {
    const store = new ProgressStore(pack, fakeStorage());
    store.save(['couch']);
    expect(store.load()).toEqual(['couch']);
  });

  it('clears', () => {
    const storage = fakeStorage();
    const store = new ProgressStore(pack, storage);
    store.save(['couch']);
    store.clear();
    expect(store.load()).toEqual([]);
  });

  it('is inert without storage rather than throwing', () => {
    // Safari private browsing and blocked third-party contexts both make
    // localStorage access throw. Losing progress is acceptable; taking the
    // whole app down during boot is not.
    const store = new ProgressStore(pack, null);
    expect(() => store.save(['table'])).not.toThrow();
    expect(() => store.clear()).not.toThrow();
    expect(store.load()).toEqual([]);
  });

  it('survives a storage that throws on every call', () => {
    const hostile: Storage = {
      length: 0,
      clear: () => {
        throw new Error('nope');
      },
      getItem: () => {
        throw new Error('nope');
      },
      key: () => {
        throw new Error('nope');
      },
      removeItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const store = new ProgressStore(pack, hostile);
    expect(() => store.save(['table'])).not.toThrow();
    expect(store.load()).toEqual([]);
  });
});
