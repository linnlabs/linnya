/**
 * FlexLayoutCompiler — Flex 布局树 → DirectComposeInput
 *
 * 主编译入口。将 AI 通过场景图 DSL 生成的 View/Text/Chart 布局树
 * 通过 Yoga 引擎计算出绝对坐标，然后转换为现有 DirectComposeInput 格式，
 * 无缝对接 buildDeckSpecFromDirectInput → DeckSpec → PPTX 管线。
 */

import type {
  LayoutSlideNode,
  LayoutNode,
  LayoutTextNode,
  LayoutShapeNode,
  LayoutChartNode,
  LayoutTableNode,
  LayoutImageNode,
  LayoutSvgGraphicNode,
  LayoutFormulaNode,
  LayoutContainerNode,
  FlexComposeInput,
} from './LayoutTypes.js';
import { isContainerNode } from './LayoutTypes.js';
import type { ComputedBox, LayoutResult } from './YogaAdapter.js';
import { computeSlideLayout } from './YogaAdapter.js';
import type {
  DirectComposeInput,
  DirectSlideInput,
  DirectElementInput,
} from '../presentationComposeInput.js';
import { readThemeSpecInput } from '../inputParsers/styleParsers.js';
import {
  parseChartDataLike,
  parseSvgGraphicAuthoringSource,
  parseTableDataLike,
} from '../inputParsers/dataParsers.js';
import { isRecord } from '../inputParsers/typeGuards.js';
import {
  createMultipleTextLineSpacing,
  normalizeGradientPaint,
  normalizeShapeFillInput,
  normalizeSlideLayout,
  normalizeStrokePaint,
  resolveSlideSizeInches,
  normalizeMathFormulaSource,
} from '@plugin/slides/shared';
import type {
  Box,
  GeneratedLayoutConstraintEvidence,
  FreeformInlineRun,
  LayoutTextRun,
  Paint,
  ShapeStrokeStyle,
  SourceSpan,
} from '@plugin/slides/shared';
import { resolveLayoutTextWrapPolicy } from './TextBoxSizing.js';
import { buildGeneratedLayoutConstraintEvidence } from './LayoutConstraintFacts.js';
import { FlexComposeContractError } from './FlexComposeContractError.js';

// ─── 公共 API ──────────────────────────────────────────────────────────────────

/** 编译被跳过的 slide 信息 */
export interface RejectedSlide {
  /** 原始 slides 数组中的索引（0-based） */
  index: number;
  /** 失败原因 */
  reason: string;
}

/** compileFlexInput 的返回值 */
export interface FlexCompileResult {
  input?: DirectComposeInput;
  error?: string;
  /** 编译失败被跳过的 slide 列表（仅部分成功时存在） */
  rejectedSlides?: RejectedSlide[];
}

/**
 * 将 Flex 布局树格式的 compose 输入编译为标准 DirectComposeInput。
 *
 * 对于 title/layout/theme 等全局参数错误会直接返回 error。
 * 对于单张 slide 的编译失败，会跳过该 slide 并记录到 rejectedSlides，
 * 只有全部 slide 都失败时才返回整体 error。
 * 该部分结果仅供诊断；正式整稿提交必须拒绝 rejectedSlides。未知 runtime 异常继续抛出。
 */
export function compileFlexInput(raw: FlexComposeInput): FlexCompileResult {
  const title = raw.title;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return { error: 'title 必须是非空字符串。' };
  }

  const layoutResult = normalizeSlideLayout(raw.layout ?? '16x9');
  if ('error' in layoutResult) return layoutResult;
  const layout = layoutResult.value;
  const canvas = resolveSlideSizeInches(layout);

  const themeResult = readThemeSpecInput(raw.theme);
  if (themeResult.error) return { error: themeResult.error };

  if (!Array.isArray(raw.slides) || raw.slides.length === 0) {
    return { error: 'slides 必须是非空数组。' };
  }

  const slides: DirectSlideInput[] = [];
  const rejectedSlides: RejectedSlide[] = [];

  for (let i = 0; i < raw.slides.length; i++) {
    const slideNode = raw.slides[i];
    if (!slideNode || slideNode._type !== 'Slide') {
      rejectedSlides.push({ index: i, reason: `第 ${i + 1} 页（slides[${i}]）必须是 Slide(...) 节点。` });
      continue;
    }

    try {
      const compiled = compileSlide(slideNode, canvas.width, canvas.height, i + 1);
      slides.push(compiled);
    } catch (err) {
      if (!(err instanceof FlexComposeContractError)) throw err;
      rejectedSlides.push({ index: i, reason: `第 ${i + 1} 页（slides[${i}]）编译失败：${err.message}` });
    }
  }

  // 全部 slide 都失败 → 整体错误
  if (slides.length === 0) {
    const reasons = rejectedSlides.map((r) => r.reason).join('；');
    return { error: `所有 slide 编译失败：${reasons}` };
  }

  return {
    input: {
      title: title.trim(),
      layout: layout as DirectComposeInput['layout'],
      theme: themeResult.theme,
      slides,
    },
    rejectedSlides: rejectedSlides.length > 0 ? rejectedSlides : undefined,
  };
}

/**
 * 将单个 Slide 布局树编译为 DirectSlideInput。
 * 可用于 recompose_slide 等场景。
 */
export function compileSlide(
  slideNode: LayoutSlideNode,
  slideWidth: number,
  slideHeight: number,
  slideNumber = 1,
): DirectSlideInput {
  const layoutResult = computeSlideLayout(slideNode, slideWidth, slideHeight);
  const elements: DirectElementInput[] = [];
  collectElements(layoutResult, elements, {
    slideNumber,
    nodePath: 'root',
  });

  return {
    background: normalizeSlideBackground(slideNode.background),
    elements,
    notes: slideNode.notes,
  };
}

// ─── 元素收集 ──────────────────────────────────────────────────────────────────

/**
 * 递归遍历布局结果树，将叶子节点转为 DirectElementInput。
 * 容器节点如果有装饰属性（backgroundColor/border），生成额外的背景 shape。
 */
interface LayoutTraversalContext {
  readonly slideNumber: number;
  readonly nodePath: string;
  readonly parent?: LayoutResult;
  readonly parentPath?: string;
  readonly grandparent?: LayoutResult;
  readonly grandparentPath?: string;
}

function collectElements(
  result: LayoutResult,
  elements: DirectElementInput[],
  context: LayoutTraversalContext,
): void {
  const { node, box, children } = result;
  const constraintEvidence = buildConstraintEvidence(result, context);

  if (isContainerNode(node)) {
    // 容器装饰 → 背景 shape 元素（在子元素之前，确保 z-order 底层）
    const container = node as LayoutContainerNode;
    if (container.backgroundColor || container.border) {
      elements.push(attachLayoutConstraintEvidence(
        buildContainerBackground(container, box),
        constraintEvidence,
      ));
    }

    // 递归处理子节点
    for (const [index, child] of children.entries()) {
      collectElements(child, elements, {
        slideNumber: context.slideNumber,
        nodePath: `${context.nodePath}.${index}`,
        parent: result,
        parentPath: context.nodePath,
        grandparent: context.parent,
        grandparentPath: context.parentPath,
      });
    }
    return;
  }

  // 叶子节点 → 转为 DirectElementInput
  const element = buildLeafElement(node, box);
  if (element) {
    if ('role' in node && node.role != null) {
      const roles = node._type === 'Text'
        ? ['footnote', 'source', 'page-number'] : ['background', 'decoration'];
      if (!roles.includes(node.role)) throw new FlexComposeContractError(`节点 role 必须使用当前节点允许的语义角色。`);
      element._semanticRole = node.role;
    }
    elements.push(attachLayoutConstraintEvidence(element, constraintEvidence));
  }
}

function buildConstraintEvidence(
  result: LayoutResult,
  context: LayoutTraversalContext,
): GeneratedLayoutConstraintEvidence | undefined {
  if (!context.parent || !context.parentPath) return undefined;
  return buildGeneratedLayoutConstraintEvidence({
    result,
    parent: context.parent,
    slideNumber: context.slideNumber,
    nodePath: context.nodePath,
    parentPath: context.parentPath,
    grandparent: context.grandparent,
    grandparentPath: context.grandparentPath,
  });
}

// ─── 容器背景生成 ──────────────────────────────────────────────────────────────

function buildContainerBackground(
  node: LayoutContainerNode,
  box: ComputedBox,
): DirectElementInput {
  return attachSourceSpan({
    type: 'shape',
    position: roundBox(box),
    geometry: node.borderRadius ? 'roundRect' : 'rect',
    style: {
      paint: readOptionalShapePaint(node.backgroundColor, 'View.backgroundColor'),
      border: readOptionalShapeStroke(node.border, 'View.border'),
      borderRadius: node.borderRadius,
      opacity: node.opacity,
    },
  }, node._sourceSpan);
}

// ─── 叶子节点转换 ──────────────────────────────────────────────────────────────

function buildLeafElement(
  node: LayoutNode,
  box: ComputedBox,
): DirectElementInput | null {
  const position = roundBox(box);

  switch (node._type) {
    case 'Text':
      return buildTextElement(node, position);
    case 'Shape':
      return buildShapeElement(node, position);
    case 'Chart':
      return buildChartElement(node, position);
    case 'Table':
      return buildTableElement(node, position);
    case 'Image':
      return buildImageElement(node, position);
    case 'SvgGraphic':
      return buildSvgGraphicElement(node, position);
    case 'Formula':
      return buildFormulaElement(node, position);
    case 'Spacer':
      return null;
    default:
      return null;
  }
}

function buildFormulaElement(
  node: LayoutFormulaNode,
  position: Box,
): DirectElementInput {
  const normalized = normalizeMathFormulaSource({
    latex: node.latex,
    fontSize: node.fontSize,
    color: node.color,
    align: node.align,
    altText: node.altText,
  });
  if ('error' in normalized) throw new FlexComposeContractError(normalized.error);
  const source = normalized.value;
  return attachSourceSpan({
    type: 'formula',
    position,
    formulaSource: node._sourceSpan ? { ...source, sourceSpan: node._sourceSpan } : source,
  }, node._sourceSpan);
}

function buildSvgGraphicElement(
  node: LayoutSvgGraphicNode,
  position: Box,
): DirectElementInput {
  const parsedSource = parseSvgGraphicAuthoringSource(node.source);
  if (parsedSource.error || !parsedSource.source) {
    throw new FlexComposeContractError(parsedSource.error ?? 'SVG Graphic 节点必须提供 source。');
  }
  if (node.fit != null && node.fit !== 'contain' && node.fit !== 'stretch') {
    throw new FlexComposeContractError('SVG Graphic.fit 必须是 contain / stretch。');
  }
  if (node.opacity != null && (
    !Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1
  )) {
    throw new FlexComposeContractError('SVG Graphic.opacity 必须是 0..1 的有限数字。');
  }
  if (node.rotate != null && !Number.isFinite(node.rotate)) {
    throw new FlexComposeContractError('SVG Graphic.rotate 必须是有限数字。');
  }
  const altText = node.altText?.trim();
  if (node.decorative === true && altText) {
    throw new FlexComposeContractError('装饰性 SVG Graphic 不能同时提供 altText。');
  }
  if (node.decorative !== true && !altText) {
    throw new FlexComposeContractError('非装饰性 SVG Graphic 必须提供 altText。');
  }

  return attachSourceSpan({
    type: 'svgGraphic',
    position,
    svgSource: parsedSource.source,
    svgFit: node.fit ?? 'contain',
    svgOpacity: node.opacity,
    svgRotate: node.rotate,
    svgAltText: altText,
    svgDecorative: node.decorative === true,
  }, node._sourceSpan);
}

function buildTextElement(node: LayoutTextNode, position: Box): DirectElementInput {
  // CSS 标准属性名 → DirectElementInput 输出格式映射（同时兼容旧属性名）
  const isBold = node.fontWeight === 'bold'
    || (typeof node.fontWeight === 'number' && node.fontWeight >= 700)
    || node.bold === true;
  const isItalic = node.fontStyle === 'italic' || node.italic === true;
  const isUnderline = node.textDecoration === 'underline' || node.underline === true;
  const lineHeight = node.lineHeight ?? node.lineSpacing;

  return attachSourceSpan({
    type: 'text',
    position,
    content: normalizeLayoutTextContent(node.content, node),
    textWrap: resolveLayoutTextWrapPolicy(node),
    style: {
      fontSize: node.fontSize,
      fontFamily: node.fontFamily,
      bold: isBold || undefined,
      italic: isItalic || undefined,
      underline: isUnderline || undefined,
      color: node.color,
      align: node.textAlign ?? node.align,
      valign: node.verticalAlign ?? node.valign,
      lineSpacing: lineHeight == null
        ? undefined
        : createMultipleTextLineSpacing(lineHeight),
      letterSpacing: node.letterSpacing,
      paint: readOptionalShapePaint(node.backgroundColor, 'Text.backgroundColor'),
      border: readOptionalShapeStroke(node.border, 'Text.border'),
    },
  }, node._sourceSpan);
}

function normalizeLayoutTextContent(
  content: string | LayoutTextRun[] | undefined,
  node: LayoutTextNode,
): string | FreeformInlineRun[] | undefined {
  if (!Array.isArray(content)) return content;
  return content.map((run) => {
    if ('text' in run) return run;
    const formulaInput = typeof run.formula === 'string'
      ? { latex: run.formula }
      : run.formula;
    const normalized = normalizeMathFormulaSource({
      latex: formulaInput.latex,
      altText: formulaInput.altText,
      fontSize: run.style?.fontSize ?? node.fontSize,
      color: run.style?.color ?? node.color,
    }, 'inline');
    if ('error' in normalized) throw new FlexComposeContractError(normalized.error);
    return { formula: normalized.value };
  });
}

function buildShapeElement(node: LayoutShapeNode, position: Box): DirectElementInput {
  return attachSourceSpan({
    type: 'shape',
    position,
    geometry: node.geometry ?? 'rect',
    content: node.content,
    style: {
      paint: readOptionalShapePaint(node.fill, 'Shape.fill'),
      border: readOptionalShapeStroke(node.border, 'Shape.border'),
      borderRadius: node.borderRadius,
      opacity: node.opacity,
      rotate: node.rotate,
    },
  }, node._sourceSpan);
}

function buildChartElement(node: LayoutChartNode, position: Box): DirectElementInput {
  const chartParseResult = parseChartDataLike({
    ...(node.chartData ?? {}),
    categories: node.categories ?? node.chartData?.categories ?? node.chartData?.labels,
    series: node.series ?? node.chartData?.series ?? node.chartData?.datasets,
    chartType: node.chartType ?? node.chartData?.chartType,
  });
  if (chartParseResult.error || !chartParseResult.data) {
    throw new FlexComposeContractError(chartParseResult.error ?? 'Chart 数据解析失败。');
  }

  return attachSourceSpan({
    type: 'chart',
    categoryAxis: node.categoryAxis,
    valueAxis: node.valueAxis,
    secondaryValueAxis: node.secondaryValueAxis,
    stacking: node.stacking,
    dataLabelContent: node.dataLabelContent,
    dataLabelPosition: node.dataLabelPosition,
    position,
    chartPreset: node.preset,
    chartType: chartParseResult.data.chartType,
    categories: chartParseResult.data.categories,
    series: chartParseResult.data.series,
    showDataLabels: node.showDataLabels,
    dataLabelFormat: node.dataLabelFormat,
    legendPosition: node.legendPosition,
    chartStyle: node.chartStyle,
  }, node._sourceSpan);
}

function buildTableElement(node: LayoutTableNode, position: Box): DirectElementInput {
  // 与 buildChartElement 对齐：合并 tableData 子对象与顶层字段，顶层优先
  const tableParseResult = parseTableDataLike({
    ...(node.tableData ?? {}),
    headers: node.headers ?? node.tableData?.headers,
    rows: node.rows ?? node.tableData?.rows ?? node.tableData?.body ?? node.tableData?.data,
  });
  if (tableParseResult.error || !tableParseResult.data) {
    throw new FlexComposeContractError(tableParseResult.error ?? 'Table 数据解析失败。');
  }

  return attachSourceSpan({
    type: 'table',
    position,
    headers: tableParseResult.data.headers,
    rows: tableParseResult.data.rows,
    tableBorder: readOptionalTableBorder(node.border, 'Table.border'),
  }, node._sourceSpan);
}

function buildImageElement(node: LayoutImageNode, position: Box): DirectElementInput {
  if (node.src == null || (typeof node.src === 'string' && node.src.trim().length === 0)) {
    throw new FlexComposeContractError('Image 节点必须提供 src。');
  }
  return attachSourceSpan({
    type: 'image',
    position,
    src: node.src,
    alt: node.alt,
    fitMode: node.fitMode,
    maskShape: node.maskShape,
    rounding: node.rounding,
    transparency: node.transparency,
    shadow: node.shadow,
    rotate: node.rotate,
    flipH: node.flipH,
    flipV: node.flipV,
  }, node._sourceSpan);
}

function attachSourceSpan<T extends DirectElementInput>(
  element: T,
  sourceSpan: SourceSpan | undefined,
): T {
  return sourceSpan ? { ...element, _sourceSpan: sourceSpan } : element;
}

function attachLayoutConstraintEvidence<T extends DirectElementInput>(
  element: T,
  evidence: GeneratedLayoutConstraintEvidence | undefined,
): T {
  return evidence ? { ...element, _layoutConstraintEvidence: evidence } : element;
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

/**
 * Flex DSL 在这里完成 public input → canonical Paint 的 admission。
 * 后续 DeckSpec、预览和导出只消费统一 Paint，避免各链路重复猜测输入语法。
 */
function readOptionalShapePaint(value: unknown, path: string): Paint | undefined {
  if (value == null) return undefined;
  const normalized = normalizeShapeFillInput(value, path);
  if ('error' in normalized) throw new FlexComposeContractError(normalized.error);
  return normalized.value;
}

function readOptionalShapeStroke(value: unknown, path: string): ShapeStrokeStyle | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new FlexComposeContractError(`${path} 必须是描边对象。`);
  }

  const stroke = value;
  if (typeof stroke['width'] !== 'number'
    || !Number.isFinite(stroke['width'])
    || stroke['width'] <= 0) {
    throw new FlexComposeContractError(`${path}.width 必须是大于 0 的有限数字。`);
  }
  const dash = stroke['dash'];
  if (dash != null && dash !== 'solid' && dash !== 'dash' && dash !== 'dot') {
    throw new FlexComposeContractError(`${path}.dash 必须是 solid / dash / dot 之一。`);
  }
  if (stroke['paint'] != null && stroke['color'] != null) {
    throw new FlexComposeContractError(`${path} 不能同时提供 color 与 paint。`);
  }

  const paintResult = stroke['paint'] != null
    ? normalizeStrokePaint(stroke['paint'], `${path}.paint`)
    : normalizeShapeFillInput(stroke['color'], `${path}.color`);
  if ('error' in paintResult) throw new FlexComposeContractError(paintResult.error);
  if (paintResult.value.type === 'radial') {
    throw new FlexComposeContractError(`${path}.paint 暂不支持 radial stroke；请使用 linear gradient。`);
  }

  return {
    width: stroke['width'],
    ...(dash == null ? {} : { dash }),
    paint: paintResult.value,
  };
}

/** Table 的首版公开合同只允许统一纯色边框，不把 Shape 的渐变描边泄漏到表格。 */
function readOptionalTableBorder(value: unknown, path: string): ShapeStrokeStyle | undefined {
  if (value == null) return undefined;
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'color' && key !== 'width')) {
    throw new FlexComposeContractError(`${path} 只支持 { color, width }。`);
  }
  const border = readOptionalShapeStroke(value, path);
  if (!border || !border.paint || border.paint.type !== 'solid') {
    throw new FlexComposeContractError(`${path} 目前只支持纯色描边。`);
  }
  return border;
}

/**
 * DSL 允许 `slide.background = "#FFF"` 简写；DirectSlideInput 要求对象。
 * 此函数将字符串形式归一化为 `{ color }` 对象。
 */
function normalizeSlideBackground(
  bg: LayoutSlideNode['background'] | string | undefined,
): DirectSlideInput['background'] {
  if (bg == null) return undefined;
  if (typeof bg === 'string') {
    return { paint: readOptionalShapePaint(bg, 'Slide.background') };
  }

  const sourceCount = Number(bg.color != null) + Number(bg.gradient != null) + Number(bg.image != null);
  if (sourceCount > 1) {
    throw new FlexComposeContractError('Slide.background 的 color / gradient / image 互斥。');
  }
  if (bg.image != null) return { image: bg.image };
  if (bg.gradient != null) {
    const normalized = normalizeGradientPaint(bg.gradient, 'Slide.background.gradient');
    if ('error' in normalized) throw new FlexComposeContractError(normalized.error);
    return { paint: normalized.value };
  }
  return { paint: readOptionalShapePaint(bg.color, 'Slide.background.color') };
}

/** 将坐标四舍五入到合理精度，避免浮点噪声 */
function roundBox(box: ComputedBox): Box {
  return {
    x: round4(box.x),
    y: round4(box.y),
    w: round4(box.w),
    h: round4(box.h),
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
