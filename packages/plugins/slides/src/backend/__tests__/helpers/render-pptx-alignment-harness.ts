import { RenderModelMapper } from '../../engine/parser/RenderModelMapper.js';
import { applyTextLayoutToRenderModel } from '../../engine/text/renderModelTextLayout.js';
import { StructuredCompiler } from '../../engine/StructuredCompiler.js';
import { createSpiedPptx } from './pptx-spy.js';
import type {
  DeckSpec,
  ShapeGeometrySpec,
  StructuredElement,
  StructuredSlideSpec,
  ThemeSpec,
} from '@plugin/slides/shared';
import { diffElements, type FieldDiff } from './render-pptx-alignment-diff.js';
import { normalizePptxCapture, normalizeRenderNode, type NormalizedElement } from './render-pptx-alignment-normalizers.js';

export { diffElements };
export type { NormalizedElement };

type StructuredShapeElement = Extract<StructuredElement, { type: 'shape' }>;

// ═══════════════════════════════════════════════════════════════════════════
// 管线驱动
// ═══════════════════════════════════════════════════════════════════════════

const mapper = new RenderModelMapper();
const compiler = new StructuredCompiler();
const SLIDE_SIZE = { width: 10, height: 5.625 };

export interface DualPipelineResult {
  konva: NormalizedElement[];
  pptx: NormalizedElement[];
  diffs: FieldDiff[];
}

/**
 * 同一份 DeckSpec 同时走两条管线，返回归一化元素和 diff 报告。
 */
export function runDualPipeline(
  elements: StructuredElement[],
  theme?: ThemeSpec,
): DualPipelineResult {
  const spec: StructuredSlideSpec = {
    type: 'structured',
    elements,
  };
  const deckSpec: DeckSpec = {
    title: 'Alignment Test',
    theme,
    slides: [{ slideNumber: 1, spec }],
  };

  // Konva 侧
  const renderModel = mapper.fromGeneratedDeck('align-test', 1, 'Alignment Test', deckSpec, SLIDE_SIZE);
  applyTextLayoutToRenderModel(renderModel);
  const slide = renderModel.slides[0]!;
  const konvaElements = slide.elements.map((n, i) => normalizeRenderNode(n, i));

  // PPTX 侧
  const { pptx, slideCaptures } = createSpiedPptx();
  pptx.layout = 'LAYOUT_16x9';
  if (theme) {
    const themeProps: Record<string, unknown> = {};
    if (theme.fonts?.major) themeProps.headFontFace = theme.fonts.major;
    if (theme.fonts?.minor) themeProps.bodyFontFace = theme.fonts.minor;
    (pptx as unknown as { theme: unknown }).theme = themeProps;
  }
  compiler.compileSlide(pptx, spec, theme);
  const captures = slideCaptures[0] ?? [];
  const pptxElements = captures.map((c, i) => normalizePptxCapture(c, i));

  const diffs = diffElements(konvaElements, pptxElements);

  return { konva: konvaElements, pptx: pptxElements, diffs };
}

// ─── 报告输出 ───────────────────────────────────────────────────────────

export function printReport(result: DualPipelineResult, label: string): void {
  if (result.diffs.length === 0) {
    console.log(`[${label}] 全部 ${result.konva.length} 个元素对齐 ✓`);
    return;
  }

  const errors = result.diffs.filter((d) => d.severity === 'error' && !d.whitelisted);
  const warnings = result.diffs.filter((d) => d.severity === 'warning' && !d.whitelisted);
  const infos = result.diffs.filter((d) => d.severity === 'info' || d.whitelisted);

  console.log(`\n[${label}] ${result.konva.length} 元素, ${result.diffs.length} 差异 (${errors.length} error, ${warnings.length} warning, ${infos.length} info)`);
  console.table(
    result.diffs
      .filter((d) => d.severity !== 'info')
      .map((d) => ({
        '#': d.elementIndex,
        type: d.elementType,
        field: d.field,
        konva: formatValue(d.konvaValue),
        pptx: formatValue(d.pptxValue),
        severity: d.severity,
        whitelisted: d.whitelisted ?? '',
      })),
  );
}

function formatValue(v: unknown): string {
  if (v == null) return '(nil)';
  if (typeof v === 'number') return Number(v.toFixed(4)).toString();
  return String(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// 测试 Fixtures
// ═══════════════════════════════════════════════════════════════════════════

export const THEME: ThemeSpec = {
  fonts: { major: 'Arial', minor: 'Calibri' },
};

export const TINY_PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function makeTitle(
  content: string,
  box: { x: number; y: number; w: number; h: number },
  style?: Record<string, unknown>,
): StructuredElement {
  return {
    type: 'title',
    content,
    position: box,
    style: style as StructuredElement extends { style?: infer S } ? S : never,
  } as StructuredElement;
}

export function makeText(
  content: string,
  box: { x: number; y: number; w: number; h: number },
  style?: Record<string, unknown>,
): StructuredElement {
  return {
    type: 'text',
    content,
    position: box,
    style: style as StructuredElement extends { style?: infer S } ? S : never,
  } as StructuredElement;
}

export function makeBulletList(
  items: Array<{ text: string; level?: number }>,
  box: { x: number; y: number; w: number; h: number },
  style?: Record<string, unknown>,
): StructuredElement {
  return {
    type: 'bulletList',
    items,
    position: box,
    style,
  } as StructuredElement;
}

export function makeChart(
  chartType: string,
  box: { x: number; y: number; w: number; h: number },
  options?: Record<string, unknown>,
): StructuredElement {
  return {
    type: 'chart',
    chartType,
    data: {
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { name: '收入', labels: [], values: [100, 150, 200, 180] },
        { name: '利润', labels: [], values: [30, 45, 60, 50] },
      ],
    },
    position: box,
    options,
  } as StructuredElement;
}

export function makeTable(
  headers: string[],
  rows: Array<Array<{ text: string; style?: Record<string, unknown>; fill?: string; colspan?: number; rowspan?: number }>>,
  box: { x: number; y: number; w: number; h: number },
  options?: Record<string, unknown>,
): StructuredElement {
  return {
    type: 'table',
    headers,
    rows,
    position: box,
    options,
  } as StructuredElement;
}

export function makeShape(
  geometry: ShapeGeometrySpec,
  box: { x: number; y: number; w: number; h: number },
  style?: StructuredShapeElement['style'],
  text?: string,
): StructuredShapeElement {
  return {
    type: 'shape',
    geometry,
    position: box,
    style,
    text,
  };
}

export function makeImage(
  src: string,
  box: { x: number; y: number; w: number; h: number },
  alt?: string,
): StructuredElement {
  return {
    type: 'image',
    src,
    position: box,
    alt,
  } as StructuredElement;
}
