// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { createCanvasCardResize } from '../orchestration/createCanvasCardResize';

const card = CanvasTextCardSchema.parse({
  id: 'c1',
  type: 'text',
  schemaVersion: 1,
  revision: 1,
  order: 'a0',
  locked: false,
  color: 'white',
  createdBy: { kind: 'user', conversationId: null, runId: null },
  updatedBy: { kind: 'user', conversationId: null, runId: null },
  createdAt: 0,
  updatedAt: 0,
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  parentId: null,
  data: { contentVersion: 1, content: createCanvasPlainTextDocument('卡片') },
});
const pointer = (type: string, target: HTMLElement, clientX: number, clientY: number) => {
  const event = Object.assign(new Event(type), { pointerId: 1, button: 0, clientX, clientY });
  Object.defineProperty(event, 'currentTarget', { value: target });
  return event as unknown as PointerEvent;
};

it('松手后到新尺寸提交落地前一直保留预览外框，浮条、锚点与文档详情不先跳回旧外框', async () => {
  let settle: (() => void) | undefined;
  const session = {
    commit: vi.fn(
      () =>
        new Promise<void>(resolve => {
          settle = resolve;
        })
    ),
    protect: vi.fn(async () => {}),
  } as unknown as CanvasDocumentSession;
  const resize = createCanvasCardResize(session, vi.fn()),
    target = document.createElement('div'),
    display = { show: vi.fn(), clear: vi.fn() };
  Object.assign(target, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  resize.start(card, pointer('pointerdown', target, 0, 0), { edge: 'se', zoom: 1, display });
  target.dispatchEvent(pointer('pointermove', target, -60, -40));
  expect(resize.state.preview.value).toMatchObject({ width: 140, height: 60 });

  target.dispatchEvent(pointer('pointerup', target, -60, -40));
  expect(session.commit).toHaveBeenCalledOnce();
  expect(resize.state.preview.value).toMatchObject({ width: 140, height: 60 });
  expect(display.clear).not.toHaveBeenCalled();

  settle?.();
  await vi.waitFor(() => expect(display.clear).toHaveBeenCalledOnce());
  expect(resize.state.preview.value).toBeNull();
});
