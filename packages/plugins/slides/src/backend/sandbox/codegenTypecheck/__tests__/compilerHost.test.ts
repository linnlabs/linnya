import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { createVirtualCompilerHost } from '../compilerHost.js';

function makeSf(name: string, text: string, kind: ts.ScriptKind = ts.ScriptKind.TS): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2020, true, kind);
}

describe('createVirtualCompilerHost', () => {
  it('returns the in-memory SourceFile for a known virtual filename (by reference)', () => {
    const sf = makeSf('/virtual/a.ts', 'export const x = 1;');
    const host = createVirtualCompilerHost({ sourceFiles: new Map([['/virtual/a.ts', sf]]) });
    expect(host.getSourceFile('/virtual/a.ts', ts.ScriptTarget.ES2020)).toBe(sf);
  });

  it('returns undefined for unknown non-lib paths and never reads them from disk', () => {
    const host = createVirtualCompilerHost({ sourceFiles: new Map() });
    expect(host.getSourceFile('/virtual/missing.ts', ts.ScriptTarget.ES2020)).toBeUndefined();
    expect(host.fileExists('/virtual/missing.ts')).toBe(false);
    expect(host.readFile('/virtual/missing.ts')).toBeUndefined();
  });

  it('falls back to the real filesystem for `lib.*.d.ts` so semantic checks have ES globals', () => {
    const host = createVirtualCompilerHost({ sourceFiles: new Map() });
    const libPath = host.getDefaultLibFileName({});
    expect(host.fileExists(libPath)).toBe(true);
    const text = host.readFile(libPath);
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
    const sf = host.getSourceFile(libPath, ts.ScriptTarget.ES2020);
    expect(sf).toBeDefined();
    // The root lib.d.ts itself is just a set of reference directives; its
    // body may be empty, but its text must round-trip through the parser.
    expect(sf!.text).toBe(text);
  });

  it('writeFile is a no-op (no emit allowed)', () => {
    const host = createVirtualCompilerHost({ sourceFiles: new Map() });
    expect(() => host.writeFile('/virtual/out.js', 'x', false)).not.toThrow();
  });

  it('honours overridable currentDirectory / newLine', () => {
    const host = createVirtualCompilerHost({
      sourceFiles: new Map(),
      currentDirectory: '/override',
      newLine: '\r\n',
    });
    expect(host.getCurrentDirectory()).toBe('/override');
    expect(host.getNewLine()).toBe('\r\n');
  });

  it('uses case-sensitive filename matching', () => {
    const sf = makeSf('/virtual/Case.ts', 'const x = 1;');
    const host = createVirtualCompilerHost({ sourceFiles: new Map([['/virtual/Case.ts', sf]]) });
    expect(host.useCaseSensitiveFileNames()).toBe(true);
    expect(host.getCanonicalFileName('/virtual/Case.ts')).toBe('/virtual/Case.ts');
    expect(host.getSourceFile('/virtual/case.ts', ts.ScriptTarget.ES2020)).toBeUndefined();
  });

  it('end-to-end: createProgram + getSyntacticDiagnostics works with virtual files only', () => {
    const sf = makeSf('/virtual/main.js', 'const x = ;', ts.ScriptKind.JS);
    const host = createVirtualCompilerHost({ sourceFiles: new Map([['/virtual/main.js', sf]]) });
    const program = ts.createProgram({
      rootNames: ['/virtual/main.js'],
      options: { allowJs: true, noEmit: true, lib: ['lib.es2020.d.ts'], skipLibCheck: true },
      host,
    });
    const diags = program.getSyntacticDiagnostics(sf);
    expect(diags.length).toBeGreaterThan(0);
  });
});
