import type { ChartRenderNode } from '../../../types/render';
import { INCHES_TO_PX } from '../../../shared/constants';
import { mapChartNodeToEChartsOption } from '../../konvaPreview';
import { loadEChartsRuntime } from './runtime/loadEChartsRuntime';

export async function renderChartToImage(
  node: ChartRenderNode,
  pixelRatio: number,
): Promise<HTMLImageElement | null> {
  const width = Math.round(node.box.w * INCHES_TO_PX);
  const height = Math.round(node.box.h * INCHES_TO_PX);
  if (width <= 0 || height <= 0) return null;

  const echarts = await loadEChartsRuntime(node.chartType);
  const container = document.createElement('div');
  const chartInstance = echarts.init(container, undefined, {
    renderer: 'canvas',
    width,
    height,
  });

  try {
    chartInstance.setOption(mapChartNodeToEChartsOption(node), { notMerge: true });
    const dataUrl = chartInstance.getDataURL({
      type: 'png',
      pixelRatio,
      backgroundColor: 'transparent',
    });
    return await decodeChartImage(dataUrl, node.id);
  } finally {
    chartInstance.dispose();
    container.remove();
  }
}

async function decodeChartImage(source: string, nodeId: string): Promise<HTMLImageElement> {
  const image = new globalThis.Image();
  image.src = source;
  try {
    await image.decode();
    return image;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(`Failed to decode chart image for node ${nodeId}${detail}`);
  }
}
