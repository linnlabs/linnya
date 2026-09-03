/**
 * RenderModel → PresentationInfo 映射
 *
 * 将 PresentationRenderModel（Konva 渲染层数据源）
 * 转换为 LayoutLint / AestheticLint 可消费的 PresentationInfo 格式。
 *
 * 目的：保证所有 lint 检查使用与 ppt_inspect 展示给 AI 的完全相同的坐标，
 * 避免 PPTX assemble → parse 往返导致的坐标偏差。
 */

import type {
  PresentationInfo,
  PresentationRenderModel,
  RenderPadding,
  RenderNode,
  RenderParagraph,
  ShapeRenderNode,
  SlideElementInfo,
  SlideElementParagraphInfo,
  SlideElementTableCellTextInfo,
} from '@plugin/slides/shared';
import {
  CHART_DEFAULT_LABEL_FONT_SIZE_PT,
  resolveTableCellLayouts,
  TABLE_DEFAULT_CELL_PADDING,
  visitRenderNodes,
} from '@plugin/slides/shared';

export function renderModelToLintInfo(model: PresentationRenderModel): PresentationInfo {
  return {
    slideCount: model.slides.length,
    slideSize: {
      width: model.slideSize.width,
      height: model.slideSize.height,
    },
    slides: model.slides.map((slide) => ({
      number: slide.index + 1,
      elements: renderNodesToElementInfo(slide.elements),
    })),
    /* lint 不依赖 theme / masters，给空值即可 */
    theme: { colors: {}, fonts: { major: '', minor: '' } },
    masters: [],
  };
}

function renderNodesToElementInfo(nodes: RenderNode[]): SlideElementInfo[] {
  const elements: SlideElementInfo[] = [];
  visitRenderNodes(nodes, ({ node, parent }) => {
    elements.push(renderNodeToElementInfo(node, parent?.id));
  });
  return elements;
}

function renderNodeToElementInfo(node: RenderNode, parentNodeId?: string): SlideElementInfo {
  const et = node.editableTarget;
  const info: SlideElementInfo = {
    name: et?.elementName ?? node.id,
    nodeId: node.id,
    parentNodeId,
    elementId: et?.elementId ?? et?.creationId ?? node.id,
    type: renderKindToElementType(node.kind),
    zIndex: node.zIndex,
    opacity: node.opacity,
    semanticRole: et?.semanticRole,
    layoutConstraintEvidence: node.layoutConstraintEvidence,
    position: {
      x: node.box.x,
      y: node.box.y,
      w: node.box.w,
      h: node.box.h,
    },
  };

  if (node.kind === 'text') {
    const textInfo = buildTextInfo(node.paragraphs, {
      wrap: node.wrap,
      autoFitPolicy: node.autoFitPolicy,
      padding: normalizeTextBodyPadding(node.padding),
      verticalAlign: node.verticalAlign,
    });
    Object.assign(info, textInfo);
    info.textLayout = node.layout;
    const textColor = extractFirstRunColor(node.paragraphs);
    if (textColor) info.textColor = textColor;
  }

  if (node.kind === 'shape') {
    const fillColor = extractSolidFill(node.fill);
    if (fillColor) info.fill = fillColor;
    /* shape 内嵌文本也需要文字溢出检测 */
    if (node.innerText) {
      const textInfo = buildTextInfo(node.innerText.paragraphs, {
        wrap: node.innerText.wrap,
        autoFitPolicy: node.innerText.autoFitPolicy,
        padding: normalizeTextBodyPadding(node.innerText.padding),
        verticalAlign: node.innerText.verticalAlign,
      });
      Object.assign(info, textInfo);
      info.textLayout = node.innerText.layout;
      const textColor = extractFirstRunColor(node.innerText.paragraphs);
      if (textColor) info.textColor = textColor;
    }
  }

  if (node.kind === 'image') {
    if (node.fitMode) info.imageFit = node.fitMode;
    if (node.naturalSize && node.naturalSize.width > 0 && node.naturalSize.height > 0) {
      info.imageNaturalAspect = node.naturalSize.width / node.naturalSize.height;
    }
  }

  if (node.kind === 'chart') {
    info.chartType = node.chartType;
    const categoryAxis = node.chartType === 'bar' ? node.axes?.y : node.axes?.x;
    const categoryAxisVisible = node.chartType === 'pie' || node.chartType === 'doughnut'
      ? false
      : node.chartType === 'radar' || categoryAxis?.visible !== false;
    info.chartInfo = {
      chartType: node.chartType,
      categoryLabels: [...node.categories],
      seriesNames: node.series.map((series) => series.name),
      legend: {
        visible: node.legend?.visible === true,
        position: node.legend?.position ?? 'right',
        fontSizePt: node.legend?.labelStyle?.fontSize
          ?? node.labelStyle?.fontSize
          ?? CHART_DEFAULT_LABEL_FONT_SIZE_PT,
      },
      dataLabels: {
        visible: node.dataLabels?.visible === true,
        position: node.dataLabels?.position ?? 'outside',
        fontSizePt: node.dataLabels?.labelStyle?.fontSize
          ?? node.labelStyle?.fontSize
          ?? CHART_DEFAULT_LABEL_FONT_SIZE_PT,
        includesCategoryName: node.dataLabels?.format == null,
      },
      categoryAxis: {
        visible: categoryAxisVisible,
        fontSizePt: categoryAxis?.labelStyle?.fontSize
          ?? node.labelStyle?.fontSize
          ?? CHART_DEFAULT_LABEL_FONT_SIZE_PT,
      },
    };
  }

  if (node.kind === 'table') {
    info.tableInfo = {
      cells: resolveTableCellLayouts(node).map((cellLayout) =>
        buildTableCellTextInfo(node.box.x, node.box.y, cellLayout)),
    };
  }

  return info;
}

function buildTableCellTextInfo(
  tableX: number,
  tableY: number,
  cellLayout: ReturnType<typeof resolveTableCellLayouts>[number],
): SlideElementTableCellTextInfo {
  const padding = cellLayout.cell.padding ?? TABLE_DEFAULT_CELL_PADDING;
  return {
    rowIndex: cellLayout.cell.row,
    columnIndex: cellLayout.cell.col,
    position: {
      x: tableX + cellLayout.x,
      y: tableY + cellLayout.y,
      w: cellLayout.width,
      h: cellLayout.height,
    },
    text: extractParagraphsPlainText(cellLayout.cell.paragraphs),
    paragraphs: mapParagraphs(cellLayout.cell.paragraphs),
    padding: {
      top: padding.top ?? 0,
      right: padding.right ?? 0,
      bottom: padding.bottom ?? 0,
      left: padding.left ?? 0,
    },
    textLayout: cellLayout.cell.textLayout,
  };
}

function extractSolidFill(fill: ShapeRenderNode['fill']): string | undefined {
  if (!fill || fill.type !== 'solid') return undefined;
  const color = fill.color?.trim();
  return color && color.length > 0 ? color : undefined;
}

function extractFirstRunColor(paragraphs: RenderParagraph[]): string | undefined {
  for (const p of paragraphs) {
    for (const run of p.runs) {
      if ('text' in run && run.color && run.color.trim().length > 0) return run.color.trim();
    }
  }
  return undefined;
}

function normalizeTextBodyPadding(
  padding: RenderPadding | undefined,
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (!padding) return undefined;
  return {
    top: padding.top ?? 0,
    right: padding.right ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
  };
}

function renderKindToElementType(kind: RenderNode['kind']): SlideElementInfo['type'] {
  switch (kind) {
    case 'text': return 'text';
    case 'shape': return 'shape';
    case 'image': return 'image';
    case 'svgGraphic': return 'svgGraphic';
    case 'formula': return 'formula';
    case 'table': return 'table';
    case 'chart': return 'chart';
    case 'group': return 'group';
    default: return 'other';
  }
}

function extractParagraphsPlainText(paragraphs: RenderParagraph[]): string | undefined {
  const text = paragraphs
    .map((paragraph) => paragraph.runs.map((run) => 'text' in run ? run.text : '').join(''))
    .join('\n');
  return text.trim() || undefined;
}

/** 取所有 run 中的最大字号（pt） */
function extractMaxFontSizePt(paragraphs: RenderParagraph[]): number | undefined {
  let max = -1;
  for (const p of paragraphs) {
    for (const run of p.runs) {
      if ('text' in run && run.fontSize != null && run.fontSize > max) {
        max = run.fontSize;
      }
    }
  }
  return max > 0 ? max : undefined;
}

function buildTextInfo(
  paragraphs: RenderParagraph[],
  options: {
    wrap?: 'word' | 'char' | 'none';
    autoFitPolicy?: 'none' | 'shrink-text' | 'resize-shape';
    padding?: { top: number; right: number; bottom: number; left: number };
    verticalAlign?: 'top' | 'middle' | 'bottom';
  },
): Pick<SlideElementInfo, 'text' | 'fontSize' | 'textStyle' | 'textBody' | 'paragraphs'> {
  const firstRun = paragraphs.flatMap((paragraph) => paragraph.runs).find((run) => 'text' in run);
  return {
    text: extractParagraphsPlainText(paragraphs),
    fontSize: extractMaxFontSizePt(paragraphs),
    textStyle: {
      fontFamily: firstRun?.fontFamily,
      fontSize: extractMaxFontSizePt(paragraphs),
      bold: firstRun?.fontWeight === 'bold',
      italic: firstRun?.fontStyle === 'italic',
    },
    textBody: {
      wrap: options.wrap === 'none' ? 'none' : 'word',
      autoFit: options.autoFitPolicy,
      verticalAlign: options.verticalAlign,
      padding: options.padding,
    },
    paragraphs: mapParagraphs(paragraphs),
  };
}

function mapParagraphs(paragraphs: readonly RenderParagraph[]): SlideElementParagraphInfo[] {
  return paragraphs.map((paragraph) => ({
    runs: paragraph.runs.flatMap((run) => 'text' in run ? [{
      text: run.text,
      fontFamily: run.fontFamily,
      resolvedFontFamily: run.resolvedFontFamily,
      fontScript: run.fontScript,
      fontResolution: run.fontResolution,
      resolvedBold: run.resolvedFontWeight == null
        ? undefined
        : run.resolvedFontWeight === 'bold',
      resolvedItalic: run.resolvedFontStyle == null
        ? undefined
        : run.resolvedFontStyle === 'italic',
      fontSize: run.fontSize,
      bold: run.fontWeight === 'bold',
      italic: run.fontStyle === 'italic',
    }] : []),
    align: paragraph.align,
    spacingBeforePt: paragraph.spacingBefore,
    spacingAfterPt: paragraph.spacingAfter,
    lineSpacing: paragraph.lineSpacing,
    lineSpacingResolution: paragraph.lineSpacingResolution,
    indentInches: paragraph.indent,
  }));
}
