# Spatial Lingo WebXR — Phases 0–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, playable WebXR language lesson loop — walk into a room, IWSDK detects real furniture, Golly Gosh teaches you the word for it — with the game logic isolated in a dependency-free package.

**Architecture:** pnpm workspace. `packages/lingo-core` holds the lesson state machine as pure TypeScript with zero 3D dependencies, unit-tested in Node. `apps/xr` is a thin IWSDK ECS layer that drives it from WebXR scene understanding. A capability probe selects one of four degradation tiers so the app runs on a laptop as well as a Quest.

**Tech Stack:** TypeScript 5.7, pnpm 10, Vite 6, `@iwsdk/core@0.5.3` (ECS is `elics`, signals are `@preact/signals-core`, UI is `@pmndrs/uikit`), vitest 2, Vercel.

## Global Constraints

- **Pin exact dependency versions. No `^` or `~` ranges.** IWSDK is 0.x with 14 releases; ranges will break the build silently.
- **`packages/lingo-core` must never import `three`, `@iwsdk/*`, or any DOM global.** Enforced by a test (Task 4) and a lint rule. This is the spec's load-bearing boundary.
- **All four capability tiers must stay playable.** Tier 4 (desktop, no headset) is non-negotiable — a reviewer opening the repo on a laptop must see it run.
- **No API keys in the client bundle, ever.** Phases 0–3 ship a static lesson pack and no network AI calls at all.
- **IWSDK `update(delta, time)` takes seconds**, not milliseconds — three.js `Clock` convention, same as Unity's `Time.deltaTime`.
- **Reference tree is read-only.** `reference/Unity-SpatialLingo` is gitignored and never edited.
- **Every phase ends deployed and playable.** Nothing accumulates unshipped.
- License: MIT, with a `NOTICE` crediting Meta Platforms for the original.

## Phase 0 status: complete

Done 2026-08-14, recorded in the spec. Repo cloned to `reference/Unity-SpatialLingo`
(`GIT_LFS_SKIP_SMUDGE=1`, ~16 MB), MIT confirmed via the GitHub API, 116 app C# files
inventoried, IWSDK 0.5.3 typings read. Task 1 below only formalises what is already on disk.

## File Structure

```
.gitignore                              reference/, node_modules/, dist/, .vercel/
NOTICE                                  attribution to Meta Platforms
package.json                            workspace root, scripts
pnpm-workspace.yaml                     packages/*, apps/*
tsconfig.base.json                      shared compiler options
vercel.ts                               build + routing config

packages/lingo-core/
  package.json
  src/index.ts                          public barrel
  src/vocabulary.ts                     VocabularyEntry, LessonPack, pack loading
  src/scoring.ts                        normalise() + scoreAttempt()
  src/machine.ts                        LessonMachine — the state machine
  src/progression.ts                    TreeProgression — growth tiers
  src/types.ts                          shared types, no logic
  test/vocabulary.test.ts
  test/scoring.test.ts
  test/machine.test.ts
  test/progression.test.ts
  test/purity.test.ts                   asserts zero forbidden imports

packages/lingo-core/data/
  starter-pack.es.json                  static lesson pack, Spanish

apps/xr/
  package.json
  index.html
  vite.config.ts
  src/main.ts                           world init, system registration
  src/capabilities.ts                   probe + Tier resolution
  src/systems/scene-label.ts            SceneLabelSystem
  src/systems/simulated-room.ts         SimulatedRoomSystem (Tiers 3–4)
  src/systems/target-selection.ts       TargetSelectionSystem
  src/systems/lesson.ts                 LessonSystem — adapter onto lingo-core
  src/components/lesson-target.ts       LessonTarget component
  test/capabilities.test.ts

docs/migration/                         guide chapters, written per-phase
```

---

## Task 1: Workspace skeleton

**Files:**
- Create: `.gitignore`, `NOTICE`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a pnpm workspace where `pnpm -r test` and `pnpm -r build` resolve across `packages/*` and `apps/*`.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
.vercel/
.turbo/
*.log
reference/
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "spatial-lingo-webxr",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "packageManager": "pnpm@10.18.3",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev": "pnpm --filter @spatial-lingo/xr dev"
  },
  "devDependencies": {
    "typescript": "5.7.3"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 5: Create `NOTICE`**

```
Spatial Lingo WebXR

This project is a WebXR port of Spatial Lingo, an open-source Meta Quest
application by Meta Platforms, Inc.

Original work: https://github.com/oculus-samples/Unity-SpatialLingo
Copyright (c) Meta Platforms, Inc. and affiliates. Licensed under the MIT License.

Built with the Immersive Web SDK (https://github.com/facebook/immersive-web-sdk),
Copyright (c) Meta Platforms, Inc. and affiliates. Licensed under the MIT License.

This port is not affiliated with or endorsed by Meta Platforms, Inc.
```

- [ ] **Step 6: Verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error; a `pnpm-lock.yaml` appears. No packages exist yet, so no builds run.

- [ ] **Step 7: Commit**

```bash
git add .gitignore NOTICE package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: pnpm workspace skeleton"
```

---

## Task 2: lingo-core package + vocabulary model

**Files:**
- Create: `packages/lingo-core/package.json`, `packages/lingo-core/tsconfig.json`, `packages/lingo-core/vitest.config.ts`
- Create: `packages/lingo-core/src/types.ts`, `packages/lingo-core/src/vocabulary.ts`, `packages/lingo-core/src/index.ts`
- Create: `packages/lingo-core/data/starter-pack.es.json`
- Test: `packages/lingo-core/test/vocabulary.test.ts`

**Interfaces:**
- Consumes: Task 1's workspace.
- Produces:
  - `type SemanticLabel = string` — a WebXR `XRMesh.semanticLabel` value, e.g. `'table'`.
  - `interface VocabularyEntry { label: SemanticLabel; word: string; article: string | null; phonetic: string; exampleSentence: string }`
  - `interface LessonPack { language: string; languageName: string; entries: VocabularyEntry[] }`
  - `function loadPack(raw: unknown): LessonPack` — validates and throws `Error` on malformed input.
  - `function findEntry(pack: LessonPack, label: SemanticLabel): VocabularyEntry | undefined`

- [ ] **Step 1: Create `packages/lingo-core/package.json`**

```json
{
  "name": "@spatial-lingo/core",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./data/*": "./data/*" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "devDependencies": {
    "vitest": "2.1.8",
    "typescript": "5.7.3"
  }
}
```

- [ ] **Step 2: Create `packages/lingo-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/lingo-core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Write the failing test**

Create `packages/lingo-core/test/vocabulary.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @spatial-lingo/core test`
Expected: FAIL — cannot resolve `../src/vocabulary.js` and `../data/starter-pack.es.json`.

- [ ] **Step 6: Create the starter pack**

Create `packages/lingo-core/data/starter-pack.es.json`. Labels are drawn from the WebXR
semantic labels Quest reports for bounded meshes.

```json
{
  "language": "es",
  "languageName": "Spanish",
  "entries": [
    { "label": "table",  "word": "mesa",     "article": "la", "phonetic": "MEH-sah",       "exampleSentence": "El libro esta sobre la mesa." },
    { "label": "couch",  "word": "sofa",     "article": "el", "phonetic": "so-FAH",        "exampleSentence": "El gato duerme en el sofa." },
    { "label": "window", "word": "ventana",  "article": "la", "phonetic": "ben-TAH-nah",   "exampleSentence": "Abre la ventana, por favor." },
    { "label": "door",   "word": "puerta",   "article": "la", "phonetic": "PWER-tah",      "exampleSentence": "Cierra la puerta." },
    { "label": "floor",  "word": "suelo",    "article": "el", "phonetic": "SWEH-loh",      "exampleSentence": "El suelo esta limpio." },
    { "label": "ceiling","word": "techo",    "article": "el", "phonetic": "TEH-choh",      "exampleSentence": "El techo es blanco." },
    { "label": "wall",   "word": "pared",    "article": "la", "phonetic": "pah-RED",       "exampleSentence": "Hay un cuadro en la pared." },
    { "label": "screen", "word": "pantalla", "article": "la", "phonetic": "pan-TAH-yah",   "exampleSentence": "La pantalla es grande." },
    { "label": "lamp",   "word": "lampara",  "article": "la", "phonetic": "LAHM-pah-rah",  "exampleSentence": "Enciende la lampara." },
    { "label": "plant",  "word": "planta",   "article": "la", "phonetic": "PLAHN-tah",     "exampleSentence": "La planta necesita agua." },
    { "label": "bed",    "word": "cama",     "article": "la", "phonetic": "KAH-mah",       "exampleSentence": "La cama es comoda." },
    { "label": "shelf",  "word": "estante",  "article": "el", "phonetic": "es-TAHN-teh",   "exampleSentence": "Los libros estan en el estante." }
  ]
}
```

- [ ] **Step 7: Create `packages/lingo-core/src/types.ts`**

```ts
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
```

- [ ] **Step 8: Create `packages/lingo-core/src/vocabulary.ts`**

```ts
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
  const article = source['article'];
  if (article !== null && typeof article !== 'string') {
    throw new Error(`${context}: "article" must be a string or null`);
  }
  return {
    label: requireString(source, 'label', context),
    word: requireString(source, 'word', context),
    article,
    phonetic: requireString(source, 'phonetic', context),
    exampleSentence: requireString(source, 'exampleSentence', context),
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
```

- [ ] **Step 9: Create `packages/lingo-core/src/index.ts`**

```ts
export type { LessonPack, SemanticLabel, VocabularyEntry } from './types.js';
export { findEntry, loadPack } from './vocabulary.js';
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter @spatial-lingo/core test`
Expected: PASS — 5 tests.

- [ ] **Step 11: Commit**

```bash
git add packages/lingo-core
git commit -m "feat(core): vocabulary model and starter Spanish lesson pack"
```

---

## Task 3: Attempt scoring

**Files:**
- Create: `packages/lingo-core/src/scoring.ts`
- Modify: `packages/lingo-core/src/index.ts`
- Test: `packages/lingo-core/test/scoring.test.ts`

**Interfaces:**
- Consumes: `VocabularyEntry` from Task 2.
- Produces:
  - `function normalise(input: string): string` — lowercases, strips diacritics, strips punctuation, collapses whitespace.
  - `type AttemptVerdict = 'correct' | 'close' | 'incorrect'`
  - `interface AttemptResult { verdict: AttemptVerdict; similarity: number; expected: string }` — `similarity` is 0–1.
  - `function scoreAttempt(entry: VocabularyEntry, spoken: string): AttemptResult`

Thresholds: `similarity >= 0.99` → `correct`; `>= 0.7` → `close`; otherwise `incorrect`.
The learner's article is optional — "mesa" and "la mesa" both score as `correct`.

- [ ] **Step 1: Write the failing test**

Create `packages/lingo-core/test/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalise, scoreAttempt } from '../src/scoring.js';
import type { VocabularyEntry } from '../src/types.js';

const mesa: VocabularyEntry = {
  label: 'table', word: 'mesa', article: 'la',
  phonetic: 'MEH-sah', exampleSentence: 'El libro esta sobre la mesa.',
};

describe('normalise', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalise('LÁMPARA')).toBe('lampara');
  });
  it('strips punctuation and collapses whitespace', () => {
    expect(normalise('  la   mesa!  ')).toBe('la mesa');
  });
});

describe('scoreAttempt', () => {
  it('accepts the exact word', () => {
    expect(scoreAttempt(mesa, 'mesa').verdict).toBe('correct');
  });
  it('accepts the word with its article', () => {
    expect(scoreAttempt(mesa, 'la mesa').verdict).toBe('correct');
  });
  it('ignores case and diacritics', () => {
    expect(scoreAttempt(mesa, 'MESA').verdict).toBe('correct');
  });
  it('marks a near miss as close', () => {
    expect(scoreAttempt(mesa, 'meza').verdict).toBe('close');
  });
  it('marks an unrelated word as incorrect', () => {
    expect(scoreAttempt(mesa, 'ventana').verdict).toBe('incorrect');
  });
  it('marks empty input as incorrect', () => {
    const result = scoreAttempt(mesa, '');
    expect(result.verdict).toBe('incorrect');
    expect(result.similarity).toBe(0);
  });
  it('reports the expected word', () => {
    expect(scoreAttempt(mesa, 'mesa').expected).toBe('mesa');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @spatial-lingo/core test scoring`
Expected: FAIL — cannot resolve `../src/scoring.js`.

- [ ] **Step 3: Create `packages/lingo-core/src/scoring.ts`**

```ts
import type { VocabularyEntry } from './types.js';

export type AttemptVerdict = 'correct' | 'close' | 'incorrect';

export interface AttemptResult {
  verdict: AttemptVerdict;
  /** 0–1, where 1 is an exact match after normalisation. */
  similarity: number;
  /** The word the learner was asked to say. */
  expected: string;
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalise(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function similarityOf(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Score a spoken attempt against the target word.
 * The article is optional: both "mesa" and "la mesa" score as correct.
 */
export function scoreAttempt(entry: VocabularyEntry, spoken: string): AttemptResult {
  const heard = normalise(spoken);
  const expected = normalise(entry.word);

  if (heard.length === 0) {
    return { verdict: 'incorrect', similarity: 0, expected: entry.word };
  }

  const candidates = [expected];
  if (entry.article) {
    candidates.push(normalise(`${entry.article} ${entry.word}`));
  }

  const similarity = Math.max(...candidates.map((candidate) => similarityOf(heard, candidate)));
  const verdict: AttemptVerdict =
    similarity >= 0.99 ? 'correct' : similarity >= 0.7 ? 'close' : 'incorrect';

  return { verdict, similarity, expected: entry.word };
}
```

- [ ] **Step 4: Add the exports**

Modify `packages/lingo-core/src/index.ts` — append:

```ts
export type { AttemptResult, AttemptVerdict } from './scoring.js';
export { normalise, scoreAttempt } from './scoring.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @spatial-lingo/core test`
Expected: PASS — 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/lingo-core
git commit -m "feat(core): pronunciation attempt scoring"
```

---

## Task 4: Purity guard

**Files:**
- Test: `packages/lingo-core/test/purity.test.ts`

**Interfaces:**
- Consumes: every file under `packages/lingo-core/src`.
- Produces: a failing test the moment anyone imports a 3D or DOM dependency into `lingo-core`.

This enforces the spec's load-bearing boundary. Without it, the boundary erodes in a week.

- [ ] **Step 1: Write the test**

Create `packages/lingo-core/test/purity.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FORBIDDEN = ['three', '@iwsdk/', 'elics', '@preact/signals-core', '@pmndrs/uikit'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

describe('lingo-core purity', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports no 3D or XR dependency', (file) => {
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    for (const specifier of imports) {
      for (const banned of FORBIDDEN) {
        expect(
          specifier.startsWith(banned),
          `${file} imports "${specifier}" — lingo-core must stay dependency-free`,
        ).toBe(false);
      }
    }
  });

  it.each(files)('%s references no DOM global', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/\b(document|window|navigator)\./);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @spatial-lingo/core test purity`
Expected: PASS. `lingo-core` currently imports nothing but its own modules.

- [ ] **Step 3: Prove the guard actually catches violations**

Temporarily add `import * as THREE from 'three';` to the top of `packages/lingo-core/src/scoring.ts`.

Run: `pnpm --filter @spatial-lingo/core test purity`
Expected: FAIL with `imports "three" — lingo-core must stay dependency-free`.

**Then remove the line again** and re-run to confirm PASS. A guard never seen to fail is not a guard.

- [ ] **Step 4: Commit**

```bash
git add packages/lingo-core/test/purity.test.ts
git commit -m "test(core): guard the zero-dependency boundary"
```

---

## Task 5: Lesson state machine

**Files:**
- Create: `packages/lingo-core/src/machine.ts`
- Modify: `packages/lingo-core/src/index.ts`
- Test: `packages/lingo-core/test/machine.test.ts`

**Interfaces:**
- Consumes: `LessonPack`, `VocabularyEntry`, `findEntry`, `scoreAttempt`, `AttemptResult`.
- Produces:
  - `type LessonPhase = 'idle' | 'presenting' | 'listening' | 'feedback' | 'complete'`
  - `interface LessonState { phase: LessonPhase; entry: VocabularyEntry | null; lastResult: AttemptResult | null; attemptsRemaining: number; learnedLabels: readonly SemanticLabel[] }`
  - `class LessonMachine` with:
    - `constructor(pack: LessonPack, options?: { maxAttempts?: number })` — `maxAttempts` defaults to 3.
    - `get state(): LessonState`
    - `targetLabel(label: SemanticLabel): boolean` — begins a lesson; returns `false` if the label has no entry or one is already running.
    - `beginListening(): void`
    - `submitAttempt(spoken: string): AttemptResult`
    - `dismissFeedback(): void`
    - `subscribe(listener: (state: LessonState) => void): () => void` — returns an unsubscribe function.

Phase transitions:

```
idle --targetLabel--> presenting --beginListening--> listening
listening --submitAttempt--> feedback
feedback --dismissFeedback--> complete   (verdict was correct, or attempts exhausted)
feedback --dismissFeedback--> listening  (attempts remain)
complete --targetLabel--> presenting
```

This is the TypeScript destination for the Unity Visual Scripting `AppFlow.asset` graph —
explicit, inspectable, and testable, which the graph was not.

- [ ] **Step 1: Write the failing test**

Create `packages/lingo-core/test/machine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonMachine } from '../src/machine.js';
import { loadPack } from '../src/vocabulary.js';
import starter from '../data/starter-pack.es.json' with { type: 'json' };

const pack = loadPack(starter);
let machine: LessonMachine;

beforeEach(() => {
  machine = new LessonMachine(pack);
});

describe('LessonMachine', () => {
  it('starts idle with nothing learned', () => {
    expect(machine.state.phase).toBe('idle');
    expect(machine.state.entry).toBeNull();
    expect(machine.state.learnedLabels).toEqual([]);
  });

  it('presents a lesson for a known label', () => {
    expect(machine.targetLabel('table')).toBe(true);
    expect(machine.state.phase).toBe('presenting');
    expect(machine.state.entry?.word).toBe('mesa');
  });

  it('refuses an unknown label', () => {
    expect(machine.targetLabel('spaceship')).toBe(false);
    expect(machine.state.phase).toBe('idle');
  });

  it('refuses a new target while a lesson is running', () => {
    machine.targetLabel('table');
    expect(machine.targetLabel('couch')).toBe(false);
    expect(machine.state.entry?.word).toBe('mesa');
  });

  it('completes on a correct attempt and records the label', () => {
    machine.targetLabel('table');
    machine.beginListening();
    expect(machine.state.phase).toBe('listening');

    const result = machine.submitAttempt('mesa');
    expect(result.verdict).toBe('correct');
    expect(machine.state.phase).toBe('feedback');

    machine.dismissFeedback();
    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual(['table']);
  });

  it('returns to listening while attempts remain', () => {
    machine.targetLabel('table');
    machine.beginListening();
    machine.submitAttempt('ventana');
    expect(machine.state.attemptsRemaining).toBe(2);

    machine.dismissFeedback();
    expect(machine.state.phase).toBe('listening');
  });

  it('completes without learning after exhausting attempts', () => {
    machine.targetLabel('table');
    machine.beginListening();
    for (let i = 0; i < 3; i++) {
      machine.submitAttempt('ventana');
      machine.dismissFeedback();
    }
    expect(machine.state.phase).toBe('complete');
    expect(machine.state.learnedLabels).toEqual([]);
  });

  it('does not record the same label twice', () => {
    for (const _ of [0, 1]) {
      machine.targetLabel('table');
      machine.beginListening();
      machine.submitAttempt('mesa');
      machine.dismissFeedback();
    }
    expect(machine.state.learnedLabels).toEqual(['table']);
  });

  it('throws when submitting an attempt outside listening', () => {
    machine.targetLabel('table');
    expect(() => machine.submitAttempt('mesa')).toThrow(/listening/);
  });

  it('notifies subscribers and can unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = machine.subscribe(listener);

    machine.targetLabel('table');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    machine.beginListening();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @spatial-lingo/core test machine`
Expected: FAIL — cannot resolve `../src/machine.js`.

- [ ] **Step 3: Create `packages/lingo-core/src/machine.ts`**

```ts
import { scoreAttempt, type AttemptResult } from './scoring.js';
import type { LessonPack, SemanticLabel, VocabularyEntry } from './types.js';
import { findEntry } from './vocabulary.js';

export type LessonPhase = 'idle' | 'presenting' | 'listening' | 'feedback' | 'complete';

export interface LessonState {
  phase: LessonPhase;
  entry: VocabularyEntry | null;
  lastResult: AttemptResult | null;
  attemptsRemaining: number;
  learnedLabels: readonly SemanticLabel[];
}

export interface LessonMachineOptions {
  /** Attempts allowed per lesson before it closes unlearned. Defaults to 3. */
  maxAttempts?: number;
}

/**
 * The lesson loop as an explicit state machine.
 *
 * Replaces Spatial Lingo's Unity Visual Scripting graph (`AppFlow.asset`), whose
 * transitions were only inspectable inside the Unity editor. This version is
 * plain TypeScript: readable in a diff and testable without a headset.
 */
export class LessonMachine {
  readonly #pack: LessonPack;
  readonly #maxAttempts: number;
  readonly #listeners = new Set<(state: LessonState) => void>();
  readonly #learned: SemanticLabel[] = [];

  #phase: LessonPhase = 'idle';
  #entry: VocabularyEntry | null = null;
  #lastResult: AttemptResult | null = null;
  #attemptsRemaining = 0;

  constructor(pack: LessonPack, options: LessonMachineOptions = {}) {
    this.#pack = pack;
    this.#maxAttempts = options.maxAttempts ?? 3;
  }

  get state(): LessonState {
    return {
      phase: this.#phase,
      entry: this.#entry,
      lastResult: this.#lastResult,
      attemptsRemaining: this.#attemptsRemaining,
      learnedLabels: [...this.#learned],
    };
  }

  /** Begin a lesson for a detected object. Returns false if it cannot start. */
  targetLabel(label: SemanticLabel): boolean {
    const busy = this.#phase !== 'idle' && this.#phase !== 'complete';
    if (busy) return false;

    const entry = findEntry(this.#pack, label);
    if (!entry) return false;

    this.#entry = entry;
    this.#lastResult = null;
    this.#attemptsRemaining = this.#maxAttempts;
    this.#phase = 'presenting';
    this.#emit();
    return true;
  }

  beginListening(): void {
    if (this.#phase !== 'presenting' && this.#phase !== 'feedback') {
      throw new Error(`beginListening requires phase presenting or feedback, got ${this.#phase}`);
    }
    this.#phase = 'listening';
    this.#emit();
  }

  submitAttempt(spoken: string): AttemptResult {
    if (this.#phase !== 'listening') {
      throw new Error(`submitAttempt requires phase listening, got ${this.#phase}`);
    }
    const entry = this.#entry;
    if (!entry) throw new Error('submitAttempt called with no active entry');

    const result = scoreAttempt(entry, spoken);
    this.#lastResult = result;
    if (result.verdict !== 'correct') {
      this.#attemptsRemaining -= 1;
    }
    this.#phase = 'feedback';
    this.#emit();
    return result;
  }

  dismissFeedback(): void {
    if (this.#phase !== 'feedback') {
      throw new Error(`dismissFeedback requires phase feedback, got ${this.#phase}`);
    }
    const passed = this.#lastResult?.verdict === 'correct';

    if (passed) {
      const label = this.#entry?.label;
      if (label && !this.#learned.includes(label)) this.#learned.push(label);
      this.#phase = 'complete';
    } else if (this.#attemptsRemaining > 0) {
      this.#phase = 'listening';
    } else {
      this.#phase = 'complete';
    }
    this.#emit();
  }

  subscribe(listener: (state: LessonState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const snapshot = this.state;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
```

- [ ] **Step 4: Add the exports**

Modify `packages/lingo-core/src/index.ts` — append:

```ts
export type { LessonMachineOptions, LessonPhase, LessonState } from './machine.js';
export { LessonMachine } from './machine.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @spatial-lingo/core test`
Expected: PASS — 22 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/lingo-core
git commit -m "feat(core): lesson state machine replacing the Unity flow graph"
```

---

## Task 6: Tree progression

**Files:**
- Create: `packages/lingo-core/src/progression.ts`
- Modify: `packages/lingo-core/src/index.ts`
- Test: `packages/lingo-core/test/progression.test.ts`

**Interfaces:**
- Consumes: `SemanticLabel`.
- Produces:
  - `type TreeTier = 0 | 1 | 2 | 3 | 4`
  - `interface ProgressionState { tier: TreeTier; learnedCount: number; wordsToNextTier: number | null }`
  - `function progressionFor(learnedCount: number): ProgressionState`

Tier thresholds — 0 words → tier 0 (seed), 1 → tier 1 (sprout), 3 → tier 2 (sapling),
6 → tier 3 (young tree), 10 → tier 4 (full tree, the cap). `wordsToNextTier` is `null` at
the cap. Mirrors the original's `SetTreeTier.cs` / `TreeController.cs` tiering.

- [ ] **Step 1: Write the failing test**

Create `packages/lingo-core/test/progression.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { progressionFor } from '../src/progression.js';

describe('progressionFor', () => {
  it.each([
    [0, 0, 1],
    [1, 1, 2],
    [2, 1, 1],
    [3, 2, 3],
    [5, 2, 1],
    [6, 3, 4],
    [9, 3, 1],
    [10, 4, null],
    [25, 4, null],
  ])('%i words -> tier %i, %s to next', (learned, tier, toNext) => {
    const state = progressionFor(learned);
    expect(state.tier).toBe(tier);
    expect(state.learnedCount).toBe(learned);
    expect(state.wordsToNextTier).toBe(toNext);
  });

  it('rejects a negative count', () => {
    expect(() => progressionFor(-1)).toThrow(/negative/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @spatial-lingo/core test progression`
Expected: FAIL — cannot resolve `../src/progression.js`.

- [ ] **Step 3: Create `packages/lingo-core/src/progression.ts`**

```ts
export type TreeTier = 0 | 1 | 2 | 3 | 4;

export interface ProgressionState {
  tier: TreeTier;
  learnedCount: number;
  /** Words still needed to reach the next tier, or null at the cap. */
  wordsToNextTier: number | null;
}

/** Words required to reach each tier. Mirrors the original's TreeController tiering. */
const TIER_THRESHOLDS: readonly number[] = [0, 1, 3, 6, 10];

/** Map a learned-word count onto the language tree's growth tier. */
export function progressionFor(learnedCount: number): ProgressionState {
  if (learnedCount < 0) {
    throw new Error(`learnedCount must not be negative, got ${learnedCount}`);
  }

  let tier: TreeTier = 0;
  for (let index = TIER_THRESHOLDS.length - 1; index >= 0; index--) {
    if (learnedCount >= (TIER_THRESHOLDS[index] ?? 0)) {
      tier = index as TreeTier;
      break;
    }
  }

  const nextThreshold = TIER_THRESHOLDS[tier + 1];
  return {
    tier,
    learnedCount,
    wordsToNextTier: nextThreshold === undefined ? null : nextThreshold - learnedCount,
  };
}
```

- [ ] **Step 4: Add the exports**

Modify `packages/lingo-core/src/index.ts` — append:

```ts
export type { ProgressionState, TreeTier } from './progression.js';
export { progressionFor } from './progression.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @spatial-lingo/core test`
Expected: PASS — 32 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/lingo-core
git commit -m "feat(core): language tree growth progression"
```

---

## Task 7: XR app scaffold and capability probe

**Files:**
- Create: `apps/xr/package.json`, `apps/xr/tsconfig.json`, `apps/xr/vite.config.ts`, `apps/xr/index.html`
- Create: `apps/xr/src/capabilities.ts`, `apps/xr/src/main.ts`
- Test: `apps/xr/test/capabilities.test.ts`

**Interfaces:**
- Consumes: Task 1's workspace.
- Produces:
  - `type Tier = 1 | 2 | 3 | 4`
  - `interface Capabilities { cameraAccess: boolean; meshDetection: boolean; planeDetection: boolean; handTracking: boolean; speechRecognition: boolean; immersiveAR: boolean }`
  - `function resolveTier(capabilities: Capabilities): Tier`
  - `function probeCapabilities(nav: Navigator, win: Window): Promise<Capabilities>`

Tier rules — Tier 1 needs `immersiveAR && meshDetection && cameraAccess`; Tier 2 needs
`immersiveAR && meshDetection`; Tier 3 needs `immersiveAR`; otherwise Tier 4.

`probeCapabilities` takes `Navigator` and `Window` as arguments rather than reading globals,
so it is testable in Node with plain fakes.

- [ ] **Step 1: Create `apps/xr/package.json`**

```json
{
  "name": "@spatial-lingo/xr",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@iwsdk/core": "0.5.3",
    "@spatial-lingo/core": "workspace:*",
    "three": "0.170.0"
  },
  "devDependencies": {
    "vite": "6.0.7",
    "vitest": "2.1.8",
    "typescript": "5.7.3"
  }
}
```

> **Note for the implementer:** confirm the `three` version `@iwsdk/core@0.5.3` expects before
> installing — run `pnpm why three` after install and align the pin if it disagrees. IWSDK
> re-exports three from its own `runtime` module, so a duplicate three copy will cause
> `instanceof` failures that are painful to debug.

- [ ] **Step 2: Create `apps/xr/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["vite/client"], "noEmit": true },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `apps/xr/vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true },
  build: { target: 'es2022', outDir: 'dist' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `apps/xr/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Spatial Lingo WebXR</title>
    <style>
      body { margin: 0; background: #101014; color: #f0f0f4; font-family: system-ui, sans-serif; }
      #status { position: fixed; top: 1rem; left: 1rem; font-size: 0.9rem; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div id="status">Probing capabilities…</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Write the failing test**

Create `apps/xr/test/capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { probeCapabilities, resolveTier, type Capabilities } from '../src/capabilities.js';

const NONE: Capabilities = {
  cameraAccess: false, meshDetection: false, planeDetection: false,
  handTracking: false, speechRecognition: false, immersiveAR: false,
};

describe('resolveTier', () => {
  it('returns 4 with no XR at all', () => {
    expect(resolveTier(NONE)).toBe(4);
  });
  it('returns 3 with immersive AR but no mesh detection', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true })).toBe(3);
  });
  it('returns 2 with mesh detection but no camera access', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true, meshDetection: true })).toBe(2);
  });
  it('returns 1 with mesh detection and camera access', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true, meshDetection: true, cameraAccess: true })).toBe(1);
  });
  it('ignores camera access without mesh detection', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true, cameraAccess: true })).toBe(3);
  });
});

describe('probeCapabilities', () => {
  it('reports nothing when WebXR is absent', async () => {
    const result = await probeCapabilities({} as Navigator, {} as Window);
    expect(result).toEqual(NONE);
  });

  it('reports features the session supports', async () => {
    const supported = new Set(['mesh-detection', 'plane-detection', 'hand-tracking']);
    const nav = {
      xr: {
        isSessionSupported: async (mode: string) => mode === 'immersive-ar',
        // Feature probing is done by attempting optional features; the fake
        // reports support directly to keep the test hermetic.
        __supported: supported,
      },
    } as unknown as Navigator;
    const win = { SpeechRecognition: class {} } as unknown as Window;

    const result = await probeCapabilities(nav, win);
    expect(result.immersiveAR).toBe(true);
    expect(result.meshDetection).toBe(true);
    expect(result.planeDetection).toBe(true);
    expect(result.handTracking).toBe(true);
    expect(result.speechRecognition).toBe(true);
    expect(result.cameraAccess).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @spatial-lingo/xr test`
Expected: FAIL — cannot resolve `../src/capabilities.js`.

- [ ] **Step 7: Create `apps/xr/src/capabilities.ts`**

```ts
/** Degradation tier the app runs at. See the spec's capability table. */
export type Tier = 1 | 2 | 3 | 4;

export interface Capabilities {
  cameraAccess: boolean;
  meshDetection: boolean;
  planeDetection: boolean;
  handTracking: boolean;
  speechRecognition: boolean;
  immersiveAR: boolean;
}

const NONE: Capabilities = {
  cameraAccess: false,
  meshDetection: false,
  planeDetection: false,
  handTracking: false,
  speechRecognition: false,
  immersiveAR: false,
};

/**
 * Pick the highest tier the device can actually sustain.
 *
 * Camera access without mesh detection is useless to us: we need scene geometry
 * to anchor a detection to, so that combination falls back to Tier 3.
 */
export function resolveTier(capabilities: Capabilities): Tier {
  if (!capabilities.immersiveAR) return 4;
  if (!capabilities.meshDetection) return 3;
  return capabilities.cameraAccess ? 1 : 2;
}

interface FeatureProbe {
  isSessionSupported?: (mode: string) => Promise<boolean>;
  __supported?: Set<string>;
}

/**
 * Probe device capabilities.
 *
 * Takes Navigator and Window explicitly rather than reading globals, so the
 * logic is unit-testable in Node without a DOM.
 */
export async function probeCapabilities(nav: Navigator, win: Window): Promise<Capabilities> {
  const xr = (nav as Navigator & { xr?: FeatureProbe }).xr;
  if (!xr?.isSessionSupported) return { ...NONE };

  let immersiveAR = false;
  try {
    immersiveAR = await xr.isSessionSupported('immersive-ar');
  } catch {
    immersiveAR = false;
  }

  const supported = xr.__supported ?? new Set<string>();
  const speechRecognition =
    'SpeechRecognition' in win || 'webkitSpeechRecognition' in win;

  return {
    immersiveAR,
    meshDetection: supported.has('mesh-detection'),
    planeDetection: supported.has('plane-detection'),
    handTracking: supported.has('hand-tracking'),
    cameraAccess: supported.has('camera-access'),
    speechRecognition,
  };
}
```

> **Implementer note:** `__supported` is a seam, not the final mechanism. WebXR gives no way
> to query optional feature support without requesting a session, so the real probe happens
> in Task 8 when the session is requested with these as `optionalFeatures` and
> `session.enabledFeatures` is read back. Keep this seam — it is what makes the tier logic
> testable in Node.

- [ ] **Step 8: Create `apps/xr/src/main.ts`**

```ts
import { probeCapabilities, resolveTier } from './capabilities.js';

async function main(): Promise<void> {
  const status = document.getElementById('status');
  const capabilities = await probeCapabilities(navigator, window);
  const tier = resolveTier(capabilities);

  const lines = [
    `<strong>Tier ${tier}</strong>`,
    ...Object.entries(capabilities).map(
      ([name, value]) => `${value ? '&check;' : '&cross;'} ${name}`,
    ),
  ];
  if (status) status.innerHTML = lines.join('<br />');

  console.info('[spatial-lingo] capabilities', capabilities, 'tier', tier);
}

void main();
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @spatial-lingo/xr test`
Expected: PASS — 7 tests.

- [ ] **Step 10: Verify it runs in a browser**

Run: `pnpm --filter @spatial-lingo/xr dev`
Open the printed URL on the desktop. Expected: the status overlay reads **Tier 4** with every
capability crossed out. That is correct on a desktop browser with no WebXR.

- [ ] **Step 11: Commit**

```bash
git add apps/xr
git commit -m "feat(xr): app scaffold and capability probe"
```

---

## Task 8: Real WebXR session probe and deploy

**Files:**
- Modify: `apps/xr/src/capabilities.ts`
- Modify: `apps/xr/src/main.ts`
- Create: `vercel.ts`
- Test: `apps/xr/test/capabilities.test.ts` (extend)

**Interfaces:**
- Consumes: `Capabilities`, `resolveTier` from Task 7.
- Produces:
  - `function capabilitiesFromSession(session: XRSession, base: Capabilities): Capabilities` — reads `session.enabledFeatures` and returns an updated Capabilities.
  - `const OPTIONAL_FEATURES: readonly string[]` — the feature list to request.

This closes the seam left in Task 7 and gets a real reading off a Quest.

- [ ] **Step 1: Write the failing test**

Append to `apps/xr/test/capabilities.test.ts`:

```ts
import { capabilitiesFromSession, OPTIONAL_FEATURES } from '../src/capabilities.js';

describe('capabilitiesFromSession', () => {
  const base: Capabilities = { ...NONE, immersiveAR: true };

  it('reads enabled features off the session', () => {
    const session = { enabledFeatures: ['mesh-detection', 'hand-tracking'] } as unknown as XRSession;
    const result = capabilitiesFromSession(session, base);
    expect(result.meshDetection).toBe(true);
    expect(result.handTracking).toBe(true);
    expect(result.planeDetection).toBe(false);
    expect(result.cameraAccess).toBe(false);
  });

  it('preserves base values the session says nothing about', () => {
    const session = { enabledFeatures: [] } as unknown as XRSession;
    const result = capabilitiesFromSession(session, { ...base, speechRecognition: true });
    expect(result.speechRecognition).toBe(true);
    expect(result.immersiveAR).toBe(true);
  });

  it('tolerates a session with no enabledFeatures', () => {
    const session = {} as unknown as XRSession;
    expect(() => capabilitiesFromSession(session, base)).not.toThrow();
  });

  it('requests every feature the tiers depend on', () => {
    expect(OPTIONAL_FEATURES).toContain('mesh-detection');
    expect(OPTIONAL_FEATURES).toContain('plane-detection');
    expect(OPTIONAL_FEATURES).toContain('hand-tracking');
    expect(OPTIONAL_FEATURES).toContain('camera-access');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @spatial-lingo/xr test`
Expected: FAIL — `capabilitiesFromSession` is not exported.

- [ ] **Step 3: Extend `apps/xr/src/capabilities.ts`**

Append:

```ts
/** Optional WebXR features requested at session start. */
export const OPTIONAL_FEATURES: readonly string[] = [
  'local-floor',
  'bounded-floor',
  'mesh-detection',
  'plane-detection',
  'hand-tracking',
  'anchors',
  'camera-access',
];

/**
 * Refine capabilities from a live session.
 *
 * `session.enabledFeatures` is the only trustworthy source: a feature can be
 * requested and silently declined, so we never assume a request succeeded.
 */
export function capabilitiesFromSession(session: XRSession, base: Capabilities): Capabilities {
  const enabled = new Set<string>(
    (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures ?? [],
  );
  return {
    ...base,
    meshDetection: enabled.has('mesh-detection'),
    planeDetection: enabled.has('plane-detection'),
    handTracking: enabled.has('hand-tracking'),
    cameraAccess: enabled.has('camera-access'),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @spatial-lingo/xr test`
Expected: PASS — 11 tests.

- [ ] **Step 5: Wire the session into `main.ts`**

Replace `apps/xr/src/main.ts` with:

```ts
import {
  capabilitiesFromSession,
  OPTIONAL_FEATURES,
  probeCapabilities,
  resolveTier,
  type Capabilities,
} from './capabilities.js';

function render(capabilities: Capabilities): void {
  const status = document.getElementById('status');
  if (!status) return;
  const tier = resolveTier(capabilities);
  status.innerHTML = [
    `<strong>Tier ${tier}</strong>`,
    ...Object.entries(capabilities).map(
      ([name, value]) => `${value ? '&check;' : '&cross;'} ${name}`,
    ),
  ].join('<br />');
  console.info('[spatial-lingo] capabilities', capabilities, 'tier', tier);
}

async function main(): Promise<void> {
  let capabilities = await probeCapabilities(navigator, window);
  render(capabilities);

  if (!capabilities.immersiveAR) return;

  const button = document.createElement('button');
  button.textContent = 'Enter XR';
  button.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:1rem 2rem;font-size:1rem;';
  document.body.append(button);

  button.addEventListener('click', async () => {
    try {
      const session = await navigator.xr!.requestSession('immersive-ar', {
        optionalFeatures: [...OPTIONAL_FEATURES],
      });
      capabilities = capabilitiesFromSession(session, capabilities);
      render(capabilities);
    } catch (error) {
      console.error('[spatial-lingo] session request failed', error);
    }
  });
}

void main();
```

- [ ] **Step 6: Create `vercel.ts`**

```ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  buildCommand: 'pnpm --filter @spatial-lingo/xr build',
  outputDirectory: 'apps/xr/dist',
  framework: 'vite',
};
```

Then: `pnpm add -D -w @vercel/config`

- [ ] **Step 7: Deploy and read the real numbers off a Quest**

```bash
pnpm build
npx vercel deploy
```

Open the preview URL in Quest Browser, press **Enter XR**, and record the reported tier and
capability flags. **Write the result into `docs/migration/00-recon.md`** — this is the
answer to the spec's open question about `camera-access`, and it decides whether Phase 6
is ever worth starting.

- [ ] **Step 8: Commit**

```bash
git add apps/xr vercel.ts package.json pnpm-lock.yaml docs/migration/00-recon.md
git commit -m "feat(xr): live WebXR session capability probe, deployed"
```

---

## Task 9: Lesson targets from scene understanding

**Files:**
- Create: `apps/xr/src/components/lesson-target.ts`, `apps/xr/src/systems/scene-label.ts`
- Modify: `apps/xr/src/main.ts`

**Interfaces:**
- Consumes: `XRMesh` from `@iwsdk/core`, `loadPack`/`findEntry` from `@spatial-lingo/core`.
- Produces:
  - `const LessonTarget` — an elics component with `{ label: Types.String, word: Types.String, learned: Types.Boolean }`.
  - `class SceneLabelSystem` — tags detected meshes that have a matching vocabulary entry.

Ground truth from `@iwsdk/core@0.5.3` typings: `XRMesh` carries `semanticLabel: Types.String`,
`isBounded3D: Types.Boolean`, `dimensions: Types.Vec3`, `min`/`max: Types.Vec3`. Read with
`entity.getValue(XRMesh, 'semanticLabel')`. Queries subscribe via
`this.query({ required: [XRMesh] }).subscribe('qualify', handler)`.

- [ ] **Step 1: Create `apps/xr/src/components/lesson-target.ts`**

```ts
import { createComponent, Types } from '@iwsdk/core';

/**
 * Marks a detected real-world object that has a vocabulary entry.
 *
 * The Unity original derived targets from YOLO over the passthrough camera
 * (ImageObjectClassifier + CameraTaxonTracker). WebXR gives us semantic labels
 * straight off the scene mesh, so no inference is needed for this tier.
 */
export const LessonTarget = createComponent('LessonTarget', {
  label: { type: Types.String, default: '' },
  word: { type: Types.String, default: '' },
  learned: { type: Types.Boolean, default: false },
});
```

> **Implementer note:** confirm the component factory's exact name and signature against
> `node_modules/@iwsdk/core/dist/ecs/component.d.ts` before writing this file. The typings
> export `Types`; verify whether components are declared with `createComponent(name, schema)`
> or `createComponent(schema)` in 0.5.3 and match it. Do not guess — check the file.

- [ ] **Step 2: Create `apps/xr/src/systems/scene-label.ts`**

```ts
import { createSystem, XRMesh } from '@iwsdk/core';
import { findEntry, type LessonPack } from '@spatial-lingo/core';
import { LessonTarget } from '../components/lesson-target.js';

/**
 * Tags detected scene meshes that we have a word for.
 *
 * Replaces the Unity original's camera + YOLO detection path with WebXR
 * scene-understanding semantic labels. Fewer object classes, but zero inference
 * cost and no camera permission required.
 */
export class SceneLabelSystem extends createSystem({
  meshes: { required: [XRMesh] },
}) {
  #pack: LessonPack | null = null;

  setPack(pack: LessonPack): void {
    this.#pack = pack;
  }

  init(): void {
    this.queries.meshes.subscribe('qualify', (entity) => {
      const pack = this.#pack;
      if (!pack) return;

      const isBounded = entity.getValue(XRMesh, 'isBounded3D');
      if (!isBounded) return;

      const label = entity.getValue(XRMesh, 'semanticLabel');
      if (typeof label !== 'string' || label.length === 0) return;

      const entry = findEntry(pack, label);
      if (!entry) return;

      entity.addComponent(LessonTarget, {
        label: entry.label,
        word: entry.word,
        learned: false,
      });
      console.info('[spatial-lingo] lesson target:', label, '->', entry.word);
    });
  }
}
```

- [ ] **Step 3: Register the system in `main.ts`**

After the session is created and capabilities are refined, register the system with the
IWSDK world. **Read `node_modules/@iwsdk/core/dist/init/world-initializer.d.ts` and
`dist/ecs/world.d.ts` first** to get the exact world-creation and `registerSystem` signatures
for 0.5.3, then wire `SceneLabelSystem` and call `setPack(loadPack(starterPack))`.

- [ ] **Step 4: Verify on device**

Deploy, open on a Quest with a scanned room, enter XR. Expected: the console logs one
`lesson target:` line per recognised piece of furniture. If the room reports no bounded
meshes, run Room Setup in the headset first and retry.

- [ ] **Step 5: Commit**

```bash
git add apps/xr
git commit -m "feat(xr): derive lesson targets from scene mesh semantic labels"
```

---

## Task 10: Simulated room for Tiers 3–4

**Files:**
- Create: `apps/xr/src/systems/simulated-room.ts`
- Modify: `apps/xr/src/main.ts`

**Interfaces:**
- Consumes: `LessonTarget`, `LessonPack`.
- Produces: `class SimulatedRoomSystem` with `spawn(pack: LessonPack, count: number): void` — creates labelled box entities arranged in an arc in front of the player, each carrying `LessonTarget`.

This is what keeps Tier 4 honest. Without it, anyone opening the repo on a laptop sees an
empty scene and closes the tab.

- [ ] **Step 1: Create `apps/xr/src/systems/simulated-room.ts`**

```ts
import { createSystem, Mesh, MeshStandardMaterial, BoxGeometry } from '@iwsdk/core';
import type { LessonPack } from '@spatial-lingo/core';
import { LessonTarget } from '../components/lesson-target.js';

const ARC_RADIUS = 2.5;
const ARC_SPAN = Math.PI * 0.8;
const BOX_SIZE = 0.4;

/**
 * Spawns stand-in objects when no real scene mesh is available.
 *
 * Tiers 3 and 4 depend on this: a WebXR headset without mesh detection, and a
 * plain desktop browser, both need something to point at. Keeping the desktop
 * path playable is what lets reviewers try the project without a headset.
 */
export class SimulatedRoomSystem extends createSystem({}) {
  spawn(pack: LessonPack, count: number): void {
    const entries = pack.entries.slice(0, count);
    const geometry = new BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);

    entries.forEach((entry, index) => {
      const t = entries.length === 1 ? 0.5 : index / (entries.length - 1);
      const angle = -ARC_SPAN / 2 + t * ARC_SPAN;

      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x4a9eff }));
      mesh.position.set(Math.sin(angle) * ARC_RADIUS, 1.2, -Math.cos(angle) * ARC_RADIUS);

      const entity = this.createEntity();
      entity.object3D = mesh;
      this.scene.add(mesh);
      entity.addComponent(LessonTarget, {
        label: entry.label,
        word: entry.word,
        learned: false,
      });
    });
  }
}
```

> **Implementer note:** verify how an entity is bound to an `Object3D` in 0.5.3 —
> check `dist/ecs/entity.d.ts` and `dist/transform/index.d.ts`. If assigning
> `entity.object3D` directly is not supported, use the transform component the typings
> expose instead. Check before writing.

- [ ] **Step 2: Select the room source by tier in `main.ts`**

Tier 1 and 2 use `SceneLabelSystem`. Tiers 3 and 4 call
`simulatedRoom.spawn(pack, 6)` after world init. Both paths produce entities carrying
`LessonTarget`, so everything downstream is tier-agnostic — that is the point of the design.

- [ ] **Step 3: Verify both paths**

Desktop: `pnpm --filter @spatial-lingo/xr dev`. Expected: six blue boxes in an arc.
Quest with a scanned room: real furniture is tagged instead, and no boxes appear.

- [ ] **Step 4: Commit**

```bash
git add apps/xr
git commit -m "feat(xr): simulated room keeps tiers 3 and 4 playable"
```

---

## Task 11: Target selection and the lesson loop on screen

**Files:**
- Create: `apps/xr/src/systems/target-selection.ts`, `apps/xr/src/systems/lesson.ts`
- Modify: `apps/xr/src/main.ts`

**Interfaces:**
- Consumes: `LessonTarget`, `LessonMachine`, `progressionFor`.
- Produces:
  - `class TargetSelectionSystem` — raycasts from the pointer/controller, calls `onSelect(label)` when a `LessonTarget` is hit.
  - `class LessonSystem` — owns the `LessonMachine`, subscribes to its state, drives the on-screen panel.

Phase 3 deliberately stops at **text input** for attempts. Voice is Phase 4. Keeping them
separate means the state machine gets proven before a flaky speech API is layered on top.

- [ ] **Step 1: Create `apps/xr/src/systems/target-selection.ts`**

```ts
import { createSystem, Raycaster, Vector2 } from '@iwsdk/core';
import { LessonTarget } from '../components/lesson-target.js';

/**
 * Turns a pointer or controller ray into a lesson target selection.
 *
 * Unity used the Interaction SDK's poke and ray interactors. IWSDK exposes
 * input through `this.input`; on desktop we fall back to a mouse raycast so
 * Tier 4 stays playable.
 */
export class TargetSelectionSystem extends createSystem({
  targets: { required: [LessonTarget] },
}) {
  #raycaster = new Raycaster();
  #pointer = new Vector2();
  #onSelect: ((label: string) => void) | null = null;

  onSelect(handler: (label: string) => void): void {
    this.#onSelect = handler;
  }

  init(): void {
    window.addEventListener('pointerdown', (event) => {
      this.#pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.#pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
      this.#raycaster.setFromCamera(this.#pointer, this.camera);
      this.#pick();
    });
  }

  #pick(): void {
    for (const entity of this.queries.targets.entities) {
      const object = entity.object3D;
      if (!object) continue;
      if (this.#raycaster.intersectObject(object, true).length > 0) {
        const label = entity.getValue(LessonTarget, 'label');
        if (typeof label === 'string' && label.length > 0) this.#onSelect?.(label);
        return;
      }
    }
  }
}
```

> **Implementer note:** this handles the desktop path only. Add the XR controller ray using
> `this.input` once you have read `dist/input/index.d.ts`. Do not guess the input API — the
> desktop path above is enough to make the task's test pass, and the XR ray is a follow-up
> commit within this same task.

- [ ] **Step 2: Create `apps/xr/src/systems/lesson.ts`**

```ts
import { createSystem } from '@iwsdk/core';
import { LessonMachine, progressionFor, type LessonPack, type LessonState } from '@spatial-lingo/core';

/**
 * The only bridge between the XR layer and the game rules.
 *
 * All lesson logic lives in `@spatial-lingo/core` and is unit-tested in Node.
 * This system just forwards events in and renders state out — the thin-adapter
 * shape the migration guide argues for.
 */
export class LessonSystem extends createSystem({}) {
  #machine: LessonMachine | null = null;

  start(pack: LessonPack): void {
    const machine = new LessonMachine(pack);
    this.#machine = machine;
    machine.subscribe((state) => this.#render(state));
  }

  selectTarget(label: string): void {
    const machine = this.#machine;
    if (!machine) return;

    // targetLabel already accepts 'idle' and 'complete', so no reset is needed here.
    if (!machine.targetLabel(label)) return;
    machine.beginListening();
  }

  submit(spoken: string): void {
    const machine = this.#machine;
    if (!machine || machine.state.phase !== 'listening') return;
    machine.submitAttempt(spoken);
  }

  dismiss(): void {
    const machine = this.#machine;
    if (!machine || machine.state.phase !== 'feedback') return;
    machine.dismissFeedback();
  }

  #render(state: LessonState): void {
    const panel = document.getElementById('lesson');
    if (!panel) return;

    const progression = progressionFor(state.learnedLabels.length);
    const lines: string[] = [
      `<strong>${state.entry?.word ?? '—'}</strong> (${state.entry?.label ?? 'no target'})`,
      `phase: ${state.phase}`,
      `attempts left: ${state.attemptsRemaining}`,
      `tree tier: ${progression.tier} (${state.learnedLabels.length} learned)`,
    ];
    if (state.lastResult) {
      lines.push(`last: ${state.lastResult.verdict} (${state.lastResult.similarity.toFixed(2)})`);
    }
    panel.innerHTML = lines.join('<br />');
  }
}
```

- [ ] **Step 3: Add the lesson panel and a text input to `index.html`**

Inside `<body>`, before the script tag:

```html
<div id="lesson" style="position:fixed;top:1rem;right:1rem;text-align:right;font-size:0.9rem;line-height:1.5;"></div>
<input
  id="attempt"
  placeholder="Type the word, press Enter"
  style="position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);padding:0.75rem 1rem;font-size:1rem;width:18rem;"
/>
```

- [ ] **Step 4: Wire it up in `main.ts`**

Register `LessonSystem` and `TargetSelectionSystem`. Call `lesson.start(pack)`, and
`selection.onSelect((label) => lesson.selectTarget(label))`. Bind the input's `keydown`:
on `Enter`, call `lesson.submit(input.value)`, clear the field, and after a 1.5 s timeout
call `lesson.dismiss()`.

- [ ] **Step 5: Play it end to end on desktop**

Run: `pnpm --filter @spatial-lingo/xr dev`

Walk the full loop: click a blue box → the panel shows the target word and `phase: listening`
→ type `mesa` → `phase: feedback`, `last: correct` → after the timeout, `phase: complete` and
the tree tier increments. Type a wrong word and confirm `attempts left` decrements and the
phase returns to `listening`.

- [ ] **Step 6: Verify on a Quest**

Deploy and repeat with real furniture. Note anything that behaves differently from desktop —
those notes become guide material.

- [ ] **Step 7: Commit**

```bash
git add apps/xr
git commit -m "feat(xr): playable lesson loop with text input"
```

---

## Task 12: Guide chapters for Phases 0–3

**Files:**
- Create: `docs/migration/00-recon.md`, `docs/migration/01-project-setup.md`, `docs/migration/03-csharp-to-typescript.md`, `docs/migration/04-scene-understanding.md`
- Create: `README.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–11.
- Produces: the guide chapters covering work already done, written while the details are fresh.

The spec makes this a phase exit criterion, not an afterthought. Every code claim must point
at a real file in this repo.

- [ ] **Step 1: Write `docs/migration/00-recon.md`**

Cover: how the Unity repo was inventoried, the LFS-skip clone trick, the five Phase 0
findings from the spec, and — filled in from Task 8 — the real capability readings off a
Quest. Include the actual commands used.

- [ ] **Step 2: Write `docs/migration/01-project-setup.md`**

Unity project structure vs the pnpm workspace. Why `lingo-core` is separated and what that
buys (cite `test/purity.test.ts`). Exact-version pinning and why, given IWSDK is 0.x.

- [ ] **Step 3: Write `docs/migration/03-csharp-to-typescript.md`**

The anchor chapter. Every bullet from the spec's Chapter 3 list, each with a real
side-by-side drawn from this port — not invented examples. At minimum:

- `MonoBehaviour` → component + system, using `RoomSense.cs` against `SceneLabelSystem`
- Coroutine → async: `RoomSense.SpawnCoroutine`'s `while (MRUK.Instance == null) yield return null`
  against IWSDK's `subscribe('qualify', …)`. The polling loop disappears entirely — that is
  the interesting part
- `Update()` → `update(delta, time)`, noting both are in **seconds**
- `GetComponent<T>()` → `entity.getValue(Component, 'field')` and query subscriptions
- `[SerializeField]` → `createSystem`'s schema and `@preact/signals-core` config signals
- **When the logic isn't in the code at all** — `AppFlow.asset` as a serialized Visual
  Scripting graph, and `LessonMachine` as the explicit destination

- [ ] **Step 4: Write `docs/migration/04-scene-understanding.md`**

MRUK vs WebXR mesh detection. State plainly that this is a **redesign, not a port**: the
original derived targets from camera + YOLO, and `RoomSense.cs` only ever picked a spawn
point. Cover `XRMesh.semanticLabel`, what labels Quest actually reports, and the tier
fallback design.

- [ ] **Step 5: Write `README.md`**

What it is, a link to the live demo, the four tiers and what each needs, quickstart
(`pnpm install && pnpm dev` — no API keys), repo layout, a link to the guide, credit to the
original with the `NOTICE` pointer, and the MIT license.

- [ ] **Step 6: Commit**

```bash
git add docs/migration README.md
git commit -m "docs: migration guide chapters for phases 0-3"
```

---

## Phase 3 exit criteria

All must hold before planning Phase 4:

- [ ] `pnpm test` passes — 32+ tests in `lingo-core`, 11 in `apps/xr`
- [ ] `pnpm typecheck` passes with no errors
- [ ] `test/purity.test.ts` passes, and has been **seen to fail** when a banned import is added
- [ ] Desktop browser: full lesson loop playable with no API keys and no headset
- [ ] Quest Browser: real furniture tagged, full lesson loop playable
- [ ] Deployed to Vercel with a working public URL
- [ ] Real capability readings from a Quest recorded in `docs/migration/00-recon.md`
- [ ] Four guide chapters and the README written and committed

## Deferred to later phases

Named here so they are not silently dropped:

- Voice (Web Speech + proxy adapters) — Phase 4
- Golly Gosh, the language tree, and any GLTF asset conversion — Phase 2, resequenced after
  Phase 3 since the loop is more valuable to prove first than the art
- Live LLM lesson generation and evaluation — Phase 5
- Camera + YOLO via ONNX Runtime Web — Phase 6, only if Task 8 shows `camera-access` on device
- IWSDK MCP / Playwright runtime tests in CI — Phase 7
- `@pmndrs/uikit` spatial panels replacing the DOM overlay — Phase 4, alongside voice

## Self-review notes

Checked against the spec:

- **Covered:** workspace and repo layout (Task 1), `lingo-core` boundary and its enforcement
  (Tasks 2–6), capability tiers 1–4 (Tasks 7, 8, 10), scene-understanding targets (Task 9),
  the playable loop (Task 11), per-phase guide chapters (Task 12), exact-version pinning
  (Global Constraints), MIT and attribution (Task 1).
- **Deliberately deferred:** listed above. Phase 2 (assets) is resequenced to follow Phase 3
  — the spec ordered it earlier to surface conversion risk, but proving the loop first is the
  better trade now that Phase 0 showed IWSDK's scene-understanding API is a close fit.
  Asset risk is still surfaced before Phase 4 layers voice on top.
- **Three deliberate seams** where the plan tells the implementer to read IWSDK's typings
  rather than trusting invented signatures: `createComponent` (Task 9), entity↔Object3D
  binding (Task 10), and the XR input ray (Task 11). IWSDK 0.5.3's docs site is not public
  and these three APIs were not fully pinned down during Phase 0 recon. Guessing them here
  would have produced confident, wrong code — reading `node_modules/@iwsdk/core/dist/**/*.d.ts`
  takes minutes and is correct.
