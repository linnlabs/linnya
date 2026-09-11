/**
 * presentationComposeInput — 直接建稿输入解析
 *
 * 将原始 JSON 解析为 DeckSpec，
 * 直接组装可编译的 spec。
 * 供范例脚本 (referenceHighDensityShowcase 等) 使用。
 */

import type {
  Box,
  ChartSeries,
  ChartType,
  LayoutChartStyle,
  DeckSpec,
  FreeformSlideSpec,
  FreeformElement,
  FreeformInlineRun,
  FreeformTextRun,
  GeneratedLayoutConstraintEvidence,
  GradientPaint,
  ImageSourceInput,
  ImageVisualShadow,
  MathFormulaSource,
  Paint,
  ShapeStyle,
  ShapeStrokeStyle,
  ShapeGeometrySpec,
  SourceSpan,
  StructuredElement,
  StructuredSlideSpec,
  SvgGraphicAuthoringSource,
  SvgGraphicFit,
  SvgGraphicOwnedAssetRef,
  TableCell,
  TextStyle,
  TextWrapPolicy,
  ThemeSpec,
} from '@plugin/slides/shared';
import {
  normalizeDeckSpecColors,
  normalizeGradientPaint,
  normalizeImageShadowColors,
  normalizeOpaqueColor,
  normalizePaint,
  normalizeShapeStyleColors,
  normalizeTextStyleColors,
  normalizeSlideLayout,
  parseShapeGeometrySpec,
  ShapeGeometryError,
  isGeneratedLayoutConstraintEvidence,
  normalizeMathFormulaSource,
} from '@plugin/slides/shared';
import { isRecord, isNonEmptyString, isFiniteNumber } from './inputParsers/typeGuards.js';
import {
  createParseContext,
  dedupeParseWarnings,
  formatParseWarnings,
  type ParseWarning,
} from './inputParsers/parseContext.js';
import {
  parseChartStyle,
  parseImageVisualShadow,
  parseTableBorder,
  parseTextStyle,
  parseShapeStyle,
  readThemeSpecInput,
} from './inputParsers/styleParsers.js';
import {
  parseChartDataLike,
  parseImageSourceInput,
  parseSvgGraphicAuthoringSource,
  parseTableDataLike,
} from './inputParsers/dataParsers.js';
import { resolveChartPreset, buildChartOptionsFromParams } from './chartPresets.js';

// ─── 公共解析入口 ──────────────────────────────────────────────────────────

export interface DirectComposeInput {
  title: string;
  layout?: DeckSpec['layout'];
  theme?: ThemeSpec;
  slides: DirectSlideInput[];
}

export interface DirectSlideInput {
  background?: {
    /** 内部统一合同；Flex 编译器直接产出该字段。 */
    paint?: Paint;
    image?: ImageSourceInput;
    /** @deprecated 仅供旧 direct compose 输入 admission。 */
    color?: string;
    /** @deprecated 仅供旧 direct compose 输入 admission。 */
    gradient?: GradientPaint;
  };
  elements: DirectElementInput[];
  notes?: string;
}

export interface DirectElementInput {
  type: 'text' | 'shape' | 'image' | 'svgGraphic' | 'formula' | 'chart' | 'table';
  position: Box;
  /* text / shape 通用：纯字符串或富文本/公式 run 数组。 */
  content?: string | FreeformInlineRun[];
  /** Flex Text 解析后的文本框换行语义；不属于 deck.js 可写字段。 */
  textWrap?: TextWrapPolicy;
  style?: Partial<ShapeStyle & TextStyle>;
  /* shape 专用 */
  geometry?: ShapeGeometrySpec;
  /* image 专用 */
  src?: ImageSourceInput;
  alt?: string;
  fitMode?: 'cover' | 'contain' | 'crop';
  maskShape?: 'rect' | 'circle';
  rounding?: boolean;
  transparency?: number;
  shadow?: ImageVisualShadow;
  rotate?: number;
  flipH?: boolean;
  flipV?: boolean;
  /* SVG Graphic 专用：source 只存在于编译中间态，DeckSpec 只接收 asset。 */
  svgSource?: SvgGraphicAuthoringSource;
  svgAsset?: SvgGraphicOwnedAssetRef;
  svgFit?: SvgGraphicFit;
  svgOpacity?: number;
  svgRotate?: number;
  svgAltText?: string;
  svgDecorative?: boolean;
  /* Formula 专用；公开输入写 latex/style，Flex 编译后写 formulaSource。 */
  formulaSource?: MathFormulaSource;
  latex?: string;
  formulaFontSize?: number;
  formulaColor?: string;
  formulaAlign?: 'left' | 'center' | 'right';
  formulaAltText?: string;
  /* chart 专用 */
  chartType?: ChartType;
  categories?: string[];
  series?: ChartSeries[];
  /** 图表风格预设，展开为精调过的 chartOptions */
  chartPreset?: string;
  /** 是否显示数据标签 */
  showDataLabels?: boolean;
  /** 数据标签格式码，如 "$#,##0.0" / "0.0%" */
  dataLabelFormat?: string;
  /** 图例位置 */
  legendPosition?: string;
  /** 跨预览/PPTX 的图表颜色语义。 */
  chartStyle?: LayoutChartStyle;
  /** 内部逃生口：原始 PptxGenJS 选项（不暴露在 tool schema 中） */
  chartOptions?: Record<string, unknown>;
  /* table 专用 */
  headers?: string[];
  rows?: TableCell[][];
  /** 已归一化的统一表格描边。 */
  tableBorder?: ShapeStrokeStyle;
  tableOptions?: Record<string, unknown>;
  /** 内部追踪元数据：deck.js 工厂调用所在源码行号。 */
  _sourceSpan?: SourceSpan;
  /** Flex/Yoga 编译后的窄约束事实；不接受用户输入。 */
  _semanticRole?: string;
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
}

/**
 * 将 AI 原始 args 解析为 DirectComposeInput。
 * 失败时返回 error 字符串。
 *
 * Doc 26 P0：返回值新增 `parseWarnings` / `parseWarningsStructured` 通道，
 * plumbing 已铺通，P0 阶段内部 parser 尚未产生 warning，调用方读到的
 * 通常是 undefined；P1 起会有 unknown_field / invalid_type 等流出。
 */
export interface DirectComposeParseResult {
  input?: DirectComposeInput;
  error?: string;
  parseWarnings?: string[];
  parseWarningsStructured?: ParseWarning[];
}

export function readDirectComposeInput(
  args: Record<string, unknown>,
): DirectComposeParseResult {
  return readComposeInput(args, false);
}

/**
 * 只读取可信构建 Worker 产出的 DirectComposeInput JSON 投影。
 * 普通 deck.js 输入不得借此写入 textWrap 或布局约束证据等内部编译事实。
 */
export function readCompiledDirectComposeInput(
  args: Record<string, unknown>,
): DirectComposeParseResult {
  return readComposeInput(args, true);
}

function readComposeInput(
  args: Record<string, unknown>,
  acceptCompiledFields: boolean,
): DirectComposeParseResult {
  // Doc 26 P0：根级 ctx，目前仅作为通道占位，未传入下游 parser。
  // 下游 parser 在 P1 起会接入 ctx 参数；当前只确保 plumbing 端到端可观测。
  const ctx = createParseContext('');

  const title = isNonEmptyString(args.title) ? args.title.trim() : null;
  if (!title) {
    return { error: 'title 必须是非空字符串。' };
  }

  let layout: DeckSpec['layout'] = '16x9';
  if (args.layout != null) {
    const layoutResult = normalizeSlideLayout(args.layout);
    if ('error' in layoutResult) return layoutResult;
    layout = layoutResult.value;
  }

  const themeResult = readThemeSpecInput(args.theme);
  if (themeResult.error) return { error: themeResult.error };

  if (!Array.isArray(args.slides) || args.slides.length === 0) {
    return { error: 'slides 必须是非空数组。' };
  }

  const slides: DirectSlideInput[] = [];
  for (let i = 0; i < args.slides.length; i++) {
    const slideResult = parseSlideInput(args.slides[i], i, acceptCompiledFields);
    if (slideResult.error) return { error: slideResult.error };
    slides.push(slideResult.slide!);
  }

  const collected = ctx.collected();
  const deduped = dedupeParseWarnings(collected, { maxPerPathCode: 1, maxTotal: 20 });

  return {
    input: {
      title,
      layout,
      theme: themeResult.theme,
      slides,
    },
    parseWarnings: deduped.length > 0 ? formatParseWarnings(deduped) : undefined,
    parseWarningsStructured: deduped.length > 0 ? deduped : undefined,
  };
}

/**
 * 将 DirectComposeInput 转为 DeckSpec。
 * 含 chart / table 的 slide 走 structured 路径，其余走 freeform。
 */
export function buildDeckSpecFromDirectInput(input: DirectComposeInput): DeckSpec {
  const slides = input.slides.map((slide, index) => {
    const spec = buildSlideSpec(slide);
    return {
      slideNumber: index + 1,
      spec,
    };
  });

  const deckSpec: DeckSpec = {
    title: input.title,
    layout: input.layout,
    theme: input.theme,
    slides,
  };

  const normalizedDeck = normalizeDeckSpecColors(deckSpec);
  if ('error' in normalizedDeck) {
    throw new Error(normalizedDeck.error);
  }

  return normalizedDeck.value;
}

function slideNeedsStructured(slide: DirectSlideInput): boolean {
  return slide.elements.some((el) => el.type === 'chart' || el.type === 'table');
}

// ─── 内部解析函数 ──────────────────────────────────────────────────────────

function parseSlideInput(
  value: unknown,
  slideIndex: number,
  acceptCompiledFields = false,
): { slide?: DirectSlideInput; error?: string } {
  if (!isRecord(value)) {
    return { error: `slides[${slideIndex}] 必须是对象。` };
  }

  const backgroundResult = parseBackground(value.background);
  if (backgroundResult.error) {
    return { error: `slides[${slideIndex}].background: ${backgroundResult.error}` };
  }
  const notes = isNonEmptyString(value.notes) ? value.notes : undefined;

  if (!Array.isArray(value.elements)) {
    return { error: `slides[${slideIndex}].elements 必须是数组。` };
  }

  const elements: DirectElementInput[] = [];
  for (let i = 0; i < value.elements.length; i++) {
    const elResult = parseElementInput(
      value.elements[i],
      slideIndex,
      i,
      acceptCompiledFields,
    );
    if (elResult.error) return { error: elResult.error };
    elements.push(elResult.element!);
  }

  return {
    slide: {
      background: backgroundResult.background,
      elements,
      notes,
    },
  };
}

function parseBackground(
  value: unknown,
): { background?: DirectSlideInput['background']; error?: string } {
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) return { error: '必须是对象。' };

  const imageSource: ReturnType<typeof parseImageSourceInput> = value.image != null
    ? parseImageSourceInput(value.image)
    : {};
  if (imageSource.error) {
    return { error: `background.image ${imageSource.error}` };
  }
  const paint = value.paint != null ? normalizePaint(value.paint, 'background.paint') : undefined;
  if (paint && 'error' in paint) return { error: paint.error };

  const gradient = value.gradient != null
    ? normalizeGradientPaint(value.gradient, 'background.gradient')
    : undefined;
  if (gradient && 'error' in gradient) return { error: gradient.error };

  if (value.color != null && !isNonEmptyString(value.color)) {
    return { error: 'background.color 必须是非空颜色字符串。' };
  }
  const color = isNonEmptyString(value.color)
    ? normalizeOpaqueColor(value.color, 'background.color')
    : undefined;
  if (color && 'error' in color) return { error: color.error };

  if (paint && (gradient || color || imageSource.source)) {
    return { error: 'background.paint 与 color/gradient/image 互斥。' };
  }
  if (imageSource.source && gradient) {
    return { error: 'background.image 与 gradient 互斥。' };
  }

  // 旧 direct compose 曾把 color 当 gradient 的静态 fallback；只在这个 admission
  // 识别该历史组合，进入 DeckSpec 时立即收敛成单一 Paint。
  if (gradient) return { background: { paint: gradient.value } };
  if (paint) return { background: { paint: paint.value } };
  // 旧输入允许 image 携带 color fallback；当前合同只保留真实图片事实。
  if (imageSource.source) return { background: { image: imageSource.source } };
  if (color) return { background: { paint: { type: 'solid', color: color.value } } };
  return {};
}

function parseElementInput(
  value: unknown,
  slideIndex: number,
  elementIndex: number,
  acceptCompiledFields = false,
): { element?: DirectElementInput; error?: string } {
  const prefix = `slides[${slideIndex}].elements[${elementIndex}]`;

  if (!isRecord(value)) {
    return { error: `${prefix} 必须是对象。` };
  }

  const type = value.type;
  if (
    type !== 'text'
    && type !== 'shape'
    && type !== 'image'
    && type !== 'svgGraphic'
    && type !== 'formula'
    && type !== 'chart'
    && type !== 'table'
  ) {
    return { error: `${prefix}.type 必须是 text / shape / image / svgGraphic / formula / chart / table。` };
  }

  const position = parseFullBox(value.position);
  if (!position) {
    return { error: `${prefix}.position 必须包含有效的 { x, y, w, h }（单位：英寸）。` };
  }

  const textStyle = value.style != null ? parseTextStyle(value.style) : null;
  const shapeStyle = value.style != null ? parseShapeStyle(value.style) : null;
  let normalizedTextStyle: TextStyle | undefined;
  if (textStyle) {
    const normalized = normalizeTextStyleColors(textStyle, `${prefix}.style`);
    if ('error' in normalized) {
      return { error: normalized.error };
    }
    normalizedTextStyle = normalized.value;
  }
  let normalizedShapeStyle: Partial<ShapeStyle> | undefined;
  if (shapeStyle) {
    const normalized = normalizeShapeStyleColors(shapeStyle, `${prefix}.style`);
    if ('error' in normalized) {
      return { error: normalized.error };
    }
    normalizedShapeStyle = normalized.value;
  }
  const mergedStyle: Partial<ShapeStyle & TextStyle> | undefined =
    normalizedTextStyle || normalizedShapeStyle
      ? { ...normalizedShapeStyle, ...normalizedTextStyle }
      : undefined;

  // 兼容 chartData 包装格式：agent 可能把 categories/series 放在 chartData 里
  // 也支持顶层 categories/series（优先）
  const chartContainer = isRecord(value.chartData)
    ? value.chartData
    : isRecord(value.data)
      ? value.data
      : null;
  const chartParseResult: ReturnType<typeof parseChartDataLike> = type === 'chart'
    ? parseChartDataLike({
      ...(chartContainer ?? {}),
      categories: value.categories ?? chartContainer?.categories ?? chartContainer?.labels,
      series: value.series ?? chartContainer?.series ?? chartContainer?.datasets,
      chartType: value.chartType ?? chartContainer?.chartType,
    })
    : {};

  const tableParseResult: ReturnType<typeof parseTableDataLike> = type === 'table'
    ? parseTableDataLike({
      headers: value.headers,
      header: value.header,
      columns: value.columns,
      cols: value.cols,
      rows: value.rows,
      body: value.body,
      data: value.data,
    })
    : {};
  const chartStyleResult = type === 'chart' && value.chartStyle != null
    ? parseChartStyle(value.chartStyle)
    : undefined;
  if (chartStyleResult && 'error' in chartStyleResult) {
    return { error: `${prefix}.chartStyle: ${chartStyleResult.error}` };
  }
  const chartStyle = chartStyleResult?.value;
  const tableBorder = type === 'table' && value.border != null
    ? parseTableBorder(value.border) ?? undefined
    : undefined;
  if (type === 'table' && value.border != null && tableBorder == null) {
    return { error: `${prefix}.border 必须是 { color, width } 描边对象。` };
  }
  const imageSource: ReturnType<typeof parseImageSourceInput> = type === 'image'
    ? parseImageSourceInput(value.src)
    : {};
  const rawSvgSource = acceptCompiledFields && value.svgSource !== undefined
    ? value.svgSource
    : value.source;
  const svgSource: ReturnType<typeof parseSvgGraphicAuthoringSource> = type === 'svgGraphic'
    ? parseSvgGraphicAuthoringSource(rawSvgSource)
    : {};
  const normalizedFormula = type === 'formula'
    ? normalizeMathFormulaSource({
      latex: acceptCompiledFields && isRecord(value.formulaSource)
        ? typeof value.formulaSource.latex === 'string' ? value.formulaSource.latex : ''
        : typeof value.latex === 'string' ? value.latex : '',
      fontSize: acceptCompiledFields && isRecord(value.formulaSource)
        ? isFiniteNumber(value.formulaSource.fontSize) ? value.formulaSource.fontSize : undefined
        : isFiniteNumber(value.fontSize) ? value.fontSize : undefined,
      color: acceptCompiledFields && isRecord(value.formulaSource)
        ? typeof value.formulaSource.color === 'string' ? value.formulaSource.color : undefined
        : typeof value.color === 'string' ? value.color : undefined,
      align: acceptCompiledFields && isRecord(value.formulaSource)
        ? value.formulaSource.align === 'left'
          || value.formulaSource.align === 'center'
          || value.formulaSource.align === 'right'
          ? value.formulaSource.align
          : undefined
        : value.align === 'left' || value.align === 'center' || value.align === 'right'
          ? value.align
          : undefined,
      altText: acceptCompiledFields && isRecord(value.formulaSource)
        ? typeof value.formulaSource.altText === 'string' ? value.formulaSource.altText : undefined
        : typeof value.altText === 'string' ? value.altText : undefined,
    })
    : undefined;
  const imageShadow = value.shadow != null
    ? parseImageShadow(value.shadow)
    : undefined;
  if (value.shadow != null && imageShadow == null) {
    return { error: `${prefix}.shadow 必须是合法阴影对象。` };
  }
  const normalizedImageShadow = imageShadow
    ? normalizeImageShadowColors(imageShadow, `${prefix}.shadow`)
    : undefined;
  if (normalizedImageShadow && 'error' in normalizedImageShadow) {
    return { error: normalizedImageShadow.error };
  }

  let geometry: ShapeGeometrySpec | undefined;
  if (type === 'shape') {
    try {
      geometry = parseShapeGeometrySpec(value.geometry, `${prefix}.geometry`);
    } catch (error) {
      if (error instanceof ShapeGeometryError) return { error: error.message };
      throw error;
    }
  }

  const rawTextWrap = acceptCompiledFields ? value.textWrap : undefined;
  if (
    rawTextWrap !== undefined
    && rawTextWrap !== 'word'
    && rawTextWrap !== 'char'
    && rawTextWrap !== 'none'
  ) {
    return { error: `${prefix}.textWrap 不是有效的内部编译结果。` };
  }
  const rawLayoutConstraintEvidence = acceptCompiledFields
    ? value._layoutConstraintEvidence
    : undefined;
  if (
    rawLayoutConstraintEvidence !== undefined
    && !isGeneratedLayoutConstraintEvidence(rawLayoutConstraintEvidence)
  ) {
    return { error: `${prefix}._layoutConstraintEvidence 不是有效的内部编译结果。` };
  }

  const rawSvgFit = acceptCompiledFields && value.svgFit !== undefined
    ? value.svgFit
    : value.fit;
  const rawSvgOpacity = acceptCompiledFields && value.svgOpacity !== undefined
    ? value.svgOpacity
    : value.opacity;
  const rawSvgRotate = acceptCompiledFields && value.svgRotate !== undefined
    ? value.svgRotate
    : value.rotate;
  const rawSvgAltText = acceptCompiledFields && value.svgAltText !== undefined
    ? value.svgAltText
    : value.altText;
  const rawSvgDecorative = acceptCompiledFields && value.svgDecorative !== undefined
    ? value.svgDecorative
    : value.decorative;

  const element: DirectElementInput = {
    type,
    position,
    content: isNonEmptyString(value.content) ? value.content : undefined,
    textWrap: rawTextWrap,
    style: mergedStyle,
    geometry,
    src: imageSource.source,
    alt: isNonEmptyString(value.alt) ? value.alt : undefined,
    fitMode: value.fitMode === 'cover' || value.fitMode === 'contain' || value.fitMode === 'crop'
      ? value.fitMode
      : undefined,
    maskShape: value.maskShape === 'rect' || value.maskShape === 'circle' ? value.maskShape : undefined,
    rounding: typeof value.rounding === 'boolean' ? value.rounding : undefined,
    transparency: isFiniteNumber(value.transparency) ? value.transparency : undefined,
    shadow: normalizedImageShadow && 'value' in normalizedImageShadow ? normalizedImageShadow.value : undefined,
    rotate: isFiniteNumber(value.rotate) ? value.rotate : undefined,
    flipH: typeof value.flipH === 'boolean' ? value.flipH : undefined,
    flipV: typeof value.flipV === 'boolean' ? value.flipV : undefined,
    svgSource: svgSource.source,
    svgFit: rawSvgFit === 'contain' || rawSvgFit === 'stretch' ? rawSvgFit : undefined,
    svgOpacity: isFiniteNumber(rawSvgOpacity) ? rawSvgOpacity : undefined,
    svgRotate: isFiniteNumber(rawSvgRotate) ? rawSvgRotate : undefined,
    svgAltText: isNonEmptyString(rawSvgAltText) ? rawSvgAltText.trim() : undefined,
    svgDecorative: typeof rawSvgDecorative === 'boolean' ? rawSvgDecorative : undefined,
    formulaSource: normalizedFormula && 'value' in normalizedFormula
      ? {
        ...normalizedFormula.value,
        sourceSpan: parseSourceSpan(value._sourceSpan),
      }
      : undefined,
    chartType: chartParseResult.data?.chartType,
    categories: chartParseResult.data?.categories,
    series: chartParseResult.data?.series,
    chartPreset: isNonEmptyString(value.chartPreset) ? value.chartPreset : undefined,
    showDataLabels: typeof value.showDataLabels === 'boolean' ? value.showDataLabels : undefined,
    dataLabelFormat: isNonEmptyString(value.dataLabelFormat) ? value.dataLabelFormat : undefined,
    legendPosition: isNonEmptyString(value.legendPosition) ? value.legendPosition : undefined,
    chartStyle,
    chartOptions: isRecord(value.chartOptions) ? value.chartOptions : undefined,
    headers: tableParseResult.data?.headers,
    rows: tableParseResult.data?.rows,
    tableBorder,
    tableOptions: isRecord(value.tableOptions) ? value.tableOptions : undefined,
    _sourceSpan: parseSourceSpan(value._sourceSpan),
    _semanticRole: acceptCompiledFields && isNonEmptyString(value._semanticRole) ? value._semanticRole : undefined,
    _layoutConstraintEvidence: rawLayoutConstraintEvidence,
  };

  if (type === 'chart' && chartParseResult.error) {
    return { error: `${prefix}: ${chartParseResult.error}` };
  }
  if (type === 'table' && tableParseResult.error) {
    return { error: `${prefix}: ${tableParseResult.error}` };
  }
  if (type === 'image' && imageSource.error) {
    return { error: `${prefix}: ${imageSource.error}` };
  }
  if (type === 'svgGraphic' && svgSource.error) {
    return { error: `${prefix}: ${svgSource.error}` };
  }
  if (type === 'formula' && normalizedFormula && 'error' in normalizedFormula) {
    return { error: `${prefix}: ${normalizedFormula.error}` };
  }

  /* 类型级校验：chartPreset 可以替代 chartType */
  if (type === 'chart' && ((!element.chartType && !element.chartPreset) || !element.categories || !element.series)) {
    return { error: `${prefix}: chart 类型必须提供 chartType（或 chartPreset）以及图表数据；类目可写 categories/labels/xLabels，系列可写 series/datasets。` };
  }
  if (type === 'table' && !element.rows) {
    return { error: `${prefix}: table 类型必须提供 rows（也可写 body/data）。` };
  }
  if (type === 'image' && !element.src) {
    return { error: `${prefix}: image 类型必须提供 src。` };
  }
  if (type === 'svgGraphic') {
    if (!element.svgSource) {
      return { error: `${prefix}: svgGraphic 类型必须提供 source。` };
    }
    if (rawSvgFit != null && element.svgFit == null) {
      return { error: `${prefix}.fit 必须是 contain / stretch。` };
    }
    if (rawSvgOpacity != null && (
      element.svgOpacity == null || element.svgOpacity < 0 || element.svgOpacity > 1
    )) {
      return { error: `${prefix}.opacity 必须是 0..1 的有限数字。` };
    }
    if (element.svgDecorative === true && element.svgAltText) {
      return { error: `${prefix}: 装饰性 SVG Graphic 不能同时提供 altText。` };
    }
    if (element.svgDecorative !== true && !element.svgAltText) {
      return { error: `${prefix}: 非装饰性 SVG Graphic 必须提供 altText。` };
    }
  }
  if (type === 'formula' && !element.formulaSource) {
    return { error: `${prefix}: formula 类型必须提供 latex。` };
  }

  return { element };
}

function parseFullBox(value: unknown): Box | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)
    || !isFiniteNumber(value.w) || !isFiniteNumber(value.h)) {
    return null;
  }
  return { x: value.x, y: value.y, w: value.w, h: value.h };
}

function parseSourceSpan(value: unknown): SourceSpan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const startLine = value.startLine;
  const endLine = value.endLine;
  if (typeof startLine !== 'number' || typeof endLine !== 'number') {
    return undefined;
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return undefined;
  }
  if (startLine < 1 || endLine < startLine) {
    return undefined;
  }
  return {
    startLine,
    endLine,
  };
}

function parseImageShadow(value: unknown): ImageVisualShadow | undefined {
  // 透传到 inputParsers/styleParsers 的公共实现，保持各入口（generated / edit / compose）
  // 对 ImageVisualShadow 的解析完全一致（避免单字段语义漂移）。
  return parseImageVisualShadow(value) ?? undefined;
}

// ─── DeckSpec 构建 ──────────────────────────────────────────────────────────

function buildSlideSpec(
  slide: DirectSlideInput,
): StructuredSlideSpec | FreeformSlideSpec {
  if (slideNeedsStructured(slide)) {
    return buildStructuredSlideSpec(slide);
  }
  return buildFreeformSlideSpec(slide);
}

function buildStructuredSlideSpec(slide: DirectSlideInput): StructuredSlideSpec {
  return {
    type: 'structured',
    background: slide.background,
    elements: slide.elements.map(buildStructuredElement),
    notes: slide.notes,
  };
}

function buildFreeformSlideSpec(slide: DirectSlideInput): FreeformSlideSpec {
  return {
    type: 'freeform',
    background: slide.background,
    elements: slide.elements.map(buildFreeformElement),
    notes: slide.notes,
  };
}

/** 富文本数组展平为纯字符串（structured 路径不支持 runs） */
function flattenContent(content: string | FreeformInlineRun[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((run) => 'text' in run ? run.text : '').join('');
  }
  return '';
}

function buildStructuredElement(el: DirectElementInput): StructuredElement {
  const sourceTracking = buildSourceTracking(el);
  switch (el.type) {
    case 'text':
      return {
        type: 'text',
        content: el.content ?? '',
        position: el.position,
        textWrap: el.textWrap,
        style: el.style,
        ...sourceTracking,
      };
    case 'shape':
      return {
        type: 'shape',
        geometry: el.geometry ?? 'rect',
        position: el.position,
        style: el.style,
        text: flattenContent(el.content) || undefined,
        ...sourceTracking,
      };
    case 'image':
      return {
        type: 'image',
        src: el.src ?? '',
        position: el.position,
        alt: el.alt,
        fitMode: el.fitMode,
        maskShape: el.maskShape,
        rounding: el.rounding,
        transparency: el.transparency,
        shadow: el.shadow,
        rotate: el.rotate,
        flipH: el.flipH,
        flipV: el.flipV,
        ...sourceTracking,
      };
    case 'svgGraphic':
      return {
        type: 'svgGraphic',
        position: el.position,
        ...requireSvgGraphicSpec(el),
        ...sourceTracking,
      };
    case 'formula':
      return {
        type: 'formula',
        source: requireFormulaSource(el),
        position: el.position,
        ...sourceTracking,
      };
    case 'chart': {
      const preset = el.chartPreset ? resolveChartPreset(el.chartPreset) : undefined;
      return {
        type: 'chart',
        chartType: el.chartType ?? preset?.chartType ?? 'bar',
        data: {
          categories: el.categories ?? [],
          series: el.series ?? [],
        },
        position: el.position,
        options: buildChartOptionsFromParams({
          chartPreset: el.chartPreset,
          showDataLabels: el.showDataLabels,
          dataLabelFormat: el.dataLabelFormat,
          legendPosition: el.legendPosition,
          chartOptions: el.chartOptions,
        }),
        chartStyle: el.chartStyle,
        ...sourceTracking,
      };
    }
    case 'table':
      return {
        type: 'table',
        headers: el.headers,
        rows: el.rows ?? [],
        border: el.tableBorder,
        position: el.position,
        options: el.tableOptions,
        ...sourceTracking,
      };
  }
}

function buildFreeformElement(el: DirectElementInput): FreeformElement {
  const sourceTracking = buildSourceTracking(el);
  switch (el.type) {
    case 'text':
      return {
        type: 'text',
        position: el.position,
        content: el.content,
        textWrap: el.textWrap,
        style: el.style,
        ...sourceTracking,
      };
    case 'shape':
      return {
        type: 'shape',
        position: el.position,
        geometry: el.geometry ?? 'rect',
        content: requireTextOnlyContent(el),
        style: el.style,
        ...sourceTracking,
      };
    case 'image':
      return {
        type: 'image',
        position: el.position,
        src: el.src,
        alt: el.alt,
        fitMode: el.fitMode,
        maskShape: el.maskShape,
        rounding: el.rounding,
        transparency: el.transparency,
        shadow: el.shadow,
        rotate: el.rotate,
        flipH: el.flipH,
        flipV: el.flipV,
        ...sourceTracking,
      };
    case 'svgGraphic':
      return {
        type: 'svgGraphic',
        position: el.position,
        ...requireSvgGraphicSpec(el),
        ...sourceTracking,
      };
    case 'formula':
      return {
        type: 'formula',
        position: el.position,
        source: requireFormulaSource(el),
        ...sourceTracking,
      };
    /* chart / table 不会出现在 freeform slide 中（由 slideNeedsStructured 保证） */
    case 'chart':
    case 'table':
      throw new Error(`${el.type} elements require a structured slide.`);
  }
}

function requireTextOnlyContent(
  element: DirectElementInput,
): string | FreeformTextRun[] | undefined {
  if (!Array.isArray(element.content)) return element.content;
  return element.content.map((run) => {
    if ('formula' in run) {
      throw new Error('Shape inner text does not support inline formulas; use createText().');
    }
    return run;
  });
}

function requireFormulaSource(el: DirectElementInput): MathFormulaSource {
  if (!el.formulaSource) {
    throw new Error('Formula source must be normalized before DeckSpec compilation.');
  }
  return el.formulaSource;
}

function requireSvgGraphicSpec(el: DirectElementInput) {
  if (!el.svgAsset) {
    throw new Error('SVG Graphic source must be owned before DeckSpec compilation.');
  }
  if (el.svgDecorative !== true && !el.svgAltText?.trim()) {
    throw new Error('Non-decorative SVG Graphic requires altText.');
  }
  const accessibility = el.svgDecorative === true
    ? { decorative: true as const }
    : { altText: el.svgAltText ?? '' };
  return {
    asset: el.svgAsset,
    fit: el.svgFit ?? 'contain',
    opacity: el.svgOpacity,
    rotate: el.svgRotate,
    ...accessibility,
  };
}

function buildSourceTracking(el: DirectElementInput): {
  _sourceSpan?: SourceSpan;
  _semanticRole?: string;
  _layoutConstraintEvidence?: GeneratedLayoutConstraintEvidence;
} {
  return {
    ...(el._semanticRole ? { _semanticRole: el._semanticRole } : {}),
    ...(el._sourceSpan ? { _sourceSpan: el._sourceSpan } : {}),
    ...(el._layoutConstraintEvidence
      ? { _layoutConstraintEvidence: el._layoutConstraintEvidence }
      : {}),
  };
}
