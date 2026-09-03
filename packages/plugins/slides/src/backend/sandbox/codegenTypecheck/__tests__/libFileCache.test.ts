import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

import { __clearLibFileCacheForTests, getCachedLibSourceFile } from '../libFileCache.js';

describe('libFileCache', () => {
  beforeEach(() => __clearLibFileCacheForTests());
  afterEach(() => __clearLibFileCacheForTests());

  it('returns the same SourceFile reference across repeated lookups', () => {
    let calls = 0;
    const loader = () => {
      calls += 1;
      return 'declare const X: number;';
    };
    const a = getCachedLibSourceFile('/lib/test.d.ts', ts.ScriptTarget.ES2020, loader);
    const b = getCachedLibSourceFile('/lib/test.d.ts', ts.ScriptTarget.ES2020, loader);
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('re-parses when languageVersion differs (different cache slot)', () => {
    const loader = vi.fn(() => 'declare const X: number;');
    const a = getCachedLibSourceFile('/lib/test.d.ts', ts.ScriptTarget.ES2020, loader);
    const b = getCachedLibSourceFile('/lib/test.d.ts', ts.ScriptTarget.ES2022, loader);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('returns undefined and does not cache when loader returns undefined', () => {
    const loader = vi.fn(() => undefined);
    const r = getCachedLibSourceFile('/lib/missing.d.ts', ts.ScriptTarget.ES2020, loader);
    expect(r).toBeUndefined();
    // Subsequent call still consults the loader (no negative-caching).
    getCachedLibSourceFile('/lib/missing.d.ts', ts.ScriptTarget.ES2020, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('parses with setParentNodes:true so downstream AST traversals work', () => {
    const sf = getCachedLibSourceFile(
      '/lib/p.d.ts',
      ts.ScriptTarget.ES2020,
      () => 'declare function foo(): number;',
    )!;
    expect(sf).toBeDefined();
    const stmt = sf.statements[0]!;
    expect(stmt.parent).toBe(sf);
  });

  it('__clearLibFileCacheForTests evicts everything', () => {
    const loader = vi.fn(() => 'declare const X: number;');
    getCachedLibSourceFile('/lib/a.d.ts', ts.ScriptTarget.ES2020, loader);
    __clearLibFileCacheForTests();
    getCachedLibSourceFile('/lib/a.d.ts', ts.ScriptTarget.ES2020, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
