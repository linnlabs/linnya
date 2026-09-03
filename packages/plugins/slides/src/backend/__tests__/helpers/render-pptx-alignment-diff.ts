import type {
  NormalizedChartProps,
  NormalizedElement,
  NormalizedGeometry,
  NormalizedShapeProps,
  NormalizedTableProps,
  NormalizedTextProps,
} from './render-pptx-alignment-normalizers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Diff 引擎
// ═══════════════════════════════════════════════════════════════════════════

export type DiffCategory = 'GEOMETRY' | 'TEXT_STYLE' | 'CHART_CONFIG' | 'VISUAL_STYLE' | 'TABLE_LAYOUT';
export type DiffSeverity = 'error' | 'warning' | 'info';

export interface FieldDiff {
  elementIndex: number;
  elementType: string;
  field: string;
  konvaValue: unknown;
  pptxValue: unknown;
  category: DiffCategory;
  severity: DiffSeverity;
  whitelisted?: string;
}

// ─── 已知差异白名单 ─────────────────────────────────────────────────────

interface WhitelistEntry {
  type?: string;
  field: string;
  reason: string;
}

const KNOWN_WHITELIST: WhitelistEntry[] = [
  // title 在 PPTX 侧默认 bold=true, fontSize=24；RenderModel 侧不一定设这些默认值
  { type: 'text', field: 'text.bold', reason: 'PPTX title 默认 bold=true' },
  { type: 'text', field: 'text.fontSize', reason: 'PPTX title 默认 fontSize=24' },
  // fontFamily：Konva 从主题继承默认值，PPTX 侧仅在 style 显式设置时才传
  { field: 'text.fontFamily', reason: 'Konva 从主题继承 fontFamily，PPTX 仅在 style 显式指定时设置' },
  // valign：Konva 默认 top，PPTX 不设 valign 时由 PowerPoint 自行处理
  { field: 'text.valign', reason: 'Konva 默认 valign=top，PPTX 不显式设置' },
  // color：PptxGenJS 可能在内部添加默认 color，而 Konva 侧在 style 未指定时为 undefined
  { field: 'text.color', reason: 'PptxGenJS 默认 color vs Konva 无默认' },
  // chart background：PPTX 透明 vs Konva 可能白色
  { type: 'chart', field: 'shape.fill', reason: 'chart 背景 PPTX 透明 vs Konva 白色' },
  // 表格 fontSize 因密度公式细微差异
  { type: 'table', field: 'table.fontSize', reason: '表格 fontSize 密度公式两侧可能略有差异' },
  // shape 带 text 时：PPTX 用 addText(shape=...)，Konva 侧拆为 ShapeRenderNode+innerText
  { type: 'shape', field: 'shape.fill', reason: 'shape+text 场景下 PPTX 合并到 addText opts，Konva 拆开' },
  { type: 'shape', field: 'shape.cornerRadius', reason: 'shape+text 场景下 cornerRadius 在不同层级' },
];

function matchWhitelist(elementType: string, field: string): WhitelistEntry | undefined {
  return KNOWN_WHITELIST.find(
    (w) => (!w.type || w.type === elementType) && w.field === field,
  );
}

// ─── 容差策略 ───────────────────────────────────────────────────────────

function geometrySeverity(delta: number): DiffSeverity {
  const abs = Math.abs(delta);
  if (abs <= 0.01) return 'info';
  if (abs <= 0.05) return 'warning';
  return 'error';
}

function numericSeverity(delta: number, toleranceInfo: number, toleranceWarn: number): DiffSeverity {
  const abs = Math.abs(delta);
  if (abs <= toleranceInfo) return 'info';
  if (abs <= toleranceWarn) return 'warning';
  return 'error';
}

// ─── 核心 diff 逻辑 ─────────────────────────────────────────────────────

export function diffElements(
  konvaElements: NormalizedElement[],
  pptxElements: NormalizedElement[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const count = Math.max(konvaElements.length, pptxElements.length);

  for (let i = 0; i < count; i++) {
    const konva = konvaElements[i];
    const pptx = pptxElements[i];

    if (!konva || !pptx) {
      diffs.push({
        elementIndex: i,
        elementType: konva?.type ?? pptx?.type ?? 'unknown',
        field: !konva ? 'MISSING_IN_KONVA' : 'MISSING_IN_PPTX',
        konvaValue: konva ? 'present' : 'missing',
        pptxValue: pptx ? 'present' : 'missing',
        category: 'GEOMETRY',
        severity: 'error',
      });
      continue;
    }

    const elementType = konva.type;

    diffGeometry(diffs, i, elementType, konva.geometry, pptx.geometry);
    diffTextProps(diffs, i, elementType, konva.text, pptx.text);
    diffChartProps(diffs, i, elementType, konva.chart, pptx.chart);
    diffShapeProps(diffs, i, elementType, konva.shape, pptx.shape);
    diffTableProps(diffs, i, elementType, konva.table, pptx.table);
  }

  return diffs;
}

function diffGeometry(
  diffs: FieldDiff[],
  index: number,
  type: string,
  konva: NormalizedGeometry,
  pptx: NormalizedGeometry,
): void {
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const delta = (konva[key] ?? 0) - (pptx[key] ?? 0);
    if (Math.abs(delta) > 0.001) {
      pushDiff(diffs, index, type, `geometry.${key}`, konva[key], pptx[key], 'GEOMETRY', geometrySeverity(delta));
    }
  }
}

function diffTextProps(
  diffs: FieldDiff[],
  index: number,
  type: string,
  konva: NormalizedTextProps | undefined,
  pptx: NormalizedTextProps | undefined,
): void {
  if (!konva && !pptx) return;
  const k = konva ?? {};
  const p = pptx ?? {};

  diffNumericField(diffs, index, type, 'text.fontSize', k.fontSize, p.fontSize, 0, 0.5, 'TEXT_STYLE');
  diffStringField(diffs, index, type, 'text.fontFamily', k.fontFamily, p.fontFamily, 'TEXT_STYLE');
  diffBoolField(diffs, index, type, 'text.bold', k.bold, p.bold, 'TEXT_STYLE');
  diffBoolField(diffs, index, type, 'text.italic', k.italic, p.italic, 'TEXT_STYLE');
  diffBoolField(diffs, index, type, 'text.underline', k.underline, p.underline, 'TEXT_STYLE');
  diffStringField(diffs, index, type, 'text.color', k.color, p.color, 'TEXT_STYLE');
  diffNumericField(diffs, index, type, 'text.lineSpacingPt', k.lineSpacingPt, p.lineSpacingPt, 0.5, 1.0, 'TEXT_STYLE');
  diffNumericField(diffs, index, type, 'text.charSpacingPt', k.charSpacingPt, p.charSpacingPt, 0, 0.25, 'TEXT_STYLE');
  diffStringField(diffs, index, type, 'text.align', k.align, p.align, 'TEXT_STYLE');
  diffStringField(diffs, index, type, 'text.valign', k.valign, p.valign, 'TEXT_STYLE');
}

function diffChartProps(
  diffs: FieldDiff[],
  index: number,
  type: string,
  konva: NormalizedChartProps | undefined,
  pptx: NormalizedChartProps | undefined,
): void {
  if (!konva && !pptx) return;
  const k = konva ?? {};
  const p = pptx ?? {};

  diffStringField(diffs, index, type, 'chart.chartType', k.chartType, p.chartType, 'CHART_CONFIG');
  diffStringField(diffs, index, type, 'chart.stacking', k.stacking, p.stacking, 'CHART_CONFIG');
  diffBoolField(diffs, index, type, 'chart.legendVisible', k.legendVisible, p.legendVisible, 'CHART_CONFIG');
  diffStringField(diffs, index, type, 'chart.legendPos', k.legendPos, p.legendPos, 'CHART_CONFIG');
  diffNumericField(diffs, index, type, 'chart.legendFontSize', k.legendFontSize, p.legendFontSize, 0, 0.5, 'CHART_CONFIG');
  diffBoolField(diffs, index, type, 'chart.showValue', k.showValue, p.showValue, 'CHART_CONFIG');
  diffStringField(diffs, index, type, 'chart.dataLabelPosition', k.dataLabelPosition, p.dataLabelPosition, 'CHART_CONFIG');
  diffNumericField(diffs, index, type, 'chart.dataLabelFontSize', k.dataLabelFontSize, p.dataLabelFontSize, 0, 0.5, 'CHART_CONFIG');
  diffNumericField(diffs, index, type, 'chart.categoryAxisLabelFontSize', k.categoryAxisLabelFontSize, p.categoryAxisLabelFontSize, 0, 0.5, 'CHART_CONFIG');
  diffNumericField(diffs, index, type, 'chart.valueAxisLabelFontSize', k.valueAxisLabelFontSize, p.valueAxisLabelFontSize, 0, 0.5, 'CHART_CONFIG');
  diffBoolField(diffs, index, type, 'chart.valAxisHidden', k.valAxisHidden, p.valAxisHidden, 'CHART_CONFIG');
  diffNumericField(diffs, index, type, 'chart.valAxisMin', k.valAxisMin, p.valAxisMin, 0, 0.1, 'CHART_CONFIG');
  diffNumericField(diffs, index, type, 'chart.valAxisMax', k.valAxisMax, p.valAxisMax, 0, 0.1, 'CHART_CONFIG');
}

function diffShapeProps(
  diffs: FieldDiff[],
  index: number,
  type: string,
  konva: NormalizedShapeProps | undefined,
  pptx: NormalizedShapeProps | undefined,
): void {
  if (!konva && !pptx) return;
  const k = konva ?? {};
  const p = pptx ?? {};

  diffStringField(diffs, index, type, 'shape.fill', k.fill, p.fill, 'VISUAL_STYLE');
  diffStringField(diffs, index, type, 'shape.borderColor', k.borderColor, p.borderColor, 'VISUAL_STYLE');
  diffNumericField(diffs, index, type, 'shape.borderWidth', k.borderWidth, p.borderWidth, 0, 0.1, 'VISUAL_STYLE');
  diffNumericField(diffs, index, type, 'shape.cornerRadius', k.cornerRadius, p.cornerRadius, 0, 0.01, 'VISUAL_STYLE');
}

function diffTableProps(
  diffs: FieldDiff[],
  index: number,
  type: string,
  konva: NormalizedTableProps | undefined,
  pptx: NormalizedTableProps | undefined,
): void {
  if (!konva && !pptx) return;
  const k = konva ?? {};
  const p = pptx ?? {};

  diffNumericField(diffs, index, type, 'table.fontSize', k.fontSize, p.fontSize, 0.5, 1.0, 'TABLE_LAYOUT');

  if (k.colW && p.colW) {
    const len = Math.max(k.colW.length, p.colW.length);
    for (let c = 0; c < len; c++) {
      diffNumericField(diffs, index, type, `table.colW[${c}]`, k.colW[c], p.colW[c], 0.01, 0.05, 'TABLE_LAYOUT');
    }
  }
  if (k.rowH && p.rowH) {
    const len = Math.max(k.rowH.length, p.rowH.length);
    for (let r = 0; r < len; r++) {
      diffNumericField(diffs, index, type, `table.rowH[${r}]`, k.rowH[r], p.rowH[r], 0.01, 0.05, 'TABLE_LAYOUT');
    }
  }
}

// ─── diff 原子操作 ──────────────────────────────────────────────────────

function pushDiff(
  diffs: FieldDiff[],
  index: number,
  type: string,
  field: string,
  konvaValue: unknown,
  pptxValue: unknown,
  category: DiffCategory,
  severity: DiffSeverity,
): void {
  const wl = matchWhitelist(type, field);
  diffs.push({
    elementIndex: index,
    elementType: type,
    field,
    konvaValue,
    pptxValue,
    category,
    severity: wl ? 'info' : severity,
    whitelisted: wl?.reason,
  });
}

function diffNumericField(
  diffs: FieldDiff[],
  index: number,
  type: string,
  field: string,
  konvaVal: number | undefined,
  pptxVal: number | undefined,
  toleranceInfo: number,
  toleranceWarn: number,
  category: DiffCategory,
): void {
  if (konvaVal == null && pptxVal == null) return;
  if (konvaVal == null || pptxVal == null) {
    // 一侧有值另一侧没有
    pushDiff(diffs, index, type, field, konvaVal, pptxVal, category, 'warning');
    return;
  }
  const delta = konvaVal - pptxVal;
  if (Math.abs(delta) > 0.001) {
    pushDiff(diffs, index, type, field, konvaVal, pptxVal, category, numericSeverity(delta, toleranceInfo, toleranceWarn));
  }
}

function diffStringField(
  diffs: FieldDiff[],
  index: number,
  type: string,
  field: string,
  konvaVal: string | undefined,
  pptxVal: string | undefined,
  category: DiffCategory,
): void {
  if (konvaVal == null && pptxVal == null) return;
  if (konvaVal !== pptxVal) {
    pushDiff(diffs, index, type, field, konvaVal, pptxVal, category, 'error');
  }
}

function diffBoolField(
  diffs: FieldDiff[],
  index: number,
  type: string,
  field: string,
  konvaVal: boolean | undefined,
  pptxVal: boolean | undefined,
  category: DiffCategory,
): void {
  if (konvaVal == null && pptxVal == null) return;
  if (konvaVal !== pptxVal) {
    pushDiff(diffs, index, type, field, konvaVal, pptxVal, category, 'warning');
  }
}
