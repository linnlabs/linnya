import { hasDecorativeRole, isChromeTextRole } from '../SpatialSemantics';
/**
 * AestheticLint 通用规则（slide-level + deck-level）
 *
 * 设计原则：
 * - 每条规则一个 `lintXxx(...)` 纯函数，签名稳定：page-level 接 `(slideNumber, ...)
 *   → AestheticLintIssue[]`；deck-level 接 `(info / aggregated input) → AestheticLintIssue[]`。
 * - 规则之间**不共享状态**；需要跨规则共享的只有 `samplePageChromaticColors` 的结果，
 *   由主类计算一次并按需传给两个规则（palette 簇数 / 主色漂移）。
 * - 规则**不**回调主类的任何方法——所有依赖通过参数 / module import 显式注入。
 *
 * 阈值集中在 `./thresholds.ts`，色彩采样集中在 `./colorSampling.ts`，
 * 元素小工具集中在 `./elementUtils.ts`，新增规则时优先复用既有 utility。
 */

import {
  assessFontDelivery,
  flattenSlideElements,
  type FontDeliveryTarget,
  type PresentationInfo,
  type SlideElementInfo,
  type SlideElementTextRunInfo,
  type TextFontScript,
} from '@plugin/slides/shared';
import {
  circularMeanDeg,
  circularStdDeviationDeg,
  parseHex,
  wcagContrastRatio,
} from '../colorUtils.js';
import { clusterByGranularity, findContainingShape } from './elementUtils.js';
import { buildDiagnosticNodeRef } from '../functions/buildDiagnosticNodeRef.js';
import type { ChromaticSample } from './colorSampling.js';
import type { ReadingMode } from '@plugin/slides/shared/readingMode';
import {
  EDGE_MARGIN_MIN_IN,
  FONT_FAMILY_COUNT_PER_SCRIPT_LIMIT,
  FONT_SIZE_ANNOTATION_RECOMMENDED_FLOOR_PT,
  FONT_SIZE_NEAR_UNREADABLE_PT,
  FONT_SIZE_RECOMMENDED_FLOOR_PT,
  READING_MODE_FONT_FLOOR_REFERENCE_WIDTH_IN,
  READING_MODE_FONT_FLOORS_PT,
  FONT_SIZE_TIER_GRANULARITY_PT,
  FONT_SIZE_TIER_LIMIT,
  FULL_BLEED_RATIO,
  HUE_CLUSTER_GRANULARITY_DEG,
  IMAGE_ASPECT_TOLERANCE,
  IMAGE_RESOLUTION_MIN_DISPLAY_IN,
  IMAGE_RESOLUTION_MIN_RATIO,
  IMAGE_RESOLUTION_REFERENCE_WIDTH_PX,
  MAX_ELEMENTS_PER_SLIDE,
  PALETTE_HUE_BUCKET_LIMIT,
  PRIMARY_HUE_DRIFT_THRESHOLD_DEG,
  TEXT_CONTRAST_MIN_RATIO,
  TEXT_DENSITY_HIGH,
  TEXT_DENSITY_LOW,
  UNUSED_BOTTOM_CHROME_BAND_RATIO,
  UNUSED_BOTTOM_MIN_TEXT_CHARS,
  UNUSED_BOTTOM_RATIO,
  UNUSED_BOTTOM_STRIPS,
  WHITESPACE_IMBALANCE,
} from './thresholds.js';
import type { AestheticLintIssue } from './types.js';

// ─── Text Density ───────────────────────────────────────────────────────────

export function lintTextDensity(
  slideNumber: number,
  slideSize: { width: number; height: number },
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  const slideArea = slideSize.width * slideSize.height;
  const textElements = elements.filter((e) => e.type === 'text' && e.position);

  let textArea = 0;
  for (const el of textElements) {
    if (el.position) {
      textArea += el.position.w * el.position.h;
    }
  }

  const ratio = textArea / slideArea;

  if (ratio > TEXT_DENSITY_HIGH) {
    issues.push({
      code: 'text_too_dense',
      severity: 'warning',
      confidence: 'medium',
      slides: [slideNumber],
      evidence: {
        kind: 'scalar_metric',
        metric: 'text_area_ratio',
        actual: ratio,
        operator: 'gt',
        threshold: TEXT_DENSITY_HIGH,
        unit: 'ratio',
        sampleCount: textElements.length,
        samples: [textArea, slideArea],
      },
    });
  } else if (textElements.length > 0 && ratio < TEXT_DENSITY_LOW) {
    issues.push({
      code: 'text_too_sparse',
      severity: 'info',
      confidence: 'low',
      slides: [slideNumber],
      evidence: {
        kind: 'scalar_metric',
        metric: 'text_area_ratio',
        actual: ratio,
        operator: 'lt',
        threshold: TEXT_DENSITY_LOW,
        unit: 'ratio',
        sampleCount: textElements.length,
        samples: [textArea, slideArea],
      },
    });
  }

  return issues;
}

// ─── Visual Hierarchy ───────────────────────────────────────────────────────

export function lintHierarchy(
  slideNumber: number,
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const textElements = elements.filter((e) => e.type === 'text' && e.position);
  if (textElements.length < 2) return [];

  // 估算字号范围（从 position.h 推断）
  const heights = textElements
    .map((e) => e.position!.h)
    .filter((h) => h > 0);

  if (heights.length < 2) return [];

  const maxH = Math.max(...heights);
  const minH = Math.min(...heights);

  // 用高度差作为层级代理（高度越大通常字号越大）
  const heightRange = maxH - minH;
  if (heightRange < 0.15) {
    return [{
      code: 'weak_hierarchy',
      severity: 'info',
      confidence: 'low',
      slides: [slideNumber],
      evidence: {
        kind: 'scalar_metric',
        metric: 'text_height_range',
        actual: heightRange,
        operator: 'lt',
        threshold: 0.15,
        unit: 'in',
        sampleCount: heights.length,
        samples: heights,
      },
    }];
  }

  return [];
}

// ─── Whitespace Balance ─────────────────────────────────────────────────────

/**
 * 正文区大片空置：排除满版背景、细线和底部带里的页脚/页码后，把正文区横向切成若干条，
 * 找每条里高于页高 20% 的空档（元素之间或最后一个元素之下）。相邻条带的空档在纵向上
 * 仍有这么高的交集时连成一片，宽度超过正文区三分之一就报告；分栏页只有一栏写短了、
 * 表格和底部脚注之间空着，都能发现。
 * 文字框优先用实际排版高度，避免把撑满的空文本框当成内容。
 */
export function lintUnusedContentArea(
  slideNumber: number,
  slideSize: { width: number; height: number },
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const { width, height } = slideSize;
  const bandTop = height * (1 - UNUSED_BOTTOM_CHROME_BAND_RATIO);
  const chrome: SlideElementInfo[] = [];
  const content: SlideElementInfo[] = [];
  for (const el of elements) {
    const p = el.position;
    // 分组只是布局容器，flex 撑满时会盖住空白；只看叶子元素。
    if (!p || p.w <= 0 || p.h <= 0 || el.type === 'group' || (el.children?.length ?? 0) > 0) continue;
    if (p.w * p.h >= width * height * 0.85 || hasDecorativeRole(el.semanticRole)) continue;
    if (Math.min(p.w, p.h) <= 0.05) continue;
    if (isChromeTextRole(el.semanticRole) || (el.type === 'text' && p.y >= bandTop && p.h <= 0.45)) {
      chrome.push(el);
      continue;
    }
    content.push(el);
  }
  const textChars = content.reduce((sum, el) => sum + countElementChars(el), 0);
  if (content.length < 2 || textChars < UNUSED_BOTTOM_MIN_TEXT_CHARS) return [];

  const frameBottom = chrome.length > 0 ? Math.min(...chrome.map((el) => el.position!.y)) : height;
  const left = Math.min(...content.map((el) => el.position!.x));
  const right = Math.max(...content.map((el) => el.position!.x + el.position!.w));
  const stripWidth = (right - left) / UNUSED_BOTTOM_STRIPS;
  const minGap = height * UNUSED_BOTTOM_RATIO;

  // 每条带列出所有足够高的空档（元素之间，以及最后一个元素到正文区底边）；
  // 相邻条带的空档纵向交集仍够高时连成一片，取最宽的一片。
  let best: { strips: number; top: number; bottom: number } | null = null;
  let runs: { strips: number; top: number; bottom: number }[] = [];
  for (let index = 0; index < UNUSED_BOTTOM_STRIPS; index += 1) {
    const x0 = left + index * stripWidth;
    const x1 = x0 + stripWidth;
    const spans = content
      .filter((el) => el.position!.x < x1 && el.position!.x + el.position!.w > x0)
      .map((el) => [el.position!.y, visibleBottom(el)] as const)
      .sort((a, b) => a[0] - b[0]);
    const gaps: [number, number][] = [];
    let cursor = spans.length > 0 ? spans[0]![1] : Infinity;
    for (const [top, bottom] of spans.slice(1)) {
      if (top - cursor >= minGap) gaps.push([cursor, top]);
      cursor = Math.max(cursor, bottom);
    }
    if (frameBottom - cursor >= minGap) gaps.push([cursor, frameBottom]);

    const next: { strips: number; top: number; bottom: number }[] = [];
    for (const [top, bottom] of gaps) {
      const extended = runs
        .map((run) => ({ strips: run.strips + 1, top: Math.max(run.top, top), bottom: Math.min(run.bottom, bottom) }))
        .filter((run) => run.bottom - run.top >= minGap)
        .sort((a, b) => b.strips - a.strips)[0];
      next.push(extended ?? { strips: 1, top, bottom });
    }
    runs = next;
    for (const run of runs) {
      if (best == null || run.strips > best.strips) best = run;
    }
  }
  if (best == null || best.strips * 3 < UNUSED_BOTTOM_STRIPS) return [];
  const unusedRatio = (best.bottom - best.top) / height;
  return [{
    code: 'content_area_underused',
    severity: 'warning',
    confidence: 'medium',
    slides: [slideNumber],
    evidence: {
      kind: 'scalar_metric',
      metric: 'unused_bottom_ratio',
      actual: unusedRatio,
      operator: 'gt',
      threshold: UNUSED_BOTTOM_RATIO,
      unit: 'ratio',
      sampleCount: 3,
      samples: [best.top, best.bottom, best.strips / UNUSED_BOTTOM_STRIPS],
    },
  }];
}

function countElementChars(el: SlideElementInfo): number {
  const text = el.tableInfo
    ? el.tableInfo.cells.map((cell) => cell.text ?? paragraphText(cell.paragraphs)).join('')
    : el.text ?? paragraphText(el.paragraphs ?? []);
  return text.replace(/\s/gu, '').length;
}

function paragraphText(paragraphs: readonly { runs: readonly { text: string }[] }[]): string {
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('');
}

function visibleBottom(el: SlideElementInfo): number {
  const p = el.position!;
  // 表格行高不随外框拉伸，显式高度大于行高总和时下方是空的；以最后一行的底边为准。
  const cells = el.tableInfo?.cells ?? [];
  if (cells.length > 0) {
    return Math.min(p.y + p.h, Math.max(...cells.map((cell) => cell.position.y + cell.position.h)));
  }
  const layout = el.textLayout;
  const align = el.textBody?.verticalAlign;
  if (el.type === 'text' && layout?.requiredHeightInches != null && (align == null || align === 'top')) {
    return p.y + Math.min(p.h, layout.requiredHeightInches);
  }
  return p.y + p.h;
}

export function lintWhitespace(
  slideNumber: number,
  slideSize: { width: number; height: number },
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const positioned = elements.filter((e) => e.position);
  if (positioned.length === 0) return [];

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const el of positioned) {
    const p = el.position!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }

  const leftMargin = minX;
  const rightMargin = slideSize.width - maxX;
  const topMargin = minY;
  const bottomMargin = slideSize.height - maxY;

  const issues: AestheticLintIssue[] = [];

  // 左右不平衡
  const hTotal = leftMargin + rightMargin;
  if (hTotal > 0) {
    const hImbalance = Math.abs(leftMargin - rightMargin) / hTotal;
    if (hImbalance > WHITESPACE_IMBALANCE && leftMargin > 0.3 && rightMargin > 0.3) {
      issues.push({
        code: 'unbalanced_whitespace',
        severity: 'info',
        confidence: 'low',
        slides: [slideNumber],
        evidence: {
          kind: 'margin_balance',
          axis: 'horizontal',
          margins: { left: leftMargin, right: rightMargin, top: topMargin, bottom: bottomMargin },
          imbalanceRatio: hImbalance,
          threshold: WHITESPACE_IMBALANCE,
        },
      });
    }
  }

  // 上下不平衡（仅在内容集中在上半部分或下半部分时提示）
  const vTotal = topMargin + bottomMargin;
  if (vTotal > 0) {
    const vImbalance = Math.abs(topMargin - bottomMargin) / vTotal;
    if (vImbalance > WHITESPACE_IMBALANCE && bottomMargin > 1.5) {
      issues.push({
        code: 'unbalanced_whitespace',
        severity: 'info',
        confidence: 'low',
        slides: [slideNumber],
        evidence: {
          kind: 'margin_balance',
          axis: 'vertical',
          margins: { left: leftMargin, right: rightMargin, top: topMargin, bottom: bottomMargin },
          imbalanceRatio: vImbalance,
          threshold: WHITESPACE_IMBALANCE,
        },
      });
    }
  }

  return issues;
}

// ─── Element Count ──────────────────────────────────────────────────────────

export function lintElementCount(
  slideNumber: number,
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  if (elements.length > MAX_ELEMENTS_PER_SLIDE) {
    return [{
      code: 'too_many_elements',
      severity: 'warning',
      confidence: 'medium',
      slides: [slideNumber],
      evidence: {
        kind: 'scalar_metric',
        metric: 'renderable_count',
        actual: elements.length,
        operator: 'gt',
        threshold: MAX_ELEMENTS_PER_SLIDE,
        unit: 'count',
        sampleCount: elements.length,
        samples: [],
      },
    }];
  }
  return [];
}

// ─── Visual Anchor ──────────────────────────────────────────────────────────

/**
 * 检查页面是否"既无几何锚点也无字号锚点"。
 *
 * 设计权衡：均衡布局是合法设计选择（modern minimalist / consulting / academic
 * 风格普遍如此），不应该被识别为缺陷。旧版触发条件（4 元素 + 最大 < 1.5×次大）
 * 误判率极高，会误导 AI 把均衡 grid 改成"hero + 配角"破坏整体风格。
 *
 * 收紧后的触发要求**同时满足**三条：
 * 1. 元素数 ≥ 6（少元素页面通常本身就靠 layout 自洽，不需要锚点）
 * 2. 最大几何元素面积 < 整页 25%（确实没有几何上的锚点）
 * 3. 最大文本字号 < 18pt（也没有字号上的"标题锚点"）
 *
 * 即使满足，输出仍为 `severity: 'info'`，且 `PptInspectTool` 默认会把这条
 * 隐藏，仅在 verbose 模式下输出，避免 AI 误把"风格选择"当作"必须修复的缺陷"。
 */
export function lintVisualAnchor(
  slideNumber: number,
  slideSize: { width: number; height: number },
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  if (elements.length < 6) return [];

  const positioned = elements.filter((e) => e.position);
  if (positioned.length < 6) return [];

  const areas = positioned.map((e) => e.position!.w * e.position!.h);
  const largestArea = Math.max(...areas);
  const largestNode = positioned[areas.indexOf(largestArea)];
  if (!largestNode?.position) return [];
  const slideArea = slideSize.width * slideSize.height;
  const largestAreaRatio = largestArea / slideArea;

  if (largestAreaRatio >= 0.25) return [];

  const maxTextNode = positioned.reduce<SlideElementInfo | undefined>((current, element) => {
    if (element.type !== 'text') return current;
    return current == null || (element.fontSize ?? 0) > (current.fontSize ?? 0) ? element : current;
  }, undefined);
  const maxFontSize = positioned.reduce((acc, e) => {
    const fs = e.fontSize ?? 0;
    return fs > acc ? fs : acc;
  }, 0);
  if (maxFontSize >= 18) return [];

  return [{
    code: 'missing_visual_anchor',
    severity: 'info',
    confidence: 'low',
    slides: [slideNumber],
    evidence: {
      kind: 'visual_anchor',
      largestNode: buildDiagnosticNodeRef(largestNode),
      largestAreaRatio,
      ...(maxTextNode?.position ? { maxTextNode: buildDiagnosticNodeRef(maxTextNode) } : {}),
      maxFontSizePt: maxFontSize,
      areaRatioThreshold: 0.25,
      fontSizeThresholdPt: 18,
      sampleCount: positioned.length,
    },
  }];
}

// ─── P1 Tier-1: Font Size Floor ─────────────────────────────────────────────
/**
 * 检查实际 run 的最小字号；旧输入没有 paragraphs 时才退回元素摘要字号。
 * near-unreadable 阈值对所有角色一致。
 *
 * 生成稿传入阅读方式：正文、图注标签、脚注来源三档下限按阅读方式取值，再按页宽折算。
 * 导入稿和改稿不传，沿用固定下限，避免催 Agent 改作者原有字号。
 */
export function lintFontSizeFloor(
  slideNumber: number,
  slideSize: { width: number },
  elements: SlideElementInfo[],
  readingMode?: ReadingMode,
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  for (const element of elements) {
    if (element.type !== 'text' && element.paragraphs == null) continue;
    const sizes = collectElementFontSizes(element);
    if (sizes.length === 0) continue;
    const size = Math.min(...sizes);
    const recommendedFloor = readingMode
      ? resolveReadingModeFontFloor(element.semanticRole, readingMode, slideSize.width)
      : resolveRecommendedFontFloor(element.semanticRole);

    if (size < FONT_SIZE_NEAR_UNREADABLE_PT) {
      issues.push({
        code: 'font_size_below_floor',
        severity: 'warning',
        confidence: 'high',
        slides: [slideNumber],
        evidence: {
          kind: 'scalar_metric',
          metric: 'font_size',
          actual: size,
          operator: 'lt',
          threshold: FONT_SIZE_NEAR_UNREADABLE_PT,
          unit: 'pt',
          sampleCount: sizes.length,
          samples: sizes,
          node: buildDiagnosticNodeRef(element),
          semanticRole: element.semanticRole ?? 'general_text',
        },
      });
    } else if (size < recommendedFloor) {
      issues.push({
        code: 'font_size_below_floor',
        severity: 'warning',
        confidence: 'medium',
        slides: [slideNumber],
        evidence: {
          kind: 'scalar_metric',
          metric: 'font_size',
          actual: size,
          operator: 'lt',
          threshold: recommendedFloor,
          unit: 'pt',
          sampleCount: sizes.length,
          samples: sizes,
          node: buildDiagnosticNodeRef(element),
          semanticRole: element.semanticRole ?? 'general_text',
        },
      });
    }
  }
  return issues;
}

const SMALL_TEXT_ROLES = new Set(['annotation', 'axis-label', 'caption', 'footnote', 'label', 'source']);
const CAPTION_TEXT_ROLES = new Set(['annotation', 'axis-label', 'caption', 'label']);
const CHROME_TEXT_ROLES = new Set(['footnote', 'page-number', 'source']);

function collectElementFontSizes(element: SlideElementInfo): number[] {
  const runSizes = element.paragraphs
    ?.flatMap((paragraph) => paragraph.runs)
    .map((run) => run.fontSize)
    .filter((size): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0)
    ?? [];
  if (runSizes.length > 0) return runSizes;
  return typeof element.fontSize === 'number' && Number.isFinite(element.fontSize) && element.fontSize > 0
    ? [element.fontSize]
    : [];
}

function resolveRecommendedFontFloor(semanticRole: string | undefined): number {
  return semanticRole != null && SMALL_TEXT_ROLES.has(semanticRole.trim().toLowerCase())
    ? FONT_SIZE_ANNOTATION_RECOMMENDED_FLOOR_PT
    : FONT_SIZE_RECOMMENDED_FLOOR_PT;
}

function resolveReadingModeFontFloor(
  semanticRole: string | undefined,
  readingMode: ReadingMode,
  slideWidthIn: number,
): number {
  const floors = READING_MODE_FONT_FLOORS_PT[readingMode];
  const role = semanticRole?.trim().toLowerCase() ?? '';
  const base = CHROME_TEXT_ROLES.has(role)
    ? floors.chrome
    : CAPTION_TEXT_ROLES.has(role) ? floors.caption : floors.body;
  const scale = slideWidthIn > 0 ? slideWidthIn / READING_MODE_FONT_FLOOR_REFERENCE_WIDTH_IN : 1;
  // 折算到 0.25pt，避免 13.33 与 13.333 这类页宽差异产生 13.99pt 之类的阈值。
  return Math.round(base * scale * 4) / 4;
}

// ─── P1 Tier-1: Font Size Tiers ─────────────────────────────────────────────
/**
 * 检查单页字号档位数。相差不超过 0.5pt 的字号聚为同一档，档位数 > 4 → warning。
 * 典型 slide 应 ≤ 4 档（主标题 / 副标题 / 正文 / 注释）；超过意味着层级信号发散。
 */
export function lintFontSizeTiers(
  slideNumber: number,
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const sizes: number[] = [];
  for (const element of elements) {
    if (element.type !== 'text' || isChromeTextRole(element.semanticRole)) continue;
    const size = element.fontSize;
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
      sizes.push(size);
    }
  }
  if (sizes.length < 2) return [];

  const tiers = clusterByGranularity(sizes, FONT_SIZE_TIER_GRANULARITY_PT);
  if (tiers.length <= FONT_SIZE_TIER_LIMIT) return [];

  return [{
    code: 'font_size_tier_overload',
    severity: 'warning',
    confidence: 'medium',
    slides: [slideNumber],
    evidence: {
      kind: 'scalar_metric',
      metric: 'font_size_tiers',
      actual: tiers.length,
      operator: 'gt',
      threshold: FONT_SIZE_TIER_LIMIT,
      unit: 'count',
      sampleCount: sizes.length,
      samples: tiers,
    },
  }];
}

// ─── P1 Tier-1: Edge Margins (元素贴边) ────────────────────────────────────
/**
 * 检查元素是否过于贴近画布边缘（< 0.3"）。
 *
 * **轴独立的 full-bleed 豁免**（避免误报，避免漏报）：
 * - 元素宽度 ≥ 95% 画布宽 → 视为水平 full-bleed → 仅豁免左/右贴边检查
 * - 元素高度 ≥ 95% 画布高 → 视为垂直 full-bleed → 仅豁免上/下贴边检查
 *
 * 这样：
 * - 背景图（横纵都 ≥ 95%）→ 4 边都豁免 ✅
 * - 顶部全宽分隔条（宽 100% / 高 0.05"）→ 仅豁免左右，但因为高度本来就极小、
 *   它和上下边缘"贴"是设计意图，所以也不会触发（仅 4 边都贴近时才报）
 * - 仅一边超出阈值的"装饰矩形"→ 触发，提示 AI 加 padding
 *
 * **报警策略**：每个元素最多触发一次，把违例边汇总在一条 message 里，避免噪声。
 * 多个元素同侧贴边各自独立报警——更精准，且 cookbook 反例（"3 个文本框都贴左边"）
 * 也能被完整捕捉到。
 */
export function lintEdgeMargins(
  slideNumber: number,
  slideSize: { width: number; height: number },
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  const horizontalFullBleedRatio = FULL_BLEED_RATIO;
  const verticalFullBleedRatio = FULL_BLEED_RATIO;

  for (const element of elements) {
    const p = element.position;
    if (!p || hasDecorativeRole(element.semanticRole)) continue;
    // 元素超出画布或负坐标本身是 LayoutLint 关注点，这里只看真正"在画布内但贴边"的情形
    if (p.w <= 0 || p.h <= 0) continue;
    if (p.x < 0 || p.y < 0) continue;
    if (p.x + p.w > slideSize.width + 1e-3) continue;
    if (p.y + p.h > slideSize.height + 1e-3) continue;

    const isHorizontalFullBleed = p.w >= slideSize.width * horizontalFullBleedRatio;
    const isVerticalFullBleed = p.h >= slideSize.height * verticalFullBleedRatio;

    const violations: Array<'left' | 'right' | 'top' | 'bottom'> = [];
    const margins = {
      left: p.x,
      right: slideSize.width - (p.x + p.w),
      top: p.y,
      bottom: slideSize.height - (p.y + p.h),
    };
    if (!isHorizontalFullBleed) {
      if (margins.left < EDGE_MARGIN_MIN_IN) violations.push('left');
      if (margins.right < EDGE_MARGIN_MIN_IN) violations.push('right');
    }
    if (!isVerticalFullBleed) {
      if (margins.top < EDGE_MARGIN_MIN_IN) violations.push('top');
      if (margins.bottom < EDGE_MARGIN_MIN_IN) violations.push('bottom');
    }

    if (violations.length === 0) continue;

    issues.push({
      code: 'element_edge_margin',
      severity: 'info',
      confidence: 'medium',
      slides: [slideNumber],
      evidence: {
        kind: 'node_bounds',
        assessment: 'insufficient_margin',
        node: buildDiagnosticNodeRef(element),
        referenceBox: { x: 0, y: 0, w: slideSize.width, h: slideSize.height, unit: 'in' },
        margins,
        violatedSides: violations,
        thresholdInches: EDGE_MARGIN_MIN_IN,
        policyId: 'safe_edge_margin',
        fullBleedAxes: [
          ...(isHorizontalFullBleed ? ['horizontal' as const] : []),
          ...(isVerticalFullBleed ? ['vertical' as const] : []),
        ],
      },
    });
  }
  return issues;
}

// ─── P1 Tier-1: Font Family Consistency (deck-level) ───────────────────────
/**
 * 只消费每个 run 已有的 resolved family / script / resolution 事实：
 * - weight/style 不构成新 family；
 * - Latin 与 East Asian 分开统计，允许正常的双脚本主题配对；
 * - unresolved 单独报告，不混入 family 数量；
 * - 缺少正式解析事实的旧输入跳过，禁止重新根据原始 family 字符串猜测。
 */
export function lintFontFamilyConsistency(info: PresentationInfo): AestheticLintIssue[] {
  const familiesByScript = new Map<
    TextFontScript,
    Map<string, AggregatedFontUsage>
  >();
  const unresolved = new Map<string, AggregatedFontUsage>();
  for (const slide of info.slides) {
    for (const element of flattenSlideElements(slide.elements)) {
      if (element.paragraphs == null || isChromeTextRole(element.semanticRole)) continue;
      for (const run of element.paragraphs.flatMap((paragraph) => paragraph.runs)) {
        collectResolvedFontUsage(run, slide.number, familiesByScript, unresolved);
      }
    }
  }

  const issues: AestheticLintIssue[] = [];
  for (const [script, families] of familiesByScript) {
    if (families.size <= FONT_FAMILY_COUNT_PER_SCRIPT_LIMIT) continue;
    const displayList = Array.from(families.values()).map((value) => value.display);
    issues.push({
      code: 'font_family_inconsistent',
      severity: 'warning',
      confidence: 'medium',
      slides: collectUsageSlides(families.values()),
      evidence: {
        kind: 'font_inventory',
        assessment: 'inconsistent_families',
        script,
        resolvedFamilies: displayList,
        unresolvedFamilies: [],
        familyCount: families.size,
        limit: FONT_FAMILY_COUNT_PER_SCRIPT_LIMIT,
        runCount: Array.from(families.values()).reduce((sum, value) => sum + value.runCount, 0),
      },
    });
  }

  if (unresolved.size > 0) {
    const unresolvedList = Array.from(unresolved.values());
    issues.push({
      code: 'font_unresolved',
      severity: 'warning',
      confidence: 'high',
      slides: collectUsageSlides(unresolvedList),
      evidence: {
        kind: 'font_inventory',
        assessment: 'unresolved_families',
        script: 'unknown',
        resolvedFamilies: [],
        unresolvedFamilies: unresolvedList.map((value) => value.display),
        familyCount: unresolved.size,
        limit: 0,
        runCount: unresolvedList.reduce((sum, value) => sum + value.runCount, 0),
      },
    });
  }

  return issues;
}

/**
 * 字体族替换是确定性渲染事实，即使落地 face 的 bold/italic 与请求一致，也需要单独可观察。
 * 相同 requested -> resolved + script 映射聚合为一条 finding，避免按正文 run 重复刷屏。
 */
export function lintFontFamilySubstitution(
  info: PresentationInfo,
  fontTarget?: FontDeliveryTarget,
): AestheticLintIssue[] {
  const substitutions = new Map<string, {
    firstSlide: number;
    slideNumbers: Set<number>;
    requestedFamily: string;
    resolvedFamily: string;
    script: TextFontScript;
    runCount: number;
  }>();

  for (const slide of info.slides) {
    for (const element of flattenSlideElements(slide.elements)) {
      if (element.paragraphs == null) continue;
      for (const run of element.paragraphs.flatMap((paragraph) => paragraph.runs)) {
        const requestedFamily = run.fontFamily?.trim();
        const resolvedFamily = run.resolvedFontFamily?.trim();
        if (
          run.fontResolution !== 'substituted'
          || run.fontScript == null
          || !requestedFamily
          || !resolvedFamily
          || normalizeFontFamily(requestedFamily) === normalizeFontFamily(resolvedFamily)
          // 目标是 Office 时，本机缺少的 Office 字体只是预览替代；放映端有原字体，不能催 Agent 换成本机字体。
          || (fontTarget === 'office'
            && assessFontDelivery(requestedFamily, fontTarget, run.fontScript).status !== 'unavailable')
        ) {
          continue;
        }
        const key = [
          run.fontScript,
          normalizeFontFamily(requestedFamily),
          normalizeFontFamily(resolvedFamily),
        ].join('\u0000');
        const existing = substitutions.get(key);
        if (existing) {
          existing.runCount += 1;
          existing.slideNumbers.add(slide.number);
          continue;
        }
        substitutions.set(key, {
          firstSlide: slide.number,
          slideNumbers: new Set([slide.number]),
          requestedFamily,
          resolvedFamily,
          script: run.fontScript,
          runCount: 1,
        });
      }
    }
  }

  return [...substitutions.values()].map((substitution) => ({
    code: 'font_family_substituted',
    severity: 'warning',
    confidence: 'high',
    slides: [...substitution.slideNumbers].sort((left, right) => left - right),
    evidence: {
      kind: 'font_resolution',
      difference: 'family',
      requestedFamily: substitution.requestedFamily,
      resolvedFamily: substitution.resolvedFamily,
      requestedStyle: 'unspecified',
      resolvedStyle: 'unspecified',
      script: substitution.script,
      resolution: 'substituted',
      runCount: substitution.runCount,
      firstAffectedSlide: substitution.firstSlide,
    },
  }));
}

/**
 * 生成稿声明的字体在目标放映环境中不存在时报告，按 requested family 聚合。
 * 只看作者声明的 family，不看本机解析结果：本机装了 Songti SC 不代表 Windows 上有。
 */
export function lintFontDelivery(
  info: PresentationInfo,
  fontTarget: FontDeliveryTarget | undefined,
): AestheticLintIssue[] {
  if (fontTarget == null || fontTarget === 'local') return [];
  const missing = new Map<string, {
    requestedFamily: string;
    script: TextFontScript | 'unknown';
    alternatives: readonly string[];
    slideNumbers: Set<number>;
    firstSlide: number;
    runCount: number;
  }>();

  for (const slide of info.slides) {
    for (const element of flattenSlideElements(slide.elements)) {
      if (element.paragraphs == null) continue;
      for (const run of element.paragraphs.flatMap((paragraph) => paragraph.runs)) {
        const requestedFamily = run.fontFamily?.trim();
        if (!requestedFamily || !/\S/u.test(run.text)) continue;
        const assessment = assessFontDelivery(requestedFamily, fontTarget, run.fontScript);
        if (assessment.status !== 'unavailable') continue;
        const key = normalizeFontFamily(requestedFamily);
        const existing = missing.get(key);
        if (existing) {
          existing.runCount += 1;
          existing.slideNumbers.add(slide.number);
          continue;
        }
        missing.set(key, {
          requestedFamily,
          script: run.fontScript ?? 'unknown',
          alternatives: assessment.alternatives,
          slideNumbers: new Set([slide.number]),
          firstSlide: slide.number,
          runCount: 1,
        });
      }
    }
  }

  return [...missing.values()].map((usage) => ({
    code: 'font_not_deliverable',
    severity: 'warning',
    confidence: 'high',
    slides: [...usage.slideNumbers].sort((left, right) => left - right),
    evidence: {
      kind: 'font_delivery',
      target: fontTarget,
      requestedFamily: usage.requestedFamily,
      script: usage.script,
      alternatives: [...usage.alternatives],
      runCount: usage.runCount,
      firstAffectedSlide: usage.firstSlide,
    },
  }));
}

/**
 * 上游已经解析出真实 face 样式时，明确报告请求样式与落地样式的差异。
 * 这是确定性字体事实，不在 quality 层重新解析 family 或猜测字体文件。
 */
export function lintFontStyleSubstitution(info: PresentationInfo): AestheticLintIssue[] {
  const mismatches: Array<{
    slideNumber: number;
    requested: string;
    resolved: string;
    declaredFamily?: string;
    resolvedFamily?: string;
  }> = [];

  for (const slide of info.slides) {
    for (const element of flattenSlideElements(slide.elements)) {
      if (element.paragraphs == null) continue;
      for (const run of element.paragraphs.flatMap((paragraph) => paragraph.runs)) {
        if (run.fontResolution !== 'exact' && run.fontResolution !== 'substituted') continue;
        if (run.resolvedBold == null && run.resolvedItalic == null) continue;
        const requestedBold = run.bold === true;
        const requestedItalic = run.italic === true;
        const resolvedBold = run.resolvedBold ?? requestedBold;
        const resolvedItalic = run.resolvedItalic ?? requestedItalic;
        if (requestedBold === resolvedBold && requestedItalic === resolvedItalic) continue;
        mismatches.push({
          slideNumber: slide.number,
          requested: formatFontStyle(requestedBold, requestedItalic),
          resolved: formatFontStyle(resolvedBold, resolvedItalic),
          declaredFamily: run.fontFamily,
          resolvedFamily: run.resolvedFontFamily,
        });
      }
    }
  }

  const first = mismatches[0];
  if (first == null) return [];
  return [{
    code: 'font_style_substituted',
    severity: 'warning',
    confidence: 'high',
    slides: [...new Set(mismatches.map((mismatch) => mismatch.slideNumber))],
    evidence: {
      kind: 'font_resolution',
      difference: 'style',
      requestedFamily: first.declaredFamily ?? 'unspecified',
      resolvedFamily: first.resolvedFamily ?? 'unspecified',
      requestedStyle: first.requested,
      resolvedStyle: first.resolved,
      script: 'unknown',
      resolution: first.declaredFamily !== first.resolvedFamily ? 'substituted' : 'exact',
      runCount: mismatches.length,
      firstAffectedSlide: first.slideNumber,
    },
  }];
}

function formatFontStyle(bold: boolean, italic: boolean): string {
  return `${bold ? 'bold' : 'regular'} ${italic ? 'italic' : 'upright'}`;
}

function collectResolvedFontUsage(
  run: SlideElementTextRunInfo,
  slideNumber: number,
  familiesByScript: Map<TextFontScript, Map<string, AggregatedFontUsage>>,
  unresolved: Map<string, AggregatedFontUsage>,
): void {
  const declaredFamily = run.fontFamily?.trim();
  if (run.fontResolution === 'unresolved') {
    if (declaredFamily) {
      const key = declaredFamily.toLocaleLowerCase('en-US');
      const current = unresolved.get(key);
      if (current) {
        current.runCount += 1;
        current.slideNumbers.add(slideNumber);
      } else {
        unresolved.set(key, {
          display: declaredFamily,
          slideNumbers: new Set([slideNumber]),
          runCount: 1,
        });
      }
    }
    return;
  }
  if (run.fontResolution === 'not-ready' || run.fontScript == null) return;
  // 数学/货币符号与上下标数字是中性字形；它们的补字字体不代表正文选了新字体族。
  // 未解析字体仍由上面的分支报告，不能因此隐藏真实缺字。
  if (run.fontResolution === 'substituted' && !/[\p{Letter}\p{Decimal_Number}]/u.test(run.text)) return;

  const resolvedFamily = run.resolvedFontFamily?.trim();
  if (!resolvedFamily) return;
  const key = resolvedFamily.toLocaleLowerCase('en-US');
  let families = familiesByScript.get(run.fontScript);
  if (!families) {
    families = new Map();
    familiesByScript.set(run.fontScript, families);
  }
  const current = families.get(key);
  if (current) {
    current.runCount += 1;
    current.slideNumbers.add(slideNumber);
  } else {
    families.set(key, {
      display: resolvedFamily,
      slideNumbers: new Set([slideNumber]),
      runCount: 1,
    });
  }
}

interface AggregatedFontUsage {
  readonly display: string;
  readonly slideNumbers: Set<number>;
  runCount: number;
}

function collectUsageSlides(usages: Iterable<AggregatedFontUsage>): number[] {
  const slides = new Set<number>();
  for (const usage of usages) {
    for (const slideNumber of usage.slideNumbers) slides.add(slideNumber);
  }
  return [...slides].sort((left, right) => left - right);
}

function normalizeFontFamily(family: string): string {
  return family.toLocaleLowerCase('en-US');
}

// ─── P1 Tier-1: Palette Diversity (Rule 1) ─────────────────────────────────
/**
 * 单页非中性主色 hue 簇数 > 4 → warning。
 *
 * 流程：
 * 1. 采样所有元素的 fill / textColor，过滤中性色（近灰/近白/近黑）。
 * 2. 按 30° hue 桶聚类，统计**非空桶**数量（即"色相簇数"）。
 * 3. 桶数 > 4 → warning。
 *
 * 为什么不直接 distinct hex？
 * - 同主色的浅深 tone（如 #1F4F8A / #2A66B0）算 1 个色相簇而非 2。
 * - 中性色（白/灰/黑及其近邻）不计入"色彩"。
 */
export function lintPaletteDiversity(
  slideNumber: number,
  sampled: ChromaticSample[],
): AestheticLintIssue[] {
  if (sampled.length === 0) return [];
  const buckets = new Set<number>();
  for (const s of sampled) {
    buckets.add(Math.floor(s.hsl.h / HUE_CLUSTER_GRANULARITY_DEG));
  }
  if (buckets.size <= PALETTE_HUE_BUCKET_LIMIT) return [];

  /* sample 列表去重并截短，仅作消息提示 */
  const seen = new Set<string>();
  const sampleHexes: string[] = [];
  for (const s of sampled) {
    const key = s.hex.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sampleHexes.push(s.hex);
    if (sampleHexes.length >= 6) break;
  }
  return [{
    code: 'palette_too_diverse',
    severity: 'warning',
    confidence: 'medium',
    slides: [slideNumber],
    evidence: {
      kind: 'color_palette',
      hueClusterCount: buckets.size,
      limit: PALETTE_HUE_BUCKET_LIMIT,
      sampleColors: sampleHexes,
      sampleCount: sampled.length,
    },
  }];
}

// ─── P1 Tier-1: Primary Hue Drift (Rule 8, deck-level) ─────────────────────
/**
 * 跨页主色 hue 圆形 stddev > 25° → warning。
 *
 * 主色定义：每页"非中性色簇中按面积加权的最大者"——见 `pickPrimaryHue`。
 *
 * 圆形 stddev：把 hue 视为单位圆角度做矢量平均，
 * 自然处理 350°/10° 的环绕邻近性。
 */
export function lintPrimaryHueDrift(
  primaries: Array<{ slideNumber: number; hue: number }>,
): AestheticLintIssue[] {
  if (primaries.length < 2) return [];
  const stddev = circularStdDeviationDeg(primaries.map((p) => p.hue));
  if (stddev <= PRIMARY_HUE_DRIFT_THRESHOLD_DEG) return [];

  return [{
    code: 'primary_hue_drift',
    severity: 'warning',
    confidence: 'medium',
    slides: primaries.map((primary) => primary.slideNumber),
    evidence: {
      kind: 'hue_drift',
      primaryHues: primaries.map((primary) => ({
        slideNumber: primary.slideNumber,
        hueDegrees: primary.hue,
      })),
      circularMeanDegrees: circularMeanDeg(primaries.map((primary) => primary.hue)),
      circularStdDevDegrees: stddev,
      thresholdDegrees: PRIMARY_HUE_DRIFT_THRESHOLD_DEG,
    },
  }];
}

// ─── P1 Tier-1: Text Contrast (Rule 10) ────────────────────────────────────
/**
 * 文本元素与其底层填充 WCAG 对比度 < 3.0 → warning。
 *
 * 底层填充推断：找 bbox 完全包含该文本框、且面积最小的 shape（视为最贴近的容器），
 * 取其 `fill`。找不到则跳过——避免误用全局背景色（lint 不持有页面背景）。
 *
 * 为什么不分大小字体阈值？
 * - 当前 `textStyle.fontSize` 仅是首 run 字号，无法确切判断"主体字号"。
 * - 统一用 3.0（WCAG AA 大字下限）：
 *   - 命中即"几乎不可读"（白底浅黄 / 浅蓝底白字等极端情况）。
 *   - 不会把"3.5 的灰底白字 body"误报。
 */
export function lintTextContrast(
  slideNumber: number,
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  const shapes = elements.filter(
    (e) => e.type === 'shape' && e.fill && e.position,
  );
  for (const text of elements) {
    if (text.type !== 'text') continue;
    if (!text.position || !text.textColor) continue;

    const textRgb = parseHex(text.textColor);
    if (!textRgb) continue;

    const container = findContainingShape(text, shapes);
    if (!container || !container.fill) continue;
    const bgRgb = parseHex(container.fill);
    if (!bgRgb) continue;

    const ratio = wcagContrastRatio(textRgb, bgRgb);
    if (ratio >= TEXT_CONTRAST_MIN_RATIO) continue;

    issues.push({
      code: 'text_contrast_low',
      severity: 'warning',
      confidence: 'medium',
      slides: [slideNumber],
      evidence: {
        kind: 'color_contrast',
        textNode: buildDiagnosticNodeRef(text),
        containerNode: buildDiagnosticNodeRef(container),
        textColor: text.textColor,
        backgroundColor: container.fill,
        contrastRatio: ratio,
        thresholdRatio: TEXT_CONTRAST_MIN_RATIO,
        containerInference: 'smallest_containing_shape',
      },
    });
  }
  return issues;
}

// ─── P1 Tier-1: Image Aspect Distortion (Rule 7) ───────────────────────────
/**
 * 图片元素 fit=stretch 且元素宽高比与 imageNaturalAspect 偏差 > 10% → warning。
 *
 * 仅 stretch 模式有压扁/拉伸风险——cover/contain/fill 都保留宽高比或裁剪。
 * 缺少 imageNaturalAspect 时跳过（PptxReader 路径暂无该数据）。
 */
/**
 * 按 fitMode 估算图片可见区域在页面上每英寸分到多少源像素，与 1920px 宽放映所需像素比较。
 * contain 取整图缩放，cover/fill 取覆盖缩放，stretch 取两轴中较差的一轴；裁剪先扣掉被裁部分。
 */
export function lintImageResolution(
  slideNumber: number,
  slideSize: { width: number; height: number },
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  const targetPpi = IMAGE_RESOLUTION_REFERENCE_WIDTH_PX / slideSize.width;
  for (const el of elements) {
    if (el.type !== 'image' || !el.position || !el.imageNaturalSizePx) continue;
    const { w, h } = el.position;
    if (w < IMAGE_RESOLUTION_MIN_DISPLAY_IN || h <= 0) continue;
    const crop = el.imageCrop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const visibleW = el.imageNaturalSizePx.width * Math.max(0, 1 - crop.left - crop.right);
    const visibleH = el.imageNaturalSizePx.height * Math.max(0, 1 - crop.top - crop.bottom);
    if (visibleW <= 0 || visibleH <= 0) continue;
    const effectivePpi = resolveEffectivePpi(el.imageFit ?? 'contain', visibleW, visibleH, w, h);
    const ratio = effectivePpi / targetPpi;
    if (ratio >= IMAGE_RESOLUTION_MIN_RATIO) continue;
    issues.push({
      code: 'image_resolution_low',
      severity: 'warning',
      confidence: 'medium',
      slides: [slideNumber],
      evidence: {
        kind: 'image_resolution',
        node: buildDiagnosticNodeRef(el),
        fitMode: el.imageFit ?? 'contain',
        visibleWidthPx: Math.round(visibleW),
        visibleHeightPx: Math.round(visibleH),
        effectivePpi: Math.round(effectivePpi),
        targetPpi: Math.round(targetPpi),
        ratio,
        thresholdRatio: IMAGE_RESOLUTION_MIN_RATIO,
      },
    });
  }
  return issues;
}

function resolveEffectivePpi(
  fit: NonNullable<SlideElementInfo['imageFit']>,
  pxW: number,
  pxH: number,
  inW: number,
  inH: number,
): number {
  const horizontal = pxW / inW;
  const vertical = pxH / inH;
  if (fit === 'contain') return Math.max(horizontal, vertical);
  return Math.min(horizontal, vertical);
}

export function lintImageAspect(
  slideNumber: number,
  elements: SlideElementInfo[],
): AestheticLintIssue[] {
  const issues: AestheticLintIssue[] = [];
  for (const el of elements) {
    if (el.type !== 'image') continue;
    if (el.imageFit !== 'stretch') continue;
    if (!el.position || el.position.w <= 0 || el.position.h <= 0) continue;
    if (typeof el.imageNaturalAspect !== 'number' || el.imageNaturalAspect <= 0) continue;

    const elementAspect = el.position.w / el.position.h;
    const deviation = Math.abs(elementAspect / el.imageNaturalAspect - 1);
    if (deviation <= IMAGE_ASPECT_TOLERANCE) continue;

    issues.push({
      code: 'image_aspect_distorted',
      severity: 'warning',
      confidence: 'high',
      slides: [slideNumber],
      evidence: {
        kind: 'image_aspect',
        node: buildDiagnosticNodeRef(el),
        fitMode: 'stretch',
        frameAspect: elementAspect,
        naturalAspect: el.imageNaturalAspect,
        deviationRatio: deviation,
        thresholdRatio: IMAGE_ASPECT_TOLERANCE,
      },
    });
  }
  return issues;
}
