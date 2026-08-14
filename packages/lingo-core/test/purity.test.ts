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

// Matches the specifier in `import x from '...'` and `export ... from '...'`
// (both forms use a `from` clause, so one pattern covers both).
const FROM_CLAUSE = /\bfrom\s+['"]([^'"]+)['"]/g;
// Matches bare side-effect imports: `import '...'` (no `from`, no bindings).
const BARE_IMPORT = /\bimport\s*['"]([^'"]+)['"]/g;
// Matches dynamic imports: `import('...')`.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// Matches CommonJS-style requires: `require('...')`.
const REQUIRE_CALL = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [FROM_CLAUSE, BARE_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

// Blanks out block comments, line comments, and string/template literals so the
// DOM-global check below doesn't trip on prose or example text (e.g. a JSDoc
// comment mentioning "window" as an example value). Not a real tokenizer — just
// enough to keep the common cases from producing false positives.
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('lingo-core purity', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s imports no 3D or XR dependency', (file) => {
    const source = readFileSync(file, 'utf8');
    const imports = extractImportSpecifiers(source);
    for (const specifier of imports) {
      for (const banned of FORBIDDEN) {
        expect(
          specifier.startsWith(banned),
          `${file} imports "${specifier}" — lingo-core must stay dependency-free`,
        ).toBe(false);
      }
    }
  });

  // Checks for `document`, `window`, and `navigator` as bare identifier references
  // (not just dot-access), e.g. `const w = window;`, `globalThis.window`, `window['key']`.
  // Comments and string/template literals are blanked out first with a few simple
  // regex passes (not a full tokenizer/parser) so ordinary prose or example strings
  // that merely mention "window" don't trip the guard.
  it.each(files)('%s references no DOM global identifier', (file) => {
    const source = readFileSync(file, 'utf8');
    const codeOnly = stripCommentsAndStrings(source);
    expect(codeOnly).not.toMatch(/\b(document|window|navigator)\b/);
  });
});
