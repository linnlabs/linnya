import type { CanvasRectangle } from '../../../shared';

function mergeAxis(regions: readonly CanvasRectangle[], axis: 'x' | 'y'): CanvasRectangle[] {
  const cross = axis === 'x' ? 'y' : 'x',
    span = axis === 'x' ? 'width' : 'height',
    crossSpan = axis === 'x' ? 'height' : 'width';
  const sorted = regions
    .slice()
    .sort((a, b) => a[cross] - b[cross] || a[crossSpan] - b[crossSpan] || a[axis] - b[axis]);
  const result: CanvasRectangle[] = [];
  for (const region of sorted) {
    const previous = result[result.length - 1];
    if (
      previous &&
      previous[cross] === region[cross] &&
      previous[crossSpan] === region[crossSpan] &&
      previous[axis] + previous[span] === region[axis]
    ) {
      result[result.length - 1] = {
        ...previous,
        [span]: region[axis] + region[span] - previous[axis],
      };
    } else result.push(region);
  }
  return result;
}

/** 世界格只是索引边界，不应把无实际遮挡的一张卡变成多份DOM/位图/GPU纹理。 */
export function mergeCanvasRegionFragments(regions: readonly CanvasRectangle[]): CanvasRectangle[] {
  let merged = regions.slice();
  for (;;) {
    const next = mergeAxis(mergeAxis(merged, 'x'), 'y');
    // 一次纵向合并可能露出新的横向相邻边；每轮必须减少块数，否则结束。
    if (next.length === merged.length) return next;
    merged = next;
  }
}
