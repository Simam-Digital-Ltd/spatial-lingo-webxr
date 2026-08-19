import { describe, expect, it } from 'vitest';

import { pickVoice, utteranceFor } from '../src/speech.js';

interface FakeVoice {
  name: string;
  lang: string;
  localService?: boolean;
}

const voice = (name: string, lang: string, localService?: boolean): FakeVoice => ({
  name,
  lang,
  localService,
});

describe('pickVoice', () => {
  it('prefers an exact language tag match', () => {
    const voices = [voice('a', 'en-GB'), voice('b', 'es-ES'), voice('c', 'es-MX')];
    expect(pickVoice(voices, 'es-MX')?.name).toBe('c');
  });

  it('falls back to any voice of the same base language', () => {
    const voices = [voice('a', 'en-US'), voice('b', 'es-AR')];
    expect(pickVoice(voices, 'es')?.name).toBe('b');
  });

  it('matches a bare tag against itself', () => {
    expect(pickVoice([voice('a', 'es')], 'es')?.name).toBe('a');
  });

  it('tolerates underscore tags and mixed case', () => {
    // Some platforms report es_ES rather than es-ES.
    expect(pickVoice([voice('a', 'ES_es')], 'es-ES')?.name).toBe('a');
  });

  it('prefers a local voice over a network one', () => {
    const voices = [voice('remote', 'es-ES', false), voice('local', 'es-ES', true)];
    expect(pickVoice(voices, 'es-ES')?.name).toBe('local');
  });

  it('returns null rather than mispronouncing in the wrong language', () => {
    // Speaking Spanish with an English voice sounds like a bug in the app.
    // The caller is expected to hide the control instead.
    expect(pickVoice([voice('a', 'en-US')], 'es')).toBeNull();
    expect(pickVoice([], 'es')).toBeNull();
  });

  it('does not treat a language prefix as a match', () => {
    // 'est' (Estonian) starts with 'es' as a string but is not Spanish.
    expect(pickVoice([voice('a', 'est')], 'es')).toBeNull();
  });
});

describe('utteranceFor', () => {
  it('includes the article, because the gender is part of the word', () => {
    expect(
      utteranceFor({
        label: 'table',
        word: 'mesa',
        article: 'la',
        phonetic: 'MEH-sah',
        exampleSentence: 'El libro esta sobre la mesa.',
      }),
    ).toBe('la mesa');
  });

  it('speaks the bare word when the pack has no article', () => {
    expect(
      utteranceFor({
        label: 'table',
        word: 'pöytä',
        article: '',
        phonetic: 'PUH-yta',
        exampleSentence: '',
      }),
    ).toBe('pöytä');
  });
});
