import { describe, expect, it } from 'vitest';
import { findEntry, loadPack } from '../src/vocabulary.js';
import starter from '../data/starter-pack.es.json' with { type: 'json' };

describe('loadPack', () => {
  it('accepts the bundled starter pack', () => {
    const pack = loadPack(starter);
    expect(pack.language).toBe('es');
    expect(pack.entries.length).toBeGreaterThan(0);
  });

  it('rejects a pack with no language', () => {
    expect(() => loadPack({ entries: [] })).toThrow(/language/);
  });

  it('rejects an entry missing a word', () => {
    const bad = { language: 'es', languageName: 'Spanish', entries: [{ label: 'table' }] };
    expect(() => loadPack(bad)).toThrow(/word/);
  });
});

describe('findEntry', () => {
  it('finds an entry by semantic label', () => {
    const pack = loadPack(starter);
    expect(findEntry(pack, 'table')?.word).toBe('mesa');
  });

  it('returns undefined for an unknown label', () => {
    const pack = loadPack(starter);
    expect(findEntry(pack, 'spaceship')).toBeUndefined();
  });
});
