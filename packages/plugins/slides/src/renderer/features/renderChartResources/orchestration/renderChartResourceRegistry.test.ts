// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { ChartRenderNode, SlideRenderModel } from '../../../types/render';
import { loadSlideChartResources } from './loadSlideChartResources';
import { createRenderChartResourceRegistry } from './renderChartResourceRegistry';

interface RenderLatch {
  resolve: (image: HTMLImageElement) => void;
  reject: (error: Error) => void;
}

function createChartNode(
  id: string,
  values: readonly number[] = [10, 20],
): ChartRenderNode {
  return {
    id,
    kind: 'chart',
    box: { x: 1, y: 1, w: 4, h: 2.5, unit: 'in' },
    zIndex: 0,
    chartType: 'line',
    categories: ['Q1', 'Q2'],
    series: [{ name: 'Revenue', values: [...values] }],
    palette: ['#4472C4'],
  };
}

function createSlide(node: ChartRenderNode): SlideRenderModel {
  return {
    slideId: `slide-${node.id}`,
    index: 0,
    layoutKey: 'structured',
    background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [node],
  };
}

function createDecodedImage(width = 800, height = 500): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperties(image, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  return image;
}

describe('renderChartResourceRegistry', () => {
  it('rerenders visual edits but reuses the resulting image when the chart only moves', async () => {
    const renderImage = vi.fn(async () => createDecodedImage());
    const registry = createRenderChartResourceRegistry({ renderImage });
    const node = createChartNode('editable-chart');
    await registry.load(node, 1);
    node.plotBackgroundColor = '#102030';
    await registry.load(node, 1);
    node.seriesLineWidth = 3;
    await registry.load(node, 1);
    node.series[0].lineDash = 'dash';
    const latest = await registry.load(node, 1);
    node.box.x += 2;
    expect(await registry.load(node, 1)).toBe(latest);
    expect(renderImage).toHaveBeenCalledTimes(4);
  });

  it('deduplicates the same chart raster across slide consumers and ignores placement-only changes', async () => {
    const latches: RenderLatch[] = [];
    const renderImage = vi.fn(() => new Promise<HTMLImageElement>((resolve, reject) => {
      latches.push({ resolve, reject });
    }));
    const registry = createRenderChartResourceRegistry({ renderImage });
    const firstNode = createChartNode('chart-a');
    const secondNode = { ...createChartNode('chart-b'), box: { ...firstNode.box, x: 6 } };

    const firstPending = loadSlideChartResources(createSlide(firstNode), {
      registry,
      pixelRatio: 2,
    });
    const secondPending = loadSlideChartResources(createSlide(secondNode), {
      registry,
      pixelRatio: 2,
    });
    await vi.waitFor(() => expect(latches).toHaveLength(1));
    latches[0]?.resolve(createDecodedImage());

    const [first, second] = await Promise.all([firstPending, secondPending]);
    expect(renderImage).toHaveBeenCalledTimes(1);
    expect(first.get('chart-a')).toBe(second.get('chart-b'));
  });

  it('aborting one page consumer does not cancel shared chart work needed by another consumer', async () => {
    const latches: RenderLatch[] = [];
    const renderImage = vi.fn(() => new Promise<HTMLImageElement>((resolve, reject) => {
      latches.push({ resolve, reject });
    }));
    const registry = createRenderChartResourceRegistry({ renderImage });
    const controller = new AbortController();
    const node = createChartNode('chart-shared');

    const cancelled = registry.load(node, 2, controller.signal);
    const active = registry.load(node, 2);
    await vi.waitFor(() => expect(latches).toHaveLength(1));
    controller.abort(new Error('slide changed'));
    latches[0]?.resolve(createDecodedImage());

    await expect(cancelled).rejects.toThrow('slide changed');
    await expect(active).resolves.toMatchObject({ naturalWidth: 800, naturalHeight: 500 });
    expect(renderImage).toHaveBeenCalledTimes(1);
  });

  it('treats changed chart data and changed pixel ratio as different render identities', async () => {
    const renderImage = vi.fn(async () => createDecodedImage());
    const registry = createRenderChartResourceRegistry({ renderImage });

    await registry.load(createChartNode('chart-a'), 1);
    await registry.load(createChartNode('chart-b'), 2);
    await registry.load(createChartNode('chart-c', [10, 30]), 1);

    expect(renderImage).toHaveBeenCalledTimes(3);
  });

  it('evicts least-recently-used decoded charts within the configured byte bound', async () => {
    const renderImage = vi.fn(async () => createDecodedImage(100, 100));
    const registry = createRenderChartResourceRegistry({
      maxEntries: 1,
      maxDecodedBytes: 100 * 100 * 4,
      renderImage,
    });

    await registry.load(createChartNode('chart-a'), 1);
    await registry.load(createChartNode('chart-b', [30, 40]), 1);
    await registry.load(createChartNode('chart-a'), 1);

    expect(renderImage).toHaveBeenCalledTimes(3);
    expect(registry.size).toBe(1);
    expect(registry.decodedBytes).toBe(100 * 100 * 4);
  });

  it('omits failed charts in interactive preview but rejects with a stable resource error for raster export', async () => {
    const registry = createRenderChartResourceRegistry({
      renderImage: async () => {
        throw new Error('chart runtime failed');
      },
    });
    const slide = createSlide(createChartNode('chart-failed'));

    await expect(loadSlideChartResources(slide, {
      registry,
      failureMode: 'omit',
    })).resolves.toEqual(new Map());
    await expect(loadSlideChartResources(slide, {
      registry,
      failureMode: 'reject',
    })).rejects.toMatchObject({
      name: 'RenderChartResourceError',
      targetKey: 'chart-failed',
    });
  });
});
