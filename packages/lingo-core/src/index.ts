export type { LessonPack, SemanticLabel, VocabularyEntry } from './types.js';
export { findEntry, loadPack } from './vocabulary.js';
export type { AttemptResult, AttemptVerdict } from './scoring.js';
export { normalise, scoreAttempt } from './scoring.js';
export type { LessonMachineOptions, LessonPhase, LessonState } from './machine.js';
export { LessonMachine } from './machine.js';
