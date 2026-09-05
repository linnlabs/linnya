import {
  DEFAULT_TEXT_LINE_SPACING_MULTIPLE,
  flattenSlideElements,
  segmentClusters,
  type SlideElementTableCellTextInfo,
  type SlideElementParagraphInfo,
  type PresentationInfo,
  type SlideElementInfo,
  type TextLayoutResult,
} from '@plugin/slides/shared';
import { defaultTextMeasureService } from '@plugin/backend/textMeasurement';
import type { TextMeasureInput } from '@plugin/backend/textMeasurement';
import {
  annotateLineNodeSemantics,
  classifyOverlap,
  intersectionBox,
  isThinDecorativeShape,
  smallerBoxCoveredRatio,
} from './SpatialSemantics.js';
import type { QualityDiagnosticDraft } from './definitions';
import { buildDiagnosticNodeRef } from './functions/buildDiagnosticNodeRef';
import { buildFinalTextLineOccupancies } from './functions/buildTextLineOccupancy';
import { lintGeneratedLayoutConstraints } from './generatedLayoutConstraints';

export type LayoutLintCode =
  | 'out_of_bounds'
  | 'element_overlap'
  | 'text_decoration_collision'
  | 'origin_stacking'
  | 'text_overflow_risk'
  | 'short_numeric_text_wrapped'
  | 'text_single_glyph_last_line'
  | 'zero_sized_renderable'
  | 'layout_constraint_compressed'
  | 'descendant_outside_computed_parent';

export type LayoutLintIssue = Extract<QualityDiagnosticDraft, { code: LayoutLintCode }>;

export interface LayoutLintReport {
  issueCount: number;
  issues: LayoutLintIssue[];
}

function mergeParagraphMetadata(
  paragraphs: SlideElementParagraphInfo[],
): TextMeasureInput['paragraphs'] {
  return paragraphs.map((paragraph) => ({
    text: paragraph.runs.map((run) => run.text).join(''),
    indentInches: paragraph.indentInches,
    spacingBeforePt: paragraph.spacingBeforePt,
    spacingAfterPt: paragraph.spacingAfterPt,
  }));
}

/**
 * 共享的 lint-info 文本测量输入构造器。
 *
 * 仅服务尚未携带最终 TextLayoutResult 的 imported PresentationInfo。generated
 * RenderModel 质量链直接消费 layout.overflow，不再走这条压扁测量路径。
 */
export function buildLintTextMeasurementInput(
  element: SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> },
): TextMeasureInput {
  const fontSizePt = element.textStyle?.fontSize ?? element.fontSize ?? 10;
  const wrap = element.textBody?.wrap === 'none' ? 'none' : 'word';
  const paragraphs = element.paragraphs != null && element.paragraphs.length > 0
    ? mergeParagraphMetadata(element.paragraphs)
    : element.text?.split('\n').map((line) => ({ text: line })) ?? [{ text: '' }];

  return {
    paragraphs,
    style: {
      fontFamily: element.textStyle?.fontFamily,
      fontSizePt,
      bold: element.textStyle?.bold,
      italic: element.textStyle?.italic,
      lineHeightMultiplier: resolveLintLineHeightMultiplier(element.paragraphs, fontSizePt),
    },
    box: {
      widthInches: element.position.w,
      heightInches: element.position.h,
      wrap,
      padding: element.textBody?.padding,
    },
    sourceKind: 'imported',
  };
}

function resolveLintLineHeightMultiplier(
  paragraphs: readonly SlideElementParagraphInfo[] | undefined,
  fontSizePt: number,
): number {
  const spacing = paragraphs?.[0]?.lineSpacing;
  if (!spacing) return DEFAULT_TEXT_LINE_SPACING_MULTIPLE;
  return spacing.kind === 'multiple' ? spacing.value : spacing.value / fontSizePt;
}

export class LayoutLint {
  lint(info: PresentationInfo): LayoutLintReport {
    const issues: LayoutLintIssue[] = [];

    for (const slide of info.slides) {
      const elements = flattenSlideElements(slide.elements).filter(
        (element): element is SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> } =>
          Boolean(element.position),
      );

      for (const element of elements) {
        issues.push(...this.lintBounds(slide.number, info.slideSize, element));
      }

      issues.push(...lintGeneratedLayoutConstraints(slide.number, elements));

      // 文本与 shape 内嵌文本共用最终布局事实；这里不重新测量或改变断行语义。
      const textElements = elements.filter((element) => element.text);
      issues.push(...this.lintTextLayout(slide.number, textElements));
      issues.push(...this.lintTableCellTextLayout(
        slide.number,
        elements.filter((element) => element.type === 'table' && element.tableInfo != null),
      ));
      issues.push(...this.lintTextDecorationCollisions(slide.number, elements));

      issues.push(...this.lintOverlaps(slide.number, elements));
      issues.push(...this.lintOriginStacking(slide.number, elements));
    }

    return {
      issueCount: issues.length,
      issues,
    };
  }

  private lintBounds(
    slideNumber: number,
    slideSize: { width: number; height: number },
    element: SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> },
  ): LayoutLintIssue[] {
    const issues: LayoutLintIssue[] = [];
    const { x, y, w, h } = element.position;
    const node = buildDiagnosticNodeRef(element);
    const referenceBox = {
      x: 0,
      y: 0,
      w: slideSize.width,
      h: slideSize.height,
      unit: 'in' as const,
    };
    const margins = {
      left: x,
      right: slideSize.width - (x + w),
      top: y,
      bottom: slideSize.height - (y + h),
    };

    const zeroAxes: Array<'horizontal' | 'vertical'> = [];
    if (w <= 0.001) zeroAxes.push('horizontal');
    if (h <= 0.001) zeroAxes.push('vertical');
    if (zeroAxes.length > 0 && element.type !== 'other') {
      issues.push({
        code: 'zero_sized_renderable',
        severity: 'warning',
        confidence: 'high',
        slides: [slideNumber],
        evidence: {
          kind: 'node_size',
          node,
          zeroAxes,
          renderableBasis: toRenderableBasis(element.type),
          thresholdInches: 0.001,
        },
      });
    }

    if (x < 0 || y < 0 || x + w > slideSize.width || y + h > slideSize.height) {
      const violatedSides: Array<'left' | 'right' | 'top' | 'bottom'> = [];
      if (x < 0) violatedSides.push('left');
      if (x + w > slideSize.width) violatedSides.push('right');
      if (y < 0) violatedSides.push('top');
      if (y + h > slideSize.height) violatedSides.push('bottom');

      issues.push({
        code: 'out_of_bounds',
        severity: 'warning',
        confidence: 'high',
        slides: [slideNumber],
        evidence: {
          kind: 'node_bounds',
          assessment: 'overflow',
          node,
          referenceBox,
          margins,
          violatedSides,
          thresholdInches: 0,
          policyId: 'slide_bounds',
          fullBleedAxes: [],
        },
      });
    }

    return issues;
  }

  /**
   * Overlap 检测：**唯一真值源是 `SpatialSemantics.classifyOverlap`**。
   * 历史上 LayoutLint 私有了一份与之几乎重复的 `isIntentionalContainerOverlap`
   * 实现，因 element-type 来源不一致（PresentationInfo vs SpatialNode）导致
   * 两者结果偶发分歧（如 KPI 卡 bg 包 lbl 时 LayoutLint 认为不 contain、
   * SpatialSemantics 认为 container），从而产生“空间关系已标为 container，
   * findings 却仍提示 element_overlap”的撕裂体验。
   *
   * 现在统一走 `classifyOverlap`：
   *   - `'background'` / `'container'` / `'decorative'` / `'overlay'` / `'none'`
   *     → 视为有明确空间语义，跳过
   *   - `'forbidden'` 且占较小元素面积 > 35% → 产出 issue 并把分类挂到
   *     `issue.overlapType`，下游 findings 直接消费
   */
  private lintOverlaps(
    slideNumber: number,
    elements: Array<SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> }>,
  ): LayoutLintIssue[] {
    const issues: LayoutLintIssue[] = [];
    const spatialElements = annotateLineNodeSemantics(elements.map((element) => ({
      nodeId: element.nodeId ?? element.elementId,
      parentNodeId: element.parentNodeId,
      kind: element.type,
      box: element.position,
      zIndex: element.zIndex,
      opacity: element.opacity,
      semanticRole: element.semanticRole,
    })));
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const left = elements[i];
        const right = elements[j];
        if (left.type === 'group' || right.type === 'group') continue;

        const overlapClass = classifyOverlap(spatialElements[i], spatialElements[j]);
        if (overlapClass !== 'forbidden') continue;

        const smallerCoveredRatio = smallerBoxCoveredRatio(left.position, right.position);

        if (smallerCoveredRatio > 0.35) {
          const overlapBox = intersectionBox(left.position, right.position);
          if (!overlapBox) continue;
          const orderedNodes = [
            buildDiagnosticNodeRef(left),
            buildDiagnosticNodeRef(right),
          ].sort((first, second) => first.nodeId.localeCompare(second.nodeId));
          const firstNode = orderedNodes[0];
          const secondNode = orderedNodes[1];
          if (!firstNode || !secondNode || firstNode.nodeId === secondNode.nodeId) continue;
          issues.push({
            code: 'element_overlap',
            severity: 'warning',
            confidence: 'medium',
            slides: [slideNumber],
            evidence: {
              kind: 'node_overlap',
              nodes: [firstNode, secondNode],
              intersection: { ...overlapBox, unit: 'in' },
              smallerCoveredRatio,
              overlapClass: 'forbidden',
              intent: {
                assessment: 'unknown',
                signals: ['两个独立元素大面积相交，需要结合最终渲染确认设计意图。'],
              },
            },
          });
        }
      }
    }
    return issues;
  }

  private lintTextLayout(
    slideNumber: number,
    elements: Array<SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> }>,
  ): LayoutLintIssue[] {
    const issues: LayoutLintIssue[] = [];
    for (const element of elements) {
      const text = element.text?.trim();
      if (!text) continue;

      if (element.textLayout) {
        issues.push(...lintFinalizedTextLayout({
          slideNumber,
          element,
          text,
          paragraphs: element.paragraphs ?? [],
          layout: element.textLayout,
          contentWidthInches: resolveFinalTextContentWidth(element),
        }));
        continue;
      }

      const autoFit = element.textBody?.autoFit;
      if (autoFit === 'shrink-text' || autoFit === 'resize-shape') {
        continue;
      }

      const measurementInput = buildLintTextMeasurementInput(element);
      const measurement = defaultTextMeasureService.measure(measurementInput);
      const widthOverflow = measurement.fitsWidth === false;
      const heightOverflow = measurement.fitsHeight === false;

      if (widthOverflow || heightOverflow) {
        issues.push({
          code: 'text_overflow_risk',
          severity: 'warning',
          confidence: 'medium',
          slides: [slideNumber],
          evidence: {
            kind: 'text_layout',
            issue: 'overflow',
            node: buildDiagnosticNodeRef(element),
            textPreview: abbreviateText(text),
            basis: 'estimated',
            actualLineCount: Math.max(1, measurement.lineCount),
            contentWidthInches: element.position.w,
            contentHeightInches: measurement.contentHeightInches,
            maxLineWidthInches: measurement.maxLineWidthInches,
            horizontalOverflow: widthOverflow,
            verticalOverflow: heightOverflow,
            hiddenLineCount: 0,
          },
        });
      }
    }
    return issues;
  }

  private lintTableCellTextLayout(
    slideNumber: number,
    tables: Array<SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> }>,
  ): LayoutLintIssue[] {
    return tables.flatMap((table) => table.tableInfo?.cells.flatMap((cell) => {
      const text = cell.text?.trim();
      if (!text || !cell.textLayout) return [];
      return lintFinalizedTextLayout({
        slideNumber,
        element: table,
        text,
        paragraphs: cell.paragraphs,
        layout: cell.textLayout,
        contentWidthInches: resolveTableCellContentWidth(cell),
        tableCell: {
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
        },
      });
    }) ?? []);
  }

  private lintTextDecorationCollisions(
    slideNumber: number,
    elements: Array<SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> }>,
  ): LayoutLintIssue[] {
    const decorations = elements.filter((element) => (
      element.type === 'shape'
      && isThinDecorativeShape(element.position)
      && Math.max(element.position.w, element.position.h) >= 0.3
    ));
    const textElements = elements.filter((element) => (
      Boolean(element.text?.trim()) && element.textLayout != null
    ));
    const issues: LayoutLintIssue[] = [];

    for (const decoration of decorations) {
      for (const textElement of textElements) {
        if ((decoration.nodeId ?? decoration.elementId) === (textElement.nodeId ?? textElement.elementId)) {
          continue;
        }
        const collision = buildFinalTextLineOccupancies(textElement)
          .map((line) => ({ line, intersection: intersectionBox(decoration.position, line.box) }))
          .find((entry) => entry.intersection != null);
        if (!collision?.intersection) continue;

        const orderedNodes = [
          buildDiagnosticNodeRef(decoration),
          buildDiagnosticNodeRef(textElement),
        ].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
        const first = orderedNodes[0];
        const second = orderedNodes[1];
        if (!first || !second || first.nodeId === second.nodeId) continue;
        issues.push({
          code: 'text_decoration_collision',
          severity: 'warning',
          confidence: 'high',
          slides: [slideNumber],
          evidence: {
            kind: 'node_overlap',
            nodes: [first, second],
            intersection: { ...collision.intersection, unit: 'in' },
            smallerCoveredRatio: smallerBoxCoveredRatio(decoration.position, collision.line.box),
            overlapClass: 'forbidden',
            intent: {
              assessment: 'likely_unintentional',
              signals: [
                `细装饰形状与最终排版文字行相交（paragraph=${collision.line.paragraphIndex}, line=${collision.line.lineIndex}）。`,
              ],
            },
          },
        });
      }
    }
    return issues;
  }

  /**
   * 检测多个非装饰性元素堆叠在同一锚点的异常。
   * 当 ≥3 个实质性元素共享同一 (x,y)（0.02" 容差）时，
   * 极大概率是绝对定位属性未生效导致的布局故障。
   *
   * 这种情况是 forbidden 的特化形式（且比普通 overlap 更可能是定位故障），
   * 作为独立的 origin_stacking relation 输出，避免与普通 pair overlap 混淆。
   */
  private lintOriginStacking(
    slideNumber: number,
    elements: Array<SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> }>,
  ): LayoutLintIssue[] {
    const SNAP = 0.02;
    const MIN_STACK_COUNT = 3;

    // 只考虑有实质面积的元素，排除装饰性窄条
    const substantive = elements.filter((el) => !isThinDecorativeShape(el.position));
    if (substantive.length < MIN_STACK_COUNT) return [];

    // 按量化后的 (x, y) 分组
    const buckets = new Map<string, typeof substantive>();
    for (const el of substantive) {
      const key = `${Math.round(el.position.x / SNAP) * SNAP},${Math.round(el.position.y / SNAP) * SNAP}`;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key, list); }
      list.push(el);
    }

    const issues: LayoutLintIssue[] = [];
    for (const [anchor, group] of buckets) {
      if (group.length < MIN_STACK_COUNT) continue;
      const [anchorX, anchorY] = anchor.split(',').map(Number);
      if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) continue;
      issues.push({
        code: 'origin_stacking',
        severity: 'warning',
        confidence: 'high',
        slides: [slideNumber],
        evidence: {
          kind: 'origin_stacking',
          anchor: { x: anchorX, y: anchorY, unit: 'in' },
          toleranceInches: SNAP,
          nodes: group.map(buildDiagnosticNodeRef),
          intent: {
            assessment: 'likely_unintentional',
            signals: ['三个或更多实质元素共用同一锚点，通常表示定位约束没有生效。'],
          },
        },
      });
    }
    return issues;
  }

}

interface FinalizedTextLayoutLintInput {
  readonly slideNumber: number;
  readonly element: SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> };
  readonly text: string;
  readonly paragraphs: readonly SlideElementParagraphInfo[];
  readonly layout: TextLayoutResult;
  readonly contentWidthInches: number;
  readonly tableCell?: {
    readonly rowIndex: number;
    readonly columnIndex: number;
  };
}

function lintFinalizedTextLayout(input: FinalizedTextLayoutLintInput): LayoutLintIssue[] {
  const issues: LayoutLintIssue[] = [];
  const actualLineCount = countRenderedTextLines(input.layout);
  const node = buildDiagnosticNodeRef(input.element);
  const maxLineWidthInches = Math.max(0, ...input.layout.lines.map((line) => line.width));
  const tableCell = input.tableCell == null ? {} : { tableCell: input.tableCell };
  const commonEvidence = {
    kind: 'text_layout' as const,
    node,
    basis: 'finalized' as const,
    actualLineCount,
    contentWidthInches: input.contentWidthInches,
    contentHeightInches: input.layout.contentHeightInches,
    maxLineWidthInches,
    horizontalOverflow: input.layout.overflow.horizontal,
    verticalOverflow: input.layout.overflow.vertical,
    hiddenLineCount: input.layout.overflow.hiddenLineCount,
    ...tableCell,
  };

  if (/^\d{2,}$/.test(input.text) && actualLineCount > 1) {
    issues.push({
      code: 'short_numeric_text_wrapped',
      severity: 'warning',
      confidence: 'high',
      slides: [input.slideNumber],
      evidence: {
        ...commonEvidence,
        issue: 'short_numeric_wrap',
        textPreview: input.text,
      },
    });
  }

  const hasOverflow = input.layout.overflow.horizontal || input.layout.overflow.vertical;
  if (hasOverflow) {
    issues.push({
      code: 'text_overflow_risk',
      severity: 'warning',
      confidence: 'high',
      slides: [input.slideNumber],
      evidence: {
        ...commonEvidence,
        issue: 'overflow',
        textPreview: abbreviateText(input.text),
      },
    });
  }

  if (!hasOverflow && !/^\d{2,}$/.test(input.text)) {
    for (const orphan of findSingleGlyphLastLines(input.paragraphs, input.layout)) {
      issues.push({
        code: 'text_single_glyph_last_line',
        severity: 'warning',
        confidence: 'medium',
        slides: [input.slideNumber],
        evidence: {
          ...commonEvidence,
          issue: 'single_glyph_last_line',
          textPreview: abbreviateText(input.text),
          actualLineCount: orphan.paragraphLineCount,
          paragraphIndex: orphan.paragraphIndex,
          orphanText: orphan.orphanText,
        },
      });
    }
  }

  return issues;
}

interface SingleGlyphLastLine {
  readonly paragraphIndex: number;
  readonly paragraphLineCount: number;
  readonly orphanText: string;
}

function findSingleGlyphLastLines(
  paragraphs: readonly SlideElementParagraphInfo[],
  layout: TextLayoutResult,
): SingleGlyphLastLine[] {
  return paragraphs.flatMap((paragraph, paragraphIndex) => {
    const sourceText = paragraph.runs.map((run) => run.text).join('');
    if (sourceText.includes('\n') || countVisibleGraphemes(sourceText) < 3) return [];

    const paragraphLines = layout.lines.filter((line) =>
      line.paragraphIndex === paragraphIndex && visibleLineText(line).length > 0);
    if (paragraphLines.length < 2) return [];

    const orphanText = visibleLineText(paragraphLines[paragraphLines.length - 1]!);
    const orphanClusters = segmentClusters(orphanText).filter((cluster) =>
      !cluster.isForcedBreak && !cluster.isWhitespace);
    if (orphanClusters.length !== 1 || !/[\p{L}\p{N}]/u.test(orphanClusters[0]!.text)) {
      return [];
    }
    return [{
      paragraphIndex,
      paragraphLineCount: paragraphLines.length,
      orphanText: orphanClusters[0]!.text,
    }];
  });
}

function visibleLineText(line: TextLayoutResult['lines'][number]): string {
  return line.slices
    .filter((slice) => slice.kind !== 'inlineBox' && slice.isBulletMarker !== true)
    .map((slice) => slice.kind === 'inlineBox' ? '' : slice.text)
    .join('')
    .trim();
}

function countVisibleGraphemes(text: string): number {
  return segmentClusters(text).filter((cluster) =>
    !cluster.isForcedBreak && !cluster.isWhitespace).length;
}

/** finalized layout 的行宽相对于去除左右 padding 后的内容区，而不是外框宽度。 */
function resolveFinalTextContentWidth(
  element: SlideElementInfo & { position: NonNullable<SlideElementInfo['position']> },
): number {
  const padding = element.textBody?.padding;
  return Number(Math.max(
    element.position.w - (padding?.left ?? 0) - (padding?.right ?? 0),
    0,
  ).toFixed(6));
}

function resolveTableCellContentWidth(cell: SlideElementTableCellTextInfo): number {
  return Number(Math.max(
    cell.position.w - cell.padding.left - cell.padding.right,
    0,
  ).toFixed(6));
}

function countRenderedTextLines(layout: NonNullable<SlideElementInfo['textLayout']>): number {
  return layout.lines.filter((line) => line.slices.some(
    (slice) => slice.kind === 'inlineBox'
      || (slice.isBulletMarker !== true && slice.text.length > 0),
  )).length;
}

function abbreviateText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= 40 ? normalized : `${normalized.slice(0, 39)}…`;
}

function toRenderableBasis(
  type: SlideElementInfo['type'],
): 'text' | 'image' | 'shape' | 'chart' | 'table' | 'svg' | 'group' {
  switch (type) {
    case 'text':
    case 'image':
    case 'shape':
    case 'chart':
    case 'table':
    case 'group':
      return type;
    case 'svgGraphic':
      return 'svg';
    case 'formula':
      return 'svg';
    case 'other':
      throw new Error('Non-renderable element cannot produce zero-sized renderable evidence');
  }
}
