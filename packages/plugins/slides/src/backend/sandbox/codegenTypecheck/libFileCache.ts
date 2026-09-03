import type ts from 'typescript';

import { getSlidesTypeScriptRuntime } from '../../capabilities/typescriptRuntime/index.js';

/**
 * Per-process cache of parsed `lib.*.d.ts` SourceFiles.
 *
 * Without this cache, every `typecheckCodegenSource` call re-parses
 * `lib.es2020.d.ts` (~50 KB), which dominates the wall time (~40 ms cold) and
 * pushes warm typecheck p95 above 50 ms. With it, warm calls drop into the
 * <15 ms range.
 *
 * The cache is keyed by `(fileName, languageVersion)` because TypeScript can
 * change parser behavior subtly across script targets, and a SourceFile
 * parsed at ES2020 should not be reused for a program targeting ES2022.
 */

interface CacheKey {
  fileName: string;
  languageVersion: ts.ScriptTarget;
}

const cache = new Map<string, ts.SourceFile>();

function keyOf(k: CacheKey): string {
  return `${k.languageVersion}::${k.fileName}`;
}

/**
 * Return a cached `lib.*.d.ts` SourceFile, parsing on first miss via the
 * supplied `loader`. Returns `undefined` if the loader returns `undefined`
 * (e.g. file doesn't exist on disk).
 */
export function getCachedLibSourceFile(
  fileName: string,
  languageVersion: ts.ScriptTarget,
  loader: () => string | undefined
): ts.SourceFile | undefined {
  const k = keyOf({ fileName, languageVersion });
  const cached = cache.get(k);
  if (cached) return cached;
  const text = loader();
  if (text == null) return undefined;
  const typescript = getSlidesTypeScriptRuntime();
  const sf = typescript.createSourceFile(
    fileName,
    text,
    languageVersion,
    true,
    typescript.ScriptKind.TS
  );
  cache.set(k, sf);
  return sf;
}

/** Test-only helper: drop the in-process cache. */
export function __clearLibFileCacheForTests(): void {
  cache.clear();
}
