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

// Blanks the literal text of a template literal while preserving the contents
// of any `${...}` interpolations, since interpolations hold real executable
// code (e.g. `` `${window.location.href}` ``) that the DOM-global and
// forbidden-import checks must still see. Tracks `{`/`}` nesting depth inside
// an interpolation so a nested object/call (e.g. `${ fn({ a: 1 }) }`) isn't
// truncated at the first `}`. Not a full tokenizer — just enough to keep the
// common cases correct.
function blankTemplateLiterals(source: string): string {
  let result = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch !== '`') {
      result += ch;
      i++;
      continue;
    }
    // Entered a template literal.
    result += '`';
    i++;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        // Escaped char in literal text — blank both, keep no content.
        i += 2;
        continue;
      }
      if (c === '`') {
        result += '`';
        i++;
        break;
      }
      if (c === '$' && source[i + 1] === '{') {
        result += '${';
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const inner = source[i];
          if (inner === '{') depth++;
          else if (inner === '}') depth--;
          if (depth > 0) {
            result += inner;
          } else {
            result += '}';
          }
          i++;
        }
        continue;
      }
      // Literal text character — blank it out.
      i++;
    }
  }
  return result;
}

// Blanks out block comments, line comments, and string/template literals so the
// DOM-global check below doesn't trip on prose or example text (e.g. a JSDoc
// comment mentioning "window" as an example value). Not a real tokenizer — just
// enough to keep the common cases from producing false positives.
function stripCommentsAndStrings(source: string): string {
  return blankTemplateLiterals(
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""'),
  );
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

  // Regression test: template literal interpolations (`${...}`) are real
  // executable code, not literal text, so the stripper must preserve their
  // contents rather than blanking the whole literal — otherwise a violation
  // hiding inside an interpolation would silently pass the guard.
  it('preserves template literal interpolation contents when stripping', () => {
    expect(stripCommentsAndStrings('const s = `${window.location.href}`;')).toMatch(
      /\bwindow\b/,
    );
    expect(
      stripCommentsAndStrings('const s = `${ obj["key"] }`;'),
    ).not.toMatch(/^const s = ``;$/);
    // Nested braces inside an interpolation must not truncate at the first `}`.
    expect(stripCommentsAndStrings('const s = `${ fn({ a: 1, w: window }) }`;')).toMatch(
      /\bwindow\b/,
    );
    // Literal text around the interpolation is still blanked.
    expect(stripCommentsAndStrings('const s = `hello ${x} world`;')).not.toMatch(
      /hello|world/,
    );
  });
});
