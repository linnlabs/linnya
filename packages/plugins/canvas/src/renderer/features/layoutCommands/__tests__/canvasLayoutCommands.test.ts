// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { CanvasCardIdSchema, CanvasElementSchema, type CanvasArrangeRequest, type CanvasArrangeResultSchema, type CanvasElement } from '@plugin/canvas/shared';
import type { z } from 'zod';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../canvasDocument';
import { createCanvasLayoutCommands, planCanvasTreeCreation, type CanvasArrangementPort } from '..';
import { readCanvasShortcut } from '../../accessibility/functions/readCanvasShortcut';
const identity = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0 };
const card = (id: string): CanvasElement => CanvasElementSchema.parse({ ...identity, id, type: 'text', x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
const edge = (id: string, from: string, to: string): CanvasElement => CanvasElementSchema.parse({ ...identity, id, type: 'edge', from: { kind: 'card', cardId: from, side: 'auto' }, to: { kind: 'card', cardId: to, side: 'auto' }, direction: 'forward', lineStyle: 'curve', label: '' });
async function fixture() {
  const port: CanvasDocumentPort = { read: async () => ({ schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [card('c1'), card('c2')] }), changes: async () => ({ kind: 'snapshot', snapshot: { schemaVersion: 1, documentId: 'doc', sequence: 1, elements: [card('c1'), card('c2')] } }), editing: async () => {}, commit: vi.fn(), undo: vi.fn(), close: async () => {}, subscribe: () => () => {} };
  const session = createCanvasDocumentSession(port); await session.open('doc');
  const result = (input: CanvasArrangeRequest): z.infer<typeof CanvasArrangeResultSchema> => ({ commit: { documentId: 'doc', requestId: input.requestId, sequence: 1, results: [], refs: {} }, diagnostics: [{ code: 'locked', elementIds: ['c2'], message: '锁定卡保持原位' }] });
  const arrange = vi.fn(async input => result(input)), cancel = vi.fn(async () => {});
  const arrangement: CanvasArrangementPort = { arrange, cancel }; return { session, arrange, cancel, result, layout: createCanvasLayoutCommands(session, arrangement) };
}
it('排布等待后台共同提交后同步，同一请求身份可取消，失败不会卡住后续动作', async () => {
  const f = await fixture(); await f.layout.run({ algorithm: 'tree', direction: 'right' });
  expect(f.session.state.snapshot.value?.sequence).toBe(1); expect(f.layout.state.diagnostics.value[0]?.code).toBe('locked');
  let reject!: (failure: Error) => void; f.arrange.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const running = f.layout.run({ algorithm: 'layered', direction: 'right' }); await vi.waitFor(() => expect(f.arrange).toHaveBeenCalledTimes(2)); const request = f.arrange.mock.calls[1]?.[0];
  await f.layout.cancel(); expect(f.cancel).toHaveBeenCalledWith({ documentId: 'doc', viewId: f.session.viewId, requestId: request?.requestId });
  reject(new Error('canvas_layout_cancelled')); await expect(running).rejects.toThrow('排布已取消'); await f.layout.flush(); expect(f.layout.state.busy.value).toBe(false);
  await f.layout.run({ algorithm: 'grid', direction: 'right' }); await f.session.close();
});
it('树创建使用关系父节点而非parentId，单个连通分量排布，多父同级创建明确拒绝', () => {
  const child = CanvasElementSchema.parse({ ...card('c2'), parentId: 'c99' }), elements = [card('c1'), child, card('c3'), edge('e1', 'c1', 'c2')];
  const plan = planCanvasTreeCreation(elements, [CanvasCardIdSchema.parse('c2')], 'sibling', 'right');
  expect(plan.from).toEqual({ kind: 'card', cardId: 'c1', side: 'right' }); expect(new Set(plan.options.elementIds)).toEqual(new Set(['c1', 'c2', '$created']));
  expect(() => planCanvasTreeCreation([...elements, edge('e2', 'c3', 'c2')], [CanvasCardIdSchema.parse('c2')], 'sibling', 'right')).toThrow('多个上级');
  expect(planCanvasTreeCreation(elements, [CanvasCardIdSchema.parse('c1')], 'sibling', 'down').from).toBeNull();
});
it('树快捷键只在未编辑时使用，中文组合与工具栏/搜索输入保留原生键盘行为', () => {
  expect(readCanvasShortcut(new KeyboardEvent('keydown', { key: 'Tab' }), false, true)).toBe('tree-child');
  expect(readCanvasShortcut(new KeyboardEvent('keydown', { key: 'Enter' }), false, true)).toBe('tree-sibling');
  expect(readCanvasShortcut(new KeyboardEvent('keydown', { key: 'Enter' }), true, true)).toBeNull();
  expect(readCanvasShortcut(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true }), false, true)).toBeNull();
  const button = document.createElement('button'); button.addEventListener('keydown', event => { expect(readCanvasShortcut(event, false, true)).toBeNull(); }); button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
});
