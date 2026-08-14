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
