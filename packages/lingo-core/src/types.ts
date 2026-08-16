/** A WebXR `XRMesh.semanticLabel` value, e.g. 'table', 'couch', 'window'. */
export type SemanticLabel = string;

export interface VocabularyEntry {
  /** The scene-understanding label this word teaches. */
  label: SemanticLabel;
  /** The target-language word, e.g. 'mesa'. */
  word: string;
  /** Definite article, or null for languages/words without one. */
  article: string | null;
  /** Rough pronunciation hint shown to the learner. */
  phonetic: string;
  /** A short sentence using the word in context. */
  exampleSentence: string;
}

export interface LessonPack {
  /** BCP-47 language subtag, e.g. 'es'. */
  language: string;
  /** Human-readable language name, e.g. 'Spanish'. */
  languageName: string;
  entries: VocabularyEntry[];
}
