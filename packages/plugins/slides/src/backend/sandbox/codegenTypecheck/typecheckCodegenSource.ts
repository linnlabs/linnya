import type ts from 'typescript';

import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../../capabilities/typescriptRuntime/index.js';
import { type AmbientHandle, loadAmbient, type AmbientLoaderOptions } from './ambientLoader.js';
import { createVirtualCompilerHost } from './compilerHost.js';
import {
  type FormatDiagnosticsOptions,
  type FormattedDiagnosticsBundle,
  formatDiagnosticsForAi,
} from './diagnosticFormatter.js';

const DEFAULT_USER_FILE_VIRTUAL_NAME = '/virtual/deck.js';

/** Exported so other modules (e.g. tests, future error renderers) can reference the canonical filename. */
export const TYPECHECK_USER_FILE_VIRTUAL_NAME = DEFAULT_USER_FILE_VIRTUAL_NAME;

export interface TypecheckResult extends FormattedDiagnosticsBundle {
  /** True iff zero syntactic / semantic diagnostics on the user file. */
  ok: boolean;
  /** Wall-clock duration of the typecheck in ms (for performance assertions). */
  elapsedMs: number;
}

export interface TypecheckOptions {
  /** Override the user source filename inside the program. Default `/virtual/deck.js`. */
  sourceFileName?: string;
  /** Pre-loaded ambient handle (skips disk read). */
  ambient?: AmbientHandle;
  /** Forwarded to `loadAmbient` if `ambient` is not provided. */
  ambientLoader?: AmbientLoaderOptions;
  /** Forwarded to `formatDiagnosticsForAi`. */
  formatter?: Pick<FormatDiagnosticsOptions, 'maxSnippetLength' | 'maxDiagnostics'>;
}

/**
 * The codegen-source compile-time typecheck used by `write_file` for Slides
 * (and any future tool whose contract is "user supplies plain deck.js").
 *
 * Implementation notes:
 *  - `ScriptKind.JS` + `checkJs:true` makes TypeScript reject TS-only syntax
 *    (annotations, interface, enum, generics) with TS80xx codes — exactly the
 *    failure mode we need to surface to the AI.
 *  - The ambient `pptComposeProfile.ambient.d.ts` is loaded once per process
 *    and reused as a `ts.SourceFile` reference — warm typecheck calls run in
 *    ~10–30 ms once Node has the lib.d.ts bytes in fs cache.
 *  - `lib.es2020.d.ts` is included so calls like `Math.max`, `JSON.parse`,
 *    `Array.from` typecheck without errors.
 *  - `skipLibCheck:true` prevents diagnostics from leaking out of lib.d.ts
 *    or ambient.d.ts itself.
 *  - Only diagnostics on the **user file** are surfaced; ambient.d.ts errors
 *    would indicate a generator bug (caught separately by
 *    `codegen-first:dts:check`).
 */
export function typecheckCodegenSource(
  source: string,
  options: TypecheckOptions = {}
): TypecheckResult {
  const t0 = Date.now();
  const typescript = getSlidesTypeScriptRuntime();
  const ambient = options.ambient ?? loadAmbient(options.ambientLoader);
  const userFileName = options.sourceFileName ?? DEFAULT_USER_FILE_VIRTUAL_NAME;
  const userSf = typescript.createSourceFile(
    userFileName,
    source,
    typescript.ScriptTarget.ES2020,
    /* setParentNodes */ true,
    typescript.ScriptKind.JS
  );

  const sourceFiles = new Map<string, ts.SourceFile>([
    [ambient.virtualFileName, ambient.sourceFile],
    [userFileName, userSf],
  ]);
  const host = createVirtualCompilerHost({ sourceFiles });
  const program = typescript.createProgram({
    rootNames: [ambient.virtualFileName, userFileName],
    options: buildCompilerOptions(typescript),
    host,
  });

  // Read back the program's view of the user file (program may have re-parsed
  // it under different settings) — guarantees we collect diagnostics against
  // the same SourceFile the type-checker used.
  const programUserSf = program.getSourceFile(userFileName) ?? userSf;
  const diagnostics = [
    ...program.getSyntacticDiagnostics(programUserSf),
    ...program.getSemanticDiagnostics(programUserSf),
  ];

  const formatted = formatDiagnosticsForAi(diagnostics, {
    sourceText: source,
    ...options.formatter,
  });

  return {
    ok: diagnostics.length === 0,
    elapsedMs: Date.now() - t0,
    message: formatted.message,
    records: formatted.records,
  };
}

function buildCompilerOptions(typescript: SlidesTypeScriptRuntime): ts.CompilerOptions {
  return {
    target: typescript.ScriptTarget.ES2020,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    // codegen-source decks are not strict TS; AI doesn't write strict null checks.
    strict: false,
    noImplicitAny: false,
    // Suppress diagnostics from lib.d.ts / ambient.d.ts internals; we only care
    // about the user file's view of the global API.
    skipLibCheck: true,
    lib: ['lib.es2020.d.ts'],
    types: [],
  };
}
