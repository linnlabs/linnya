import type { ChartRenderNode } from '../../../types/render';
import { SLIDES_RENDER_COLORS } from '../../../shared/constants';
import { logSlidesVerbose } from '../../../shared/diagnosticLogging';

export type {
  ChartFrame,
  ChartFrameOptions,
  ChartPoint,
  ChartValueRange,
  RadarPoint,
  SnappedRect,
} from '@plugin/slides/shared/render-geometry';
export {
  buildCartesianRange,
  buildChartFrame,
  buildClusterBarThickness,
  buildRadarPoints,
  CHART_GAP_WIDTH_RATIO,
  CHART_LABEL_FONT_FAMILY,
  CHART_LABEL_FONT_SIZE,
  isRadialChart,
  pointsToFlatArray,
  resolveChartPalette,
  resolveSeriesType,
  snapRect,
  snapStrokeCenter,
  valueToX,
  valueToY,
} from '@plugin/slides/shared/render-geometry';

export const CHART_AXIS_STROKE = SLIDES_RENDER_COLORS.chartAxisStroke;
export const CHART_LABEL_FILL = SLIDES_RENDER_COLORS.chartLabelFill;

const reportedChartPalettes = new Set<string>();

export function reportResolvedChartPalette(node: ChartRenderNode, palette: readonly string[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  const key = [
    node.id,
    node.chartType,
    node.palette?.join(',') ?? 'no-node-palette',
    palette.join(','),
    node.series.map((series) => `${series.name}:${series.color ?? 'palette'}`).join('|'),
  ].join('::');

  if (reportedChartPalettes.has(key)) {
    return;
  }
  reportedChartPalettes.add(key);

  logSlidesVerbose('Chart', 'resolved chart palette', {
    chartId: node.id,
    chartType: node.chartType,
    categories: node.categories,
    nodePalette: node.palette,
    resolvedPalette: palette,
    series: node.series.map((series, index) => ({
      name: series.name,
      explicitColor: series.color,
      resolvedColor: palette[index],
    })),
  });
}
