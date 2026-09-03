import { describe, expect, it } from 'vitest';

import type { ExtractedTypeSymbol, ExternalDependency } from '../extractTypes.js';
import { emitLayoutDts, EMIT_OPTIONS_FOR_GENERATOR } from '../emit.js';

const baseTypes: ExtractedTypeSymbol[] = [
  {
    name: 'FlexProps',
    kind: 'interface',
    // intentionally references `ChartType` (an external dep) so the
    // stub-collection filter has something to anchor on.
    text: '/** Flex props. */\ninterface FlexProps {\n  width?: number;\n  chart?: ChartType;\n}',
    sourceFile: '/abs/LayoutTypes.ts',
  },
  {
    name: 'LayoutNode',
    kind: 'type-alias',
    // references `TableCell`, the second external dep used in the tests.
    text: '/** Union. */\ntype LayoutNode = FlexProps | { cell?: TableCell };',
    sourceFile: '/abs/LayoutTypes.ts',
  },
];

const baseFactories: ExtractedTypeSymbol[] = [
  {
    name: 'createSlide',
    kind: 'function',
    text: '/** Slide. */\nfunction createSlide(): FlexProps;',
    sourceFile: 'LAYOUT_PRIMITIVES_SOURCE',
  },
];

const baseGlobals: ExtractedTypeSymbol[] = [
  {
    name: 'SLIDE_W',
    kind: 'function',
    text: '/** Width. */\nconst SLIDE_W: number;',
    sourceFile: 'pptComposeProfile.ts (sandbox bindings)',
  },
];

const baseDeps: ExternalDependency[] = [
  { moduleName: '../../domain/SlideSpec.js', importedNames: ['ChartType', 'TableCell'] },
];

describe('emitLayoutDts', () => {
  it('produces a non-empty string with the expected top-level layout', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: baseDeps,
      header: 'Auto-generated. DO NOT EDIT.',
    });

    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('Auto-generated. DO NOT EDIT.');
    expect(out).toContain('interface FlexProps');
    expect(out).toContain('type LayoutNode');
    expect(out).toContain('declare global');
    expect(out).toContain('function createSlide');
    expect(out).toContain('const SLIDE_W');
    expect(out).toContain('export {}'); // makes the file a module
  });

  it('places module-scope types BEFORE the `declare global { ... }` block', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: [],
      header: 'h',
    });
    const interfaceIdx = out.indexOf('interface FlexProps');
    const declareGlobalIdx = out.indexOf('declare global');
    expect(interfaceIdx).toBeGreaterThan(-1);
    expect(declareGlobalIdx).toBeGreaterThan(-1);
    expect(interfaceIdx).toBeLessThan(declareGlobalIdx);
  });

  it('emits external dependencies as `type X = unknown;` stubs at the top of module scope', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: baseDeps,
      header: 'h',
    });
    expect(out).toMatch(/type ChartType\s*=\s*unknown;/);
    expect(out).toMatch(/type TableCell\s*=\s*unknown;/);

    const chartIdx = out.indexOf('type ChartType');
    const flexIdx = out.indexOf('interface FlexProps');
    expect(chartIdx).toBeLessThan(flexIdx); // stubs come before real types
  });

  it('does NOT emit a stub for an external name that is also defined as a moduleScope type', () => {
    // Suppose `FlexProps` happens to also appear as an external import name —
    // the local definition wins and no stub is emitted.
    const types: ExtractedTypeSymbol[] = [
      ...baseTypes,
      {
        name: 'WithMissing',
        kind: 'type-alias',
        text: 'type WithMissing = AlsoMissing;', // forces AlsoMissing to be referenced
        sourceFile: '/abs/LayoutTypes.ts',
      },
    ];
    const deps: ExternalDependency[] = [
      { moduleName: 'phantom', importedNames: ['FlexProps', 'AlsoMissing'] },
    ];
    const out = emitLayoutDts({
      moduleScopeTypes: types,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: deps,
      header: 'h',
    });
    expect(out).toMatch(/type AlsoMissing\s*=\s*unknown;/);
    expect(out).not.toMatch(/type FlexProps\s*=\s*unknown;/);
  });

  it('does NOT emit a stub for an external name that is never referenced (e.g. value-only imports whose use sites were dropped)', () => {
    const deps: ExternalDependency[] = [
      { moduleName: './guards.js', importedNames: ['isRecord'] },
    ];
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: deps,
      header: 'h',
    });
    expect(out).not.toMatch(/type isRecord\s*=\s*unknown;/);
  });

  it('matches identifier names by whole-word boundary (no substring leakage)', () => {
    // `Chart` is a substring of `ChartType` (already referenced via baseTypes),
    // but `Chart` itself is NOT referenced anywhere — must not be stubbed.
    const deps: ExternalDependency[] = [
      { moduleName: 'phantom', importedNames: ['Chart'] },
    ];
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: deps,
      header: 'h',
    });
    expect(out).not.toMatch(/type Chart\s*=\s*unknown;/);
  });

  it('emits an indexable object stub when an external type is used through string-literal indexed access', () => {
    const types: ExtractedTypeSymbol[] = [
      {
        name: 'TextNode',
        kind: 'interface',
        text: "interface TextNode {\n  textAlign?: DomainTextStyle['align'];\n  verticalAlign?: DomainTextStyle[\"valign\"];\n}",
        sourceFile: '/abs/LayoutTypes.ts',
      },
    ];
    const deps: ExternalDependency[] = [
      { moduleName: '../../domain/SlideSpec.js', importedNames: ['DomainTextStyle'] },
    ];
    const out = emitLayoutDts({
      moduleScopeTypes: types,
      ambientFactories: [],
      ambientGlobals: [],
      externalDependencies: deps,
      header: 'h',
    });

    expect(out).toContain('type DomainTextStyle = {');
    expect(out).toContain('"align": unknown;');
    expect(out).toContain('"valign": unknown;');
    expect(out).not.toContain('type DomainTextStyle = unknown;');
  });

  it('groups all factories and globals inside one `declare global { ... }` block', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: [],
      header: 'h',
    });
    const open = out.indexOf('declare global {');
    const close = out.indexOf('}', open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);

    const block = out.slice(open, out.lastIndexOf('}') + 1);
    expect(block).toContain('function createSlide');
    expect(block).toContain('const SLIDE_W');
  });

  it('output is fully deterministic for identical input (byte-equal across runs)', () => {
    const opts = {
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: baseDeps,
      header: 'stable header',
    };
    const a = emitLayoutDts(opts);
    const b = emitLayoutDts(opts);
    expect(a).toBe(b);
  });

  it('output ends with a single trailing newline (POSIX text-file convention)', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: [],
      header: 'h',
    });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n\n')).toBe(false);
  });

  it('uses LF line endings only (no CRLF)', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: baseTypes,
      ambientFactories: baseFactories,
      ambientGlobals: baseGlobals,
      externalDependencies: [],
      header: 'h',
    });
    expect(out).not.toMatch(/\r\n/);
  });

  it('EMIT_OPTIONS_FOR_GENERATOR exposes the canonical header used by the CLI driver', () => {
    expect(EMIT_OPTIONS_FOR_GENERATOR.headerLines.length).toBeGreaterThan(0);
    // The header must mention the generator script so the maintainer can find it.
    expect(EMIT_OPTIONS_FOR_GENERATOR.headerLines.join('\n')).toContain(
      'scripts/codegen/generate-layout-dts.ts',
    );
  });

  it('handles empty inputs gracefully (still emits header + `declare global {}` + `export {}`)', () => {
    const out = emitLayoutDts({
      moduleScopeTypes: [],
      ambientFactories: [],
      ambientGlobals: [],
      externalDependencies: [],
      header: 'empty case',
    });
    expect(out).toContain('empty case');
    expect(out).toContain('declare global');
    expect(out).toContain('export {}');
  });
});
