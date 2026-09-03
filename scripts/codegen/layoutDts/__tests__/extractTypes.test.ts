import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractTypes } from '../extractTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'sample-types.ts');

describe('extractTypes', () => {
  it('extracts only exported top-level interface / type / function declarations', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    const names = result.symbols.map((s) => s.name).sort();

    expect(names).toEqual(['AliasedBaz', 'FooOrBar', 'FooProps', 'isFooProps']);
    expect(names).not.toContain('InternalOnly');
    expect(names).not.toContain('helper');
  });

  it('classifies symbol kinds correctly', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    const byName = new Map(result.symbols.map((s) => [s.name, s]));

    expect(byName.get('FooProps')?.kind).toBe('interface');
    expect(byName.get('FooOrBar')?.kind).toBe('type-alias');
    expect(byName.get('AliasedBaz')?.kind).toBe('type-alias');
    expect(byName.get('isFooProps')?.kind).toBe('function');
  });

  it('preserves leading JSDoc comments in the emitted text', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    const fooProps = result.symbols.find((s) => s.name === 'FooProps');

    expect(fooProps?.text).toContain('/** A simple props bag. */');
    expect(fooProps?.text).toContain('width?: number');
    expect(fooProps?.text).toContain('foo?: Foo');
  });

  it('strips the `export` keyword (consumer adds it back if needed)', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    for (const sym of result.symbols) {
      // `export` should not appear at the start of the declaration line.
      // (It may appear inside JSDoc text like "exported helper" — we only
      // check the declaration head.)
      const declarationLine = sym.text
        .split('\n')
        .find((line) =>
          /^(interface |type |function |declare function )/.test(line.trim()),
        );
      expect(declarationLine, sym.name).toBeDefined();
      expect(declarationLine!.trim().startsWith('export')).toBe(false);
    }
  });

  it('emits function signatures as a `declare function` line (no body)', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    const fn = result.symbols.find((s) => s.name === 'isFooProps');
    expect(fn).toBeDefined();
    expect(fn!.text).toMatch(/declare function isFooProps\(/);
    expect(fn!.text).not.toContain('isRecord('); // body is dropped
    expect(fn!.text).toContain('value is FooProps');
  });

  it('reports external module dependencies it could not inline', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    const deps = result.externalDependencies;
    const flat = new Map<string, string[]>();
    for (const d of deps) flat.set(d.moduleName, d.importedNames.sort());

    // External type imports must be reported so the caller can stub them.
    expect(flat.get('./external/foo.js')).toEqual(['Bar', 'Foo']);
    // Aliased imports must report the LOCAL binding name (what the
    // extracted symbol bodies actually reference), not the original.
    expect(flat.get('./external/baz.js')).toEqual(['RenamedBaz']);

    // Value imports (typeGuards) should also be reported even though they
    // are not types — caller decides whether to stub the symbol.
    expect(flat.get('./internal/typeGuards.js')).toEqual(['isRecord']);
  });

  it('returns symbols sorted alphabetically by name (deterministic)', () => {
    const result = extractTypes({ sourceFiles: [FIXTURE] });
    const names = result.symbols.map((s) => s.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});
