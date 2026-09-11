import type { ChartRenderNode } from '../../../types/render';

export interface ChartResourceIdentity {
  cacheKey: string;
  signature: string;
}

/**
 * 图表 PNG 只由尺寸、数据、视觉选项和像素比决定。位置、旋转、透明度由 Konva
 * 组合阶段处理，故不进入身份；同一图表移动后仍可复用已栅格化资源。
 */
export function createChartResourceIdentity(
  node: ChartRenderNode,
  pixelRatio: number,
): ChartResourceIdentity {
  const signature = stableSerialize({
    pixelRatio,
    width: node.box.w,
    height: node.box.h,
    chartType: node.chartType,
    categories: node.categories,
    series: node.series,
    palette: node.palette,
    plotBackgroundColor: node.plotBackgroundColor,
    seriesLineWidth: node.seriesLineWidth,
    axes: node.axes,
    legend: node.legend,
    dataLabels: node.dataLabels,
    gridlines: node.gridlines,
    stacking: node.stacking,
    labelStyle: node.labelStyle,
    pptxHints: node.pptxHints,
  });
  return {
    cacheKey: `chart:${hashFNV1a(signature)}`,
    signature,
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (!isUnknownRecord(value)) {
    return JSON.stringify(value) ?? 'undefined';
  }
  const record = value;
  const entries = Object.keys(record)
    .sort()
    .filter(key => record[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
  return `{${entries.join(',')}}`;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
