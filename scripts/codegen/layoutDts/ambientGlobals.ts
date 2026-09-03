/**
 * ambientGlobals — hand-written ambient declarations for the symbols
 * `packages/plugins/slides/src/backend/sandbox/pptComposeProfile.ts`
 * injects into the sandbox in `codegen-source` mode.
 *
 * Maintenance contract
 * ────────────────────
 * Whenever `pptComposeProfile.prepareExecution` adds / removes / renames
 * a global (either `runnerRequest.globals.X` or a capability binding),
 * mirror the change here AND update `__tests__/ambientGlobals.test.ts`.
 *
 * What is intentionally absent
 * ────────────────────────────
 * - `editPresentation` is NOT declared. In `codegen-source` mode the
 *   profile installs a stub that throws (see `buildUnavailableStub`),
 *   so declaring it would mislead the type-checker into accepting code
 *   that the sandbox always rejects.
 * - `console` / `JSON` / `Math` / `Array` / `Object` / `String` etc. are
 *   provided by `lib.es*` and require no project-level redeclaration.
 *
 * Output shape
 * ────────────
 * Same `ExtractedTypeSymbol` envelope as `extractTypes` and
 * `factorySignatures`, so the emitter can interleave all three sources
 * with a single sort + render pipeline.
 */

import type { ExtractedTypeSymbol } from './extractTypes.js';
import { compareAscii } from './sort.js';

/** Pre-rendered d.ts text for a single sandbox-injected global. */
export interface AmbientGlobalEntry {
  name: string;
  /** Raw d.ts text including JSDoc; no `declare` keyword. */
  text: string;
}

export const AMBIENT_GLOBALS: readonly AmbientGlobalEntry[] = Object.freeze([
  {
    name: 'CHART_PRESETS',
    text: [
      '/**',
      ' * Names of all registered chart presets. Pass any entry as the first',
      ' * argument to `createChart()` (e.g. `createChart("clean-column")`).',
      ' */',
      'const CHART_PRESETS: readonly LayoutChartPresetName[];',
    ].join('\n'),
  },
  {
    name: 'DECK_DESIGN',
    text: [
      '/**',
      ' * Existing-deck design anchors. Always defined, even when the deck has no',
      ' * matching theme values (sandbox then provides an empty skeleton),',
      ' * so `DECK_DESIGN.palette.accent1 ?? "#000"` is always safe.',
      ' */',
      'const DECK_DESIGN: {',
      '  palette: {',
      '    accent1?: string;',
      '    accent2?: string;',
      '    accent3?: string;',
      '    background?: string;',
      '    text?: string;',
      '    muted?: string;',
      '  };',
      '  fonts: { major?: string; minor?: string };',
      '};',
    ].join('\n'),
  },
  {
    name: 'SLIDE_H',
    text: [
      '/** Sandbox 16:9 reference height in inches (5.625); prefer flex/percent for other layouts. */',
      'const SLIDE_H: number;',
    ].join('\n'),
  },
  {
    name: 'SLIDE_W',
    text: [
      '/** Sandbox 16:9 reference width in inches (10); prefer flex/percent for other layouts. */',
      'const SLIDE_W: number;',
    ].join('\n'),
  },
  {
    name: 'compose',
    text: [
      '/**',
      ' * Submit the assembled deck to the host. Must be called exactly once at',
      ' * the end of the script. After calling `compose(...)` the script body',
      ' * should return — anything that throws afterwards is recoverable but',
      ' * surfaces as a warning.',
      ' */',
      'function compose(input: FlexComposeInput): void;',
    ].join('\n'),
  },
  {
    name: 'console',
    text: [
      '/**',
      ' * Sandbox-provided logging sink. Messages are captured by the runner',
      ' * and returned as sandbox logs; only log/warn/error are available.',
      ' */',
      'const console: {',
      '  log(...args: unknown[]): void;',
      '  warn(...args: unknown[]): void;',
      '  error(...args: unknown[]): void;',
      '};',
    ].join('\n'),
  },
] as const);

export function renderAmbientGlobals(): ExtractedTypeSymbol[] {
  return [...AMBIENT_GLOBALS]
    .sort((a, b) => compareAscii(a.name, b.name))
    .map<ExtractedTypeSymbol>((entry) => ({
      name: entry.name,
      // Treat all ambient globals uniformly as 'function'-kind for the
      // emitter's purpose (they all live inside `declare global { ... }`
      // and the kind field is purely informational for the report).
      kind: 'function',
      text: entry.text,
      sourceFile: 'pptComposeProfile.ts (sandbox bindings)',
    }));
}
