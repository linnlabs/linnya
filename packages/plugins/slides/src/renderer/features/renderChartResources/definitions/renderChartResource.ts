import type { ChartRenderNode } from '../../../types/render';

/** ECharts 完成栅格化与浏览器解码后的图表资源。 */
export interface LoadedRenderChart {
  image: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
}

/** 单页图表资源以渲染节点 id 索引。 */
export interface SlideChartResourceTarget {
  key: string;
  node: ChartRenderNode;
}

export type SlideChartResourceMap = ReadonlyMap<string, LoadedRenderChart>;

export type ChartResourceFailureMode = 'omit' | 'reject';

export class RenderChartResourceError extends Error {
  public readonly targetKey: string;

  constructor(targetKey: string) {
    super(`Chart resource could not be rendered: ${targetKey}`);
    this.name = 'RenderChartResourceError';
    this.targetKey = targetKey;
  }
}
