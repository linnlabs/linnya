import * as path from 'node:path';
import type ts from 'typescript';

import { getSlidesTypeScriptRuntime } from '../../capabilities/typescriptRuntime/index.js';
import { getCachedLibSourceFile } from './libFileCache.js';

/**
 * Build a minimal `ts.CompilerHost` for the codegen-source typecheck pipeline.
 *
 * Properties:
 *  - Backed by a fixed in-memory `Map<filename, ts.SourceFile>`.
 *  - Reads `lib.*.d.ts` from the real filesystem so `getSemanticDiagnostics`
 *    has access to ECMAScript globals (Array, Math, JSON, …).
 *  - Refuses any other filesystem access — unknown paths report
 *    `fileExists: false` so the program never accidentally pulls user files.
 *  - `writeFile` is a no-op (no emit).
 *
 * The host is intentionally stateless across `ts.createProgram` invocations.
 * Callers are expected to rebuild the source-file map per typecheck call;
 * caching of expensive entries (ambient.d.ts) is the caller's responsibility
 * (see `ambientLoader`).
 */
export interface VirtualCompilerHostOptions {
  /** Pre-built virtual source files keyed by filename. */
  sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  /** Returned from `getCurrentDirectory`. Defaults to `'/virtual'`. */
  currentDirectory?: string;
  /** Returned from `getNewLine`. Defaults to `'\n'`. */
  newLine?: string;
}

export function createVirtualCompilerHost(options: VirtualCompilerHostOptions): ts.CompilerHost {
  const { sourceFiles, currentDirectory = '/virtual', newLine = '\n' } = options;
  const typescript = getSlidesTypeScriptRuntime();

  return {
    getSourceFile: (fileName, languageVersion) => {
      const cached = sourceFiles.get(fileName);
      if (cached) return cached;
      if (isLibFile(fileName)) {
        return getCachedLibSourceFile(fileName, readScriptTarget(languageVersion), () =>
          typescript.sys.readFile(fileName)
        );
      }
      return undefined;
    },
    getDefaultLibFileName: opts => typescript.getDefaultLibFilePath(opts),
    writeFile: () => {},
    getCurrentDirectory: () => currentDirectory,
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => newLine,
    fileExists: fileName => {
      if (sourceFiles.has(fileName)) return true;
      if (isLibFile(fileName)) return typescript.sys.fileExists(fileName);
      return false;
    },
    readFile: fileName => {
      const cached = sourceFiles.get(fileName);
      if (cached) return cached.text;
      if (isLibFile(fileName)) return typescript.sys.readFile(fileName);
      return undefined;
    },
    getDirectories: () => [],
  };
}

function isLibFile(fileName: string): boolean {
  const base = path.basename(fileName);
  return base.startsWith('lib.') && base.endsWith('.d.ts');
}

function readScriptTarget(
  languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions
): ts.ScriptTarget {
  return typeof languageVersion === 'number' ? languageVersion : languageVersion.languageVersion;
}
