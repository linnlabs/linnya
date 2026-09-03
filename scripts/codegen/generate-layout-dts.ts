/**
 * generate-layout-dts — CLI driver that produces the canonical
 * `pptComposeProfile.ambient.d.ts` consumed by:
 *
 *   1. The sandbox compile-time typechecker (P2.2 plumbing).
 *   2. The slides-design skill's generated `references/layoutPrimitives.d.ts`
 *      type truth.
 *
 * Run:
 *   npm run codegen-first:dts
 *
 * Programmatic API:
 *   `buildLayoutDts()`   — pure function, returns `{ content, outputPaths }`.
 *   `runGenerator()`     — writes the content to every output path.
 *
 * The pure function is exported so unit/integration tests and the
 * companion `check-layout-dts.ts` can validate output without spawning
 * a subprocess.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractTypes } from './layoutDts/extractTypes.js';
import { renderFactorySignatures } from './layoutDts/factorySignatures.js';
import { renderAmbientGlobals } from './layoutDts/ambientGlobals.js';
import { emitLayoutDts, EMIT_OPTIONS_FOR_GENERATOR } from './layoutDts/emit.js';
import {
  LAYOUT_TYPES_SOURCES,
  resolveOutputPaths,
  REPO_ROOT,
} from './layoutDts/outputs.js';

export interface BuildLayoutDtsResult {
  /** Final d.ts text that should be written to every output path. */
  content: string;
  /** Absolute paths to write the content to. */
  outputPaths: string[];
}

export function buildLayoutDts(): BuildLayoutDtsResult {
  const extracted = extractTypes({ sourceFiles: LAYOUT_TYPES_SOURCES });
  const factories = renderFactorySignatures();
  const globals = renderAmbientGlobals();

  // Drop module-scope FUNCTION exports (e.g. `isContainerNode`,
  // `isFlexComposeInput`). They live in `LayoutTypes.ts` for runtime
  // host-side use but are NOT injected into the sandbox in
  // `codegen-source` mode — declaring them in the ambient d.ts would
  // mislead the AI into generating code that compiles cleanly but fails
  // at runtime with `xxx is not defined`.
  //
  // Interfaces and type aliases are kept (they are pure type information,
  // erased at runtime, so always safe to expose).
  const moduleScopeTypes = extracted.symbols.filter(
    (s) => s.kind !== 'function',
  );

  const content = emitLayoutDts({
    moduleScopeTypes,
    ambientFactories: factories,
    ambientGlobals: globals,
    externalDependencies: extracted.externalDependencies,
    header: EMIT_OPTIONS_FOR_GENERATOR.headerLines.join('\n'),
  });

  return { content, outputPaths: resolveOutputPaths() };
}

export interface RunGeneratorResult {
  written: Array<{ path: string; bytes: number; changed: boolean }>;
}

export function runGenerator(): RunGeneratorResult {
  const { content, outputPaths } = buildLayoutDts();
  const written: RunGeneratorResult['written'] = [];

  for (const absPath of outputPaths) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const previous = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : null;
    if (previous === content) {
      written.push({ path: absPath, bytes: Buffer.byteLength(content, 'utf-8'), changed: false });
      continue;
    }
    fs.writeFileSync(absPath, content, 'utf-8');
    written.push({ path: absPath, bytes: Buffer.byteLength(content, 'utf-8'), changed: true });
  }

  return { written };
}

// CLI entrypoint — only run when invoked directly.
const isCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isCli) {
  const result = runGenerator();
  for (const w of result.written) {
    const rel = path.relative(REPO_ROOT, w.path);
    const tag = w.changed ? 'wrote' : 'unchanged';
    process.stdout.write(`[generate-layout-dts] ${tag} ${rel} (${w.bytes} bytes)\n`);
  }
  // Touch unused import lint suppressor.
  void fileURLToPath;
}
