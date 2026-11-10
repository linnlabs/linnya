import { expect, it } from 'vitest';
import { selectCanvasRasterCoverage } from '../selectCanvasRasterCoverage';
import { subtractCanvasRegions } from '../canvasVisibleRegions';

it('缩小复用已有清晰分片，放大仍补图，精确倍率不混用不同采样', () => {
  const resources = [{ x: 0, y: 0, width: 50, height: 100, scale: 2 }, { x: 50, y: 0, width: 50, height: 100, scale: 1 }];
  const frame = [{ x: 0, y: 0, width: 100, height: 100 }];
  expect(subtractCanvasRegions(frame, selectCanvasRasterCoverage(resources, { scale: 1, exact: false }))).toEqual([]);
  expect(subtractCanvasRegions(frame, selectCanvasRasterCoverage(resources, { scale: 2, exact: false }))).toEqual([{ x: 50, y: 0, width: 50, height: 100 }]);
  expect(subtractCanvasRegions(frame, selectCanvasRasterCoverage(resources, { scale: 1, exact: true }))).toEqual([{ x: 0, y: 0, width: 50, height: 100 }]);
  expect(selectCanvasRasterCoverage(resources, { scale: 3, exact: false })).toEqual([]);
});
