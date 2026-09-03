import type { RenderChartType, RenderNode } from '../../../types/render';

const SUPPORTED_CHART_TYPES: ReadonlySet<RenderChartType> = new Set([
  'bar',
  'column',
  'line',
  'pie',
  'doughnut',
  'scatter',
  'area',
  'radar',
  'combo',
]);

export function isKonvaChartTypeSupported(chartType: RenderChartType): boolean {
  return SUPPORTED_CHART_TYPES.has(chartType);
}

export function isKonvaNodeSupported(node: RenderNode): boolean {
  switch (node.kind) {
    case 'text':
    case 'shape':
    case 'image':
    case 'svgGraphic':
    case 'formula':
    case 'table':
      return true;
    case 'chart':
      return isKonvaChartTypeSupported(node.chartType);
    case 'group':
      return node.children.every(isKonvaNodeSupported);
  }
}
