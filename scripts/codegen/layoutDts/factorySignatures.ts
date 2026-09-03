/**
 * factorySignatures — hand-maintained TypeScript signatures for the
 * sandbox-injected factory functions defined as a JS string in
 * `packages/plugins/slides/src/backend/sandbox/layoutPrimitives.ts`.
 *
 * Why hand-written?
 * ─────────────────
 * `LAYOUT_PRIMITIVES_SOURCE` is a runtime-injected string of plain JS
 * functions with no type annotations, so we cannot mechanically derive
 * d.ts signatures from it. Drift between the runtime and these
 * declarations is prevented by `__tests__/factorySignatures.test.ts`,
 * which scans `LAYOUT_PRIMITIVES_SOURCE` for `function NAME(` patterns
 * and asserts the public set is identical to `FACTORY_SIGNATURES`.
 *
 * Output shape
 * ────────────
 * Each entry returns a single chunk of d.ts text *without* the `declare`
 * keyword — the emitter is responsible for wrapping them inside a
 * `declare global { ... }` block. Container factories
 * (createSlide / createFrame) declare the runtime-injected `add(...)`
 * helper as part of the return type.
 *
 * Overloads
 * ─────────
 * Several factories accept either a primary value (e.g. `createImage(src)`)
 * or a config bag (`createImage({ src, alt, ... })`). We express that with
 * multiple `function name(...)` declarations following standard d.ts
 * overload conventions.
 */

import type { ExtractedTypeSymbol } from './extractTypes.js';
import { compareAscii } from './sort.js';

/** Pre-rendered d.ts text + name for a single factory function. */
export interface FactorySignature {
  name: string;
  /** Raw d.ts text including JSDoc; no `declare` keyword. */
  text: string;
}

const ADD_METHOD =
  '    add(...children: Array<LayoutNode | LayoutNode[] | null | undefined>): ';

/**
 * Source-of-truth signature table. Keep entries in alphabetical order by
 * `name` — the renderer will not re-sort, so the on-disk order matches
 * the physical order here.
 */
export const FACTORY_SIGNATURES: readonly FactorySignature[] = Object.freeze([
  {
    name: 'createBrushArtwork',
    text: [
      '/**',
      ' * Create a deterministic opaque p5.brush image from declarative layers and marks.',
      ' * `backgroundColor` is required and must match the complete region behind the image.',
      ' */',
      'function createBrushArtwork(config: LayoutBrushArtworkConfig): LayoutImageNode;',
    ].join('\n'),
  },
  {
    name: 'createChart',
    text: [
      '/**',
      ' * Create a chart leaf node. Pass a preset name string (e.g. "clean-column",',
      ' * "doughnut"), a config object, or nothing and configure properties later.',
      ' */',
      'function createChart(): LayoutChartNode;',
      'function createChart(preset: LayoutChartPresetName): LayoutChartNode;',
      'function createChart(config: LayoutChartConfig): LayoutChartNode;',
    ].join('\n'),
  },
  {
    name: 'createFrame',
    text: [
      '/**',
      ' * Create a generic flex container (replaces VStack/HStack). Configure',
      ' * `flexDirection`, `padding`, `gap`, etc. either via the optional config',
      ' * object or by direct property assignment after creation.',
      ' *',
      ' * The returned node carries an `add(...children)` method that accepts a',
      ' * mix of single nodes, arrays of nodes, and `null` / `undefined` (skipped).',
      ' */',
      'function createFrame(config?: LayoutViewConfig): LayoutViewNode & {',
      `${ADD_METHOD}LayoutViewNode;`,
      '};',
    ].join('\n'),
  },
  {
    name: 'createImage',
    text: [
      '/**',
      ' * Create an image leaf node. Pass an image source (string URL / data URI /',
      ' * absolute local path / formal source object) or a config object containing',
      ' * `src` plus any visual options (`fitMode`, `maskShape`, `shadow`, ...).',
      ' */',
      'function createImage(): LayoutImageNode;',
      'function createImage(src: LayoutImageSourceInput): LayoutImageNode;',
      'function createImage(config: LayoutImageConfig): LayoutImageNode;',
    ].join('\n'),
  },
  {
    name: 'createShape',
    text: [
      '/**',
      ' * Create a shape leaf node. `fill` accepts a color or linear/radial gradient;',
      ' * `border.paint` accepts a linear gradient (radial stroke is intentionally unsupported).',
      ' * Configure `geometry`, `fill`, `border`, `borderRadius`, `opacity`,',
      ' * `rotate`, `content` etc. through the optional',
      ' * config object or by direct property assignment.',
      ' */',
      'function createShape(config?: LayoutShapeConfig): LayoutShapeNode;',
    ].join('\n'),
  },
  {
    name: 'createSlide',
    text: [
      '/**',
      ' * Create a Slide root container. Each call produces one slide; assemble',
      ' * the slide tree with the `add(...children)` method, then pass the array',
      ' * of slides to `compose({ slides: [...] })`.',
      ' *',
      ' * Configure background / notes either via the optional',
      ' * config object or by direct property assignment after creation.',
      ' */',
      'function createSlide(config?: LayoutSlideConfig): LayoutSlideNode & {',
      `${ADD_METHOD}LayoutSlideNode;`,
      '};',
    ].join('\n'),
  },
  {
    name: 'createFormula',
    text: [
      '/**',
      ' * Create an editable native PowerPoint math formula from the supported',
      ' * LaTeX profile. The preview uses the sibling SVG projection.',
      ' */',
      'function createFormula(): LayoutFormulaNode;',
      'function createFormula(latex: string): LayoutFormulaNode;',
      'function createFormula(config: LayoutFormulaConfig): LayoutFormulaNode;',
    ].join('\n'),
  },
  {
    name: 'createSpacer',
    text: [
      '/**',
      ' * Create a flex Spacer (zero visual output). Use `flex: N` to claim a',
      ' * proportional share of remaining space inside a flex container.',
      ' */',
      'function createSpacer(config?: LayoutSpacerConfig): LayoutSpacerNode;',
    ].join('\n'),
  },
  {
    name: 'createSvgGraphic',
    text: [
      '/**',
      ' * Create a text-free SVG graphic. Pass inline SVG text, a formal SVG source,',
      ' * or a config object. Use createText() for all presentation text.',
      ' */',
      'function createSvgGraphic(): LayoutSvgGraphicNode;',
      'function createSvgGraphic(source: LayoutSvgGraphicSourceInput): LayoutSvgGraphicNode;',
      'function createSvgGraphic(config: LayoutSvgGraphicConfig): LayoutSvgGraphicNode;',
    ].join('\n'),
  },
  {
    name: 'createTable',
    text: [
      '/**',
      ' * Create a table leaf node. Provide `headers` + `rows` at the top level,',
      ' * Cell entries can be display values or `LayoutTableCellInput` objects',
      ' * with per-cell styling and row/column spans.',
      ' */',
      'function createTable(config?: LayoutTableConfig): LayoutTableNode;',
    ].join('\n'),
  },
  {
    name: 'createText',
    text: [
      '/**',
      ' * Create a text leaf node. Pass a plain string (newlines preserved),',
      ' * a `LayoutTextRun[]` array for rich text, a config object, or nothing',
      ' * and configure properties later.',
      ' */',
      'function createText(): LayoutTextNode;',
      'function createText(content: string): LayoutTextNode;',
      'function createText(content: number | boolean): LayoutTextNode;',
      'function createText(content: LayoutTextRun[]): LayoutTextNode;',
      'function createText(config: LayoutTextConfig): LayoutTextNode;',
    ].join('\n'),
  },
] as const);

/** Render the signature table as a list of {@link ExtractedTypeSymbol}s
 *  so the emitter can mix them with extracted types using a uniform shape. */
export function renderFactorySignatures(): ExtractedTypeSymbol[] {
  return [...FACTORY_SIGNATURES]
    .sort((a, b) => compareAscii(a.name, b.name))
    .map<ExtractedTypeSymbol>((sig) => ({
      name: sig.name,
      kind: 'function',
      text: sig.text,
      sourceFile: 'LAYOUT_PRIMITIVES_SOURCE',
    }));
}
