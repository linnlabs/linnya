// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { CanvasCardSchema } from '../../../../shared';
import type { CardRasterRequest, CardRasterizer } from '../../../capabilities/textRasterization';
import { createCanvasCardRasterBatch } from '../orchestration/createCanvasCardRasterBatch';

it('同批一张媒体准备失败不阻塞其他正文，消费者DOM身份仍保留', async () => {
  const source = { kind: 'user', conversationId: null, runId: null };
  const card = (id: string) => CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
  const calls: CardRasterRequest[] = [];
  const rasterizer: CardRasterizer = {
    measure: async () => { throw new Error('single measurement not expected'); },
    measureBatch: async requests => requests.map(request => request.element.dataset.unavailable ? { status: 'rejected', reason: new Error('image_decode_failed') } : { status: 'fulfilled', value: 90 }),
    rasterize: async () => { throw new Error('single paint not expected'); }, dispose() {},
    rasterizeBatch: async requests => {
      calls.push(...requests);
      return requests.map(request => ({ bitmap: { width: 280, height: 180, close() {} }, width: request.width, height: request.height, contentHeight: 90 }));
    },
  };
  const execute = createCanvasCardRasterBatch({ rasterizer, createContent: async current => {
    if (current.id === 'c2') throw new Error('resource_unavailable');
    const element = document.createElement('div'); element.className = 'provider-owned'; element.textContent = '可见正文'; if (current.id === 'c3') element.dataset.unavailable = '1'; return element;
  } });
  const output = await execute(['c1', 'c2', 'c3'].map(id => ({ card: card(id), scale: 1, dark: false, regions: [{ x: 0, y: 0, width: 280, height: 180 }] })), new AbortController().signal);
  expect(output.map(result => result.kind)).toEqual(['ready', 'failed', 'failed']);
  expect(calls).toHaveLength(1); expect(calls[0].element.classList.contains('provider-owned')).toBe(true);
  expect(calls[0].element.textContent).toBe('可见正文');
});

it('自动适配卡高的小数舍入差不算截断，真正超出1px以上才画淡出', async () => {
  const source = { kind: 'user', conversationId: null, runId: null };
  const card = (id: string, height: number) => CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
  const painted: CardRasterRequest[] = [];
  const rasterizer: CardRasterizer = {
    measure: async () => { throw new Error('single measurement not expected'); },
    measureBatch: async requests => requests.map(() => ({ status: 'fulfilled', value: 118.34 })),
    rasterize: async () => { throw new Error('single paint not expected'); }, dispose() {},
    rasterizeBatch: async requests => {
      painted.push(...requests);
      return requests.map(request => ({ bitmap: { width: 280, height: 120, close() {} }, width: request.width, height: request.height, contentHeight: 118 }));
    },
  };
  const execute = createCanvasCardRasterBatch({ rasterizer, createContent: async () => document.createElement('div') });
  await execute([card('c1', 118.328), card('c2', 100)].map(current => ({ card: current, scale: 1, dark: false, regions: [{ x: 0, y: 0, width: 280, height: current.height }] })), new AbortController().signal);
  expect(painted.map(request => request.element.classList.contains('canvas-card-content-clipped'))).toEqual([false, true]);
});
