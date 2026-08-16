import type { LessonPack, SemanticLabel, VocabularyEntry } from './types.js';

function requireString(source: Record<string, unknown>, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context}: missing or empty "${key}"`);
  }
  return value;
}

function parseEntry(raw: unknown, index: number): VocabularyEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`entry ${index}: not an object`);
  }
  const source = raw as Record<string, unknown>;
  const context = `entry ${index}`;
  const label = requireString(source, 'label', context);
  const word = requireString(source, 'word', context);
  const phonetic = requireString(source, 'phonetic', context);
  const exampleSentence = requireString(source, 'exampleSentence', context);
  const article = source['article'];
  if (article !== null && typeof article !== 'string') {
    throw new Error(`${context}: "article" must be a string or null`);
  }
  return {
    label,
    word,
    article,
    phonetic,
    exampleSentence,
  };
}

/** Validate an untrusted object into a LessonPack. Throws on malformed input. */
export function loadPack(raw: unknown): LessonPack {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('pack: not an object');
  }
  const source = raw as Record<string, unknown>;
  const entries = source['entries'];
  if (!Array.isArray(entries)) {
    throw new Error('pack: "entries" must be an array');
  }
  return {
    language: requireString(source, 'language', 'pack'),
    languageName: requireString(source, 'languageName', 'pack'),
    entries: entries.map(parseEntry),
  };
}

/** Look up the vocabulary entry that teaches a given semantic label. */
export function findEntry(pack: LessonPack, label: SemanticLabel): VocabularyEntry | undefined {
  return pack.entries.find((entry) => entry.label === label);
}
