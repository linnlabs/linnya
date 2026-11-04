import { expect, it } from 'vitest';
import { CanvasMeasureBatchRequestSchema, CanvasMeasureRequestSchema, CanvasRenderRequestSchema } from '../definitions/canvasRendering';
import { canvasWorkerViewport } from '../functions/canvasWorkerViewport';

const common = { protocol: 1, requestId: 'viewport', dpr: 4, theme: 'light', fontFamily: 'system-ui', fontSize: 14 };
const content = { type: 'doc', content: [] };

it('长卡批量测高仅准备真实布局宽度，最高DPR仍保留非零视口', () => {
  const batch = CanvasMeasureBatchRequestSchema.parse({ ...common, kind: 'measureBatch', cards: [
    { ref: 'narrow', width: 1, contentVersion: 1, content }, { ref: 'wide', width: 4096, contentVersion: 1, content },
  ] });
  expect(canvasWorkerViewport(batch)).toEqual({ width: 16384, height: 256 });
  const tiny = CanvasMeasureRequestSchema.parse({ ...common, kind: 'measure', width: 0.01, content });
  expect(canvasWorkerViewport(tiny).width).toBe(4);
});

it('出图预算计量取整后的真实像素，不让分数DPR超过资源上限', () => {
  const request = { ...common, kind: 'render', snapshot: { schemaVersion: 1, documentId: 'canvas', sequence: 0, elements: [] },
    width: 4096, height: 4096, dpr: 1, region: null, format: 'png', quality: 1, material: 'paper' };
  const valid = CanvasRenderRequestSchema.parse(request);
  expect(canvasWorkerViewport(valid)).toEqual({ width: 4096, height: 4096 });
  expect(CanvasRenderRequestSchema.safeParse({ ...request, dpr: 1.00001 }).success).toBe(false);
});
