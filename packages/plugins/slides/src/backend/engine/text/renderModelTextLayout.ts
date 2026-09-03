import type {
  PresentationRenderModel,
  FontLineMetrics,
  FontMetricsProvider,
  RenderTextRun,
  RenderParagraph,
  RunAdvanceProvider,
  RunMeasureStyle,
  TextRenderNode,
} from '@plugin/slides/shared';
import {
  resolveTableCellLayouts,
  visitRenderNodes,
  TABLE_DEFAULT_CELL_PADDING,
} from '@plugin/slides/shared/renderModel';
import {
  layoutTextNode,
  resolveTextLayoutContract,
  resolveTextLayoutFontScaleCandidates,
  resolveTextLayoutContractFromNode,
  resizeTextBoxForAutoFit,
  segmentClusters,
} from '@plugin/slides/shared/textLayout';
import {
  defaultTextMeasureService,
  type ClusterAdvanceRequest,
  type PluginTextMeasureServicePort,
} from '@plugin/backend/textMeasurement';
import {
  collectRequiredGlyphCodePoints,
  resolveFont,
  type PluginFontMetadata,
  type PluginResolvedFont,
} from '@plugin/backend/fontResolution';

const DEFAULT_LAYOUT_FONT_FAMILY = 'Arial';
const DEFAULT_LAYOUT_FONT_SIZE_PT = 14;

type ClusterAdvanceMeasurePort = Pick<PluginTextMeasureServicePort, 'measureClusterAdvancesWithSource'>;

export function applyTextLayoutToRenderModel(
  renderModel: PresentationRenderModel,
  provider: RunAdvanceProvider = createTextMeasureRunAdvanceProvider(renderModel),
  fontMetricsProvider: FontMetricsProvider = createFontResolutionMetricsProvider(),
): PresentationRenderModel {
  const sourceKind = resolveLayoutSourceKind(renderModel);
  forEachTextNode(renderModel, (node, profile) => {
    const contract = resolveTextLayoutContractFromNode(node, {
      sourceKind,
      profile,
    });
    const layout = layoutTextNode({
      paragraphs: node.paragraphs,
      contract,
      defaultFontFamily: resolveDefaultFontFamily(node),
    }, provider, fontMetricsProvider);
    if (
      contract.autoFitPolicy === 'resize-shape'
      && layout.requiredHeightInches != null
    ) {
      node.box = resizeTextBoxForAutoFit(
        node.box,
        layout.requiredHeightInches,
        contract.verticalAlign,
      );
    }
    node.layout = layout;
  });
  for (const slide of renderModel.slides) {
    visitRenderNodes(slide.elements, ({ node }) => {
      if (node.kind !== 'table') return;
      for (const cellLayout of resolveTableCellLayouts(node)) {
        const cell = cellLayout.cell;
        const contract = resolveTextLayoutContract({
          profile: 'table-cell',
          sourceKind,
          box: {
            x: cellLayout.x,
            y: cellLayout.y,
            w: cellLayout.width,
            h: cellLayout.height,
          },
          paragraphs: cell.paragraphs,
          padding: cell.padding ?? TABLE_DEFAULT_CELL_PADDING,
          verticalAlign: cell.verticalAlign ?? 'middle',
          autoFitPolicy: 'shrink-text',
        });
        cell.textLayout = layoutTextNode({
          paragraphs: cell.paragraphs,
          contract,
          defaultFontFamily: resolveDefaultFontFamilyFromParagraphs(cell.paragraphs),
        }, provider, fontMetricsProvider);
      }
    });
  }
  return renderModel;
}

export async function prewarmTextLayoutForRenderModel(
  renderModel: PresentationRenderModel,
  service: PluginTextMeasureServicePort = defaultTextMeasureService,
): Promise<void> {
  const requests = collectClusterAdvanceRequestsForRenderModel(renderModel);
  await service.prewarmClusterAdvances(requests);
}

export function collectClusterAdvanceRequestsForRenderModel(
  renderModel: PresentationRenderModel,
): ClusterAdvanceRequest[] {
  const sourceKind = resolveLayoutSourceKind(renderModel);
  const requests: ClusterAdvanceRequest[] = [];
  forEachTextNode(renderModel, (node, profile) => {
    const contract = resolveTextLayoutContractFromNode(node, {
      sourceKind,
      profile,
    });
    collectParagraphRequests(
      requests,
      node.paragraphs,
      resolveDefaultFontFamily(node),
      resolveTextLayoutFontScaleCandidates(contract.autoFitPolicy, contract.profile),
      sourceKind,
      contract.overflow === 'ellipsis',
    );
  });
  for (const slide of renderModel.slides) {
    visitRenderNodes(slide.elements, ({ node }) => {
      if (node.kind !== 'table') return;
      for (const cell of node.cells) {
        collectParagraphRequests(
          requests,
          cell.paragraphs,
          resolveDefaultFontFamilyFromParagraphs(cell.paragraphs),
          resolveTextLayoutFontScaleCandidates('shrink-text', 'table-cell'),
          sourceKind,
          false,
        );
      }
    });
  }
  return requests;
}

function collectParagraphRequests(
  requests: ClusterAdvanceRequest[],
  paragraphs: readonly RenderParagraph[],
  defaultFontFamily: string,
  fontScales: readonly number[],
  sourceKind: ClusterAdvanceRequest['sourceKind'],
  includeEllipsis: boolean,
): void {
  for (const paragraph of paragraphs) {
    for (const run of paragraph.runs) {
      if (!('text' in run)) continue;
      const clusters = segmentClusters(run.text)
        .filter((cluster) => !cluster.isForcedBreak)
        .map((cluster) => cluster.text);
      if (clusters.length === 0) continue;
      for (const fontScale of fontScales) {
        requests.push({
          clusters,
          style: toTextMeasureStyle(run, defaultFontFamily, fontScale),
          sourceKind,
        });
        if (includeEllipsis) {
          requests.push({
            clusters: ['…'],
            style: toTextMeasureStyle(run, defaultFontFamily, fontScale),
            sourceKind,
          });
        }
      }
    }
  }
}

function createTextMeasureRunAdvanceProvider(
  renderModel: PresentationRenderModel,
  service: ClusterAdvanceMeasurePort = defaultTextMeasureService,
): RunAdvanceProvider {
  const sourceKind = resolveLayoutSourceKind(renderModel);
  return createTextMeasureRunAdvanceProviderForSourceKind(sourceKind, service);
}

export function createTextMeasureRunAdvanceProviderForSourceKind(
  sourceKind: ClusterAdvanceRequest['sourceKind'],
  service: ClusterAdvanceMeasurePort = defaultTextMeasureService,
): RunAdvanceProvider {
  return {
    getClusterAdvances(clusters, style) {
      return service.measureClusterAdvancesWithSource({
        clusters,
        style: {
          fontFamily: style.fontFamily,
          fontSizePt: style.fontSizePt,
          bold: style.bold,
          italic: style.italic,
          letterSpacingPt: style.letterSpacingPt,
        },
        sourceKind,
      });
    },
  };
}

function forEachTextNode(
  renderModel: PresentationRenderModel,
  visitor: (node: TextRenderNode, profile: 'plain-textbox' | 'shape-inner-text') => void,
): void {
  for (const slide of renderModel.slides) {
    visitRenderNodes(slide.elements, ({ node }) => {
      if (node.kind === 'text') {
        visitor(node, 'plain-textbox');
      }
      if (node.kind === 'shape' && node.innerText) {
        visitor(node.innerText, 'shape-inner-text');
      }
    });
  }
}

function resolveLayoutSourceKind(
  renderModel: PresentationRenderModel,
): ClusterAdvanceRequest['sourceKind'] {
  return renderModel.sourceKind === 'generated' ? 'generated' : 'imported';
}

function resolveDefaultFontFamily(node: TextRenderNode): string {
  return resolveDefaultFontFamilyFromParagraphs(node.paragraphs);
}

function resolveDefaultFontFamilyFromParagraphs(paragraphs: readonly RenderParagraph[]): string {
  const firstRun = paragraphs.flatMap((paragraph) => paragraph.runs).find((run) => 'text' in run);
  return firstRun?.resolvedFontFamily
    ?? firstRun?.fontFamily
    ?? DEFAULT_LAYOUT_FONT_FAMILY;
}

function toTextMeasureStyle(
  run: RenderTextRun,
  defaultFontFamily: string,
  fontScale: number,
): ClusterAdvanceRequest['style'] {
  return {
    fontFamily: run.resolvedFontFamily ?? run.fontFamily ?? defaultFontFamily,
    fontSizePt: (run.fontSize ?? DEFAULT_LAYOUT_FONT_SIZE_PT) * fontScale,
    bold: (run.resolvedFontWeight ?? run.fontWeight) === 'bold',
    italic: (run.resolvedFontStyle ?? run.fontStyle) === 'italic',
    letterSpacingPt: run.letterSpacing == null ? undefined : run.letterSpacing * fontScale,
  };
}

function createFontResolutionMetricsProvider(): FontMetricsProvider {
  return {
    getMetrics(style) {
      const resolved = resolveFont({
        family: style.fontFamily,
        bold: style.bold,
        italic: style.italic,
        script: style.script ?? 'latin',
        requiredCodePoints: style.text == null
          ? undefined
          : collectRequiredGlyphCodePoints(style.text),
      });
      if (!isResolvedCatalogFont(resolved)) {
        return undefined;
      }
      return fontMetadataToLineMetrics(resolved.resolved, style);
    },
  };
}

function isResolvedCatalogFont(
  resolved: PluginResolvedFont,
): resolved is PluginResolvedFont & { resolved: PluginFontMetadata } {
  return resolved.resolution === 'exact' || resolved.resolution === 'substituted';
}

export function fontMetadataToLineMetrics(
  metadata: PluginFontMetadata,
  style: RunMeasureStyle,
): FontLineMetrics {
  const emInches = style.fontSizePt / 72;
  const selected = metadata.useTypoMetrics
    ? {
        ascent: metadata.typoAscent,
        descent: Math.abs(metadata.typoDescent),
        lineGap: Math.max(metadata.typoLineGap, 0),
      }
    : {
        ascent: metadata.winAscent,
        descent: Math.abs(metadata.winDescent),
        lineGap: 0,
      };

  return {
    ascent: selected.ascent * emInches,
    descent: selected.descent * emInches,
    lineGap: selected.lineGap * emInches,
  };
}

export function createFakeRunAdvanceProviderForTests(
  advanceInches: number,
): RunAdvanceProvider {
  return {
    getClusterAdvances(clusters: readonly string[], _style: RunMeasureStyle) {
      return {
        advances: clusters.map(() => advanceInches),
        source: 'heuristic',
      };
    },
  };
}
