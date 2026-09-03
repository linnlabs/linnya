import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type ts from 'typescript';

import { getSlidesTypeScriptRuntime } from '../../capabilities/typescriptRuntime/index.js';

const DEFAULT_VIRTUAL_FILE_NAME = '/virtual/pptComposeProfile.ambient.d.ts';

/**
 * Pre-parsed handle for the canonical `pptComposeProfile.ambient.d.ts`.
 *
 * Multiple typecheck invocations reuse the same `sourceFile` reference so the
 * TypeScript program does not re-tokenize ~430 lines of d.ts on every
 * Slides `write_file` call. `ts.SourceFile` has no public mutation API, so sharing the
 * reference across programs is safe.
 */
export interface AmbientHandle {
  virtualFileName: string;
  sourceFile: ts.SourceFile;
  text: string;
}

export interface AmbientLoaderOptions {
  /** Override the on-disk path (mainly for tests). */
  ambientPath?: string;
  /** Override the virtual filename used in the program (rarely needed). */
  virtualFileName?: string;
  /** Bypass the in-process cache (mainly for tests). */
  bypassCache?: boolean;
}

export interface ResolveAmbientPathOptions {
  moduleUrl?: string;
  cwd?: string;
  resourcesPath?: string;
  fileExists?: (targetPath: string) => boolean;
}

interface CacheEntry {
  ambientPath: string;
  virtualFileName: string;
  handle: AmbientHandle;
}

let cached: CacheEntry | undefined;

/**
 * Load `pptComposeProfile.ambient.d.ts` from disk and return a cached
 * pre-parsed handle. Subsequent calls with the same `(ambientPath,
 * virtualFileName)` pair return the *same* `AmbientHandle` reference — this
 * is what keeps warm typecheck calls under ~30 ms.
 */
export function loadAmbient(options: AmbientLoaderOptions = {}): AmbientHandle {
  const ambientPath = options.ambientPath ?? defaultAmbientPath();
  const virtualFileName = options.virtualFileName ?? DEFAULT_VIRTUAL_FILE_NAME;

  if (
    !options.bypassCache &&
    cached &&
    cached.ambientPath === ambientPath &&
    cached.virtualFileName === virtualFileName
  ) {
    return cached.handle;
  }

  const typescript = getSlidesTypeScriptRuntime();
  const text = fs.readFileSync(ambientPath, 'utf-8');
  const sourceFile = typescript.createSourceFile(
    virtualFileName,
    text,
    typescript.ScriptTarget.ES2020,
    /* setParentNodes */ true,
    typescript.ScriptKind.TS
  );
  const handle: AmbientHandle = { virtualFileName, sourceFile, text };
  if (!options.bypassCache) {
    cached = { ambientPath, virtualFileName, handle };
  }
  return handle;
}

/** Test-only: drop the in-process cache so a subsequent `loadAmbient` reparses. */
export function __clearAmbientCacheForTests(): void {
  cached = undefined;
}

function defaultAmbientPath(): string {
  return resolveAmbientPathForRuntime({
    moduleUrl: readCurrentModuleUrl(),
  });
}

export function resolveAmbientPathForRuntime(options: ResolveAmbientPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const resourcesPath = options.resourcesPath ?? readResourcesPath();
  const fileExists = options.fileExists ?? fs.existsSync;
  const candidates = buildAmbientPathCandidates({
    moduleUrl: options.moduleUrl,
    cwd,
    resourcesPath,
  });

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      'Unable to locate pptComposeProfile.ambient.d.ts.',
      ...candidates.map(candidate => `candidate: ${candidate}`),
    ].join('\n')
  );
}

function buildAmbientPathCandidates(options: {
  moduleUrl?: string;
  cwd: string;
  resourcesPath?: string;
}): string[] {
  const candidates: string[] = [];

  if (typeof options.moduleUrl === 'string' && options.moduleUrl.length > 0) {
    try {
      const here = path.dirname(fileURLToPath(options.moduleUrl));
      candidates.push(
        path.resolve(here, '../pptComposeProfile.ambient.d.ts'),
        path.resolve(here, 'sandbox/pptComposeProfile.ambient.d.ts')
      );
    } catch {
      // CJS bundles may not expose a usable import.meta.url; fall back to runtime roots below.
    }
  }

  candidates.push(
    path.join(
      options.cwd,
      'packages',
      'plugins',
      'slides',
      'src',
      'backend',
      'sandbox',
      'pptComposeProfile.ambient.d.ts'
    ),
    path.join(
      options.cwd,
      'packages',
      'plugins',
      'slides',
      'dist',
      'backend',
      'sandbox',
      'pptComposeProfile.ambient.d.ts'
    )
  );

  if (typeof options.resourcesPath === 'string' && options.resourcesPath.length > 0) {
    candidates.push(
      path.join(
        options.resourcesPath,
        'app',
        'packages',
        'plugins',
        'slides',
        'src',
        'backend',
        'sandbox',
        'pptComposeProfile.ambient.d.ts'
      ),
      path.join(
        options.resourcesPath,
        'app',
        'packages',
        'plugins',
        'slides',
        'dist',
        'backend',
        'sandbox',
        'pptComposeProfile.ambient.d.ts'
      ),
      path.join(
        options.resourcesPath,
        'app.asar',
        'packages',
        'plugins',
        'slides',
        'src',
        'backend',
        'sandbox',
        'pptComposeProfile.ambient.d.ts'
      ),
      path.join(
        options.resourcesPath,
        'app.asar',
        'packages',
        'plugins',
        'slides',
        'dist',
        'backend',
        'sandbox',
        'pptComposeProfile.ambient.d.ts'
      )
    );
  }

  return dedupePaths(candidates);
}

function readCurrentModuleUrl(): string | undefined {
  try {
    return typeof import.meta.url === 'string' && import.meta.url.length > 0
      ? import.meta.url
      : undefined;
  } catch {
    return undefined;
  }
}

function readResourcesPath(): string | undefined {
  const resourcesPath = Reflect.get(process, 'resourcesPath');
  return typeof resourcesPath === 'string' && resourcesPath.length > 0 ? resourcesPath : undefined;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}
