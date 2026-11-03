// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasEdgeSchema, type CanvasCommitResult, type CanvasCommand } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasConnectionEditing } from '../orchestration/createCanvasConnectionEditing';
import type { CanvasConnectionKernel } from '../definitions/canvasConnections';
const edge = CanvasEdgeSchema.parse({ id: 'e1', type: 'edge', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, from: { kind: 'point', x: 10, y: 20 }, to: { kind: 'point', x: 200, y: 20 }, direction: 'forward', lineStyle: 'curve', label: '原标签' });
async function fixture() {
  const editing = vi.fn(async () => {}), report = vi.fn(), commands: (readonly CanvasCommand[])[] = [];
  const commit = vi.fn(async (input: Parameters<CanvasDocumentPort['commit']>[0]): Promise<CanvasCommitResult> => { commands.push(input.operations); return { documentId: 'doc', requestId: input.requestId, sequence: 0, refs: {}, results: input.operations.map((_, index) => ({ index, status: 'applied', id: null, reason: null })) }; });
  const port: CanvasDocumentPort = { editing, commit, read: async () => ({ documentId: 'doc', schemaVersion: 1, sequence: 0, elements: [edge] }), changes: vi.fn(), undo: vi.fn(), close: async () => {}, subscribe: () => () => {} };
  const session = createCanvasDocumentSession(port); await session.open('doc');
  const kernel: CanvasConnectionKernel = { canvas: document.createElement('canvas'), screenToWorld: point => point, hitTest: () => null, visibleCards: () => [], readCamera: () => ({ x: 0, y: 0, zoom: 1 }), readEdgeGeometry: () => null, setHoveredCard: vi.fn(), setSelectedEdge: vi.fn() };
  const createText = vi.fn(async () => {});
  const connection = createCanvasConnectionEditing(session, kernel, { finishText: async () => true, createText, clearCards: vi.fn(), report });
  const target = document.createElement('button'), captured = new Set<number>(); document.body.append(target);
  target.setPointerCapture = id => { captured.add(id); }; target.releasePointerCapture = id => { captured.delete(id); }; target.hasPointerCapture = id => captured.has(id);
  const pointer = (type: string, x = 100, y = 200) => { const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y }); Object.defineProperty(event, 'pointerId', { value: 1 }); return event; };
  target.addEventListener('pointerdown', event => connection.start({ kind: 'reattach', event, from: edge.from, origin: { x: 10, y: 20 }, edge, field: 'to' }));
  return { connection, createText, session, editing, commit, commands, target, pointer, report, dispose: async () => { connection.dispose(); await session.close(); target.remove(); } };
}
afterEach(() => vi.useRealTimers());
it('连线标签保护续约，冲突保留草稿；取消释放字段不发旧修改', async () => {
  vi.useFakeTimers(); const f = await fixture(); await f.connection.select(edge.id); await f.connection.beginLabel();
  f.connection.state.updateLabel('新标签'); await vi.advanceTimersByTimeAsync(2100);
  expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: ['label'] }));
  f.commit.mockRejectedValueOnce(new Error('revision_conflict')); expect(await f.connection.saveLabel()).toBe(false);
  expect(f.connection.state.label.value?.value).toBe('新标签'); expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: 'revision_conflict' }));
  f.connection.cancelLabel(); await vi.advanceTimersByTimeAsync(0); expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [] })); await f.dispose();
});
it('拖端点冻结起始revision，Escape/失焦取消不提交，松手一次提交并释放保护', async () => {
  const f = await fixture(); f.target.dispatchEvent(f.pointer('pointerdown')); f.target.dispatchEvent(f.pointer('pointermove'));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); f.target.dispatchEvent(f.pointer('pointerup')); expect(f.commit).not.toHaveBeenCalled();
  f.target.dispatchEvent(f.pointer('pointerdown')); f.target.dispatchEvent(f.pointer('pointerup', 250, 130));
  await vi.waitFor(() => expect(f.commands).toHaveLength(1));
  expect(f.commands[0]).toEqual([{ op: 'update', id: edge.id, baseRevision: 1, patch: { to: { kind: 'point', x: 250, y: 130 } } }]);
  await vi.waitFor(() => expect(f.editing).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [] }))); await f.dispose();
});
it('新连线拖到空白只开启本地文字草稿，不提前写入历史', async () => {
  const f = await fixture();
  const target = f.target; target.addEventListener('pointerdown', event => f.connection.start({ kind: 'create', event, from: edge.from, origin: { x: 10, y: 20 } }));
  target.dispatchEvent(f.pointer('pointerdown')); target.dispatchEvent(f.pointer('pointerup', 80, 90));
  expect(f.createText).toHaveBeenCalledExactlyOnceWith({ x: 80, y: 90 }, edge.from); expect(f.commit).not.toHaveBeenCalled(); await f.dispose();
});

it('反转同一连线保留稳定ID和端点身份，定位查询不产生提交', async () => {
  const f = await fixture(); await f.connection.select(edge.id);
  expect(f.connection.endpoint('from')).toEqual(edge.from); expect(f.connection.endpoint('to')).toEqual(edge.to);
  expect(f.commit).not.toHaveBeenCalled();
  await f.connection.reverse();
  expect(f.commands).toEqual([[{ op: 'update', id: edge.id, baseRevision: edge.revision, patch: { from: edge.to, to: edge.from } }]]);
  await f.dispose();
});
