import { describe, expect, it } from 'vitest';
import { createCanvasCardMeasurement } from '../../../capabilities/cardMeasurement/createCanvasCardMeasurement';
import { createCanvasRenderRuntime } from '../orchestration/createCanvasRenderRuntime';
import { CanvasRenderRequestSchema, CanvasMeasureRequestSchema, CanvasMeasureBatchRequestSchema } from '../../../../shared/rendering';

const common = { protocol: 1, requestId: 'request-1', theme: 'light', dpr: 2, fontFamily: 'system-ui', fontSize: 16 };
const render = CanvasRenderRequestSchema.parse({ ...common, kind: 'render', width: 100, height: 100, region: null,
  snapshot: { schemaVersion: 1, documentId: 'doc', sequence: 7, elements: [] }, format: 'png', quality: 0.9, material: 'paper', assets: {}, documents: {} });

describe('background rendering boundary', () => {
  it('保留精确快照版本与图像字节，不接受另一张快照的出图', async () => {
    let sequence = 7;
    const runtime = createCanvasRenderRuntime({ invoke: async () => ({ status: 'rendered', requestId: 'request-1', sequence,
      width: 200, height: 200, format: 'png', dataUrl: 'data:image/png;base64,AQID' }) });
    expect(await runtime.render(render)).toMatchObject({ sequence: 7, bytes: new Uint8Array([1, 2, 3]), width: 200 });
    sequence = 8;
    await expect(runtime.render(render)).rejects.toMatchObject({ code: 'invalid_result' });
  });
  it('测量失败和中断不退回估算尺寸或启动另一次请求', async () => {
    const request = CanvasMeasureRequestSchema.parse({ ...common, kind: 'measure', width: 280, content: { type: 'doc', content: [] } });
    let calls = 0;
    const measurement = createCanvasCardMeasurement({ invoke: async () => { calls++; return { status: 'failure', requestId: 'request-1', code: 'render_failed', message: 'unavailable' }; } });
    await expect(measurement.measure(request)).rejects.toMatchObject({ code: 'render_failed' });
    const controller = new AbortController(); controller.abort();
    await expect(measurement.measure(request, controller.signal)).rejects.toBeDefined();
    expect(calls).toBe(1);
  });
  it('批量测高不把乱序结果赋给另一张新卡', async () => {
    const request = CanvasMeasureBatchRequestSchema.parse({ ...common, kind: 'measureBatch', cards: ['new-a', 'new-b'].map((ref) => ({
      ref, contentVersion: 1, width: 280, content: { type: 'doc', content: [] },
    })) });
    const measurement = createCanvasCardMeasurement({ invoke: async () => ({ status: 'measuredBatch', requestId: request.requestId,
      cards: [{ ref: 'new-b', width: 280, height: 80 }, { ref: 'new-a', width: 280, height: 40 }] }) });
    await expect(measurement.measureBatch(request)).rejects.toMatchObject({ code: 'invalid_result' });
  });
});
