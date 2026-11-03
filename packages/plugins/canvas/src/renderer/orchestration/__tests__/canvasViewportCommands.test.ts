// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { CanvasElementSchema, type CanvasCamera } from '@plugin/canvas/shared';
import { createCanvasViewportCommands } from '../createCanvasViewportCommands';
import { createCanvasDraftDiscard } from '../createCanvasDraftDiscard';
import { describeCanvasSelection } from '../../features/accessibility';
const identity = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0 };
it('搜索线标签可定位真实线几何并选择线，删除后的旧结果不会把视野重置', async () => {
  const edge = CanvasElementSchema.parse({ ...identity, id: 'e1', type: 'edge', from: { kind: 'point', x: 10, y: 20 }, to: { kind: 'point', x: 300, y: 80 }, direction: 'forward', lineStyle: 'straight', label: '证据' });
  let camera: CanvasCamera = { x: 0, y: 0, zoom: 1 }, elements = [edge]; const fit = vi.fn(), selectEdge = vi.fn(async () => {}), select = vi.fn(async () => {});
  const viewport = createCanvasViewportCommands({ kernel: { canvas: document.createElement('canvas'), fit, readCamera: () => camera, setCamera: value => { camera = value; }, readEdgeGeometry: () => ({ from: { x: 10, y: 20 }, to: { x: 300, y: 80 }, midpoint: { x: 155, y: 50 }, points: [{ x: 10, y: 20 }, { x: 300, y: 80 }], fromSide: null, toSide: null }) }, setCamera: () => {}, refresh: () => {}, cards: () => [], selected: () => [], elements: () => elements, select, selectEdge });
  await viewport.focusElements([edge.id]); expect(selectEdge).toHaveBeenCalledWith('e1'); expect(select).not.toHaveBeenCalled(); expect(fit).toHaveBeenCalledWith([{ x: 10, y: 20, width: 1, height: 1 }, { x: 300, y: 80, width: 1, height: 1 }]);
  elements = []; viewport.locate([edge.id]); expect(fit).toHaveBeenCalledOnce();
});
it('读屏摘要使用可访问文档标题与有界内容；保存中不能放弃草稿，确认后只清本地参与者', () => {
  const targetId = 'private-target-uuid';
  const card = CanvasElementSchema.parse({ ...identity, id: 'c1', type: 'document', x: 0, y: 0, width: 300, height: 200, parentId: null, data: { documentId: targetId } });
  const description = describeCanvasSelection([card], [card.id], new Map([[targetId, '项目资料']])); expect(description).toContain('文档卡：项目资料'); expect(description).not.toContain(targetId);
  let saving = true, generation: string | null = 'unsaved'; const discarded = vi.fn(() => { generation = null; }), changed = vi.fn(), focus = vi.fn();
  const discard = createCanvasDraftDiscard({ participants: [{ readGeneration: () => generation, discard: discarded }], saving: () => saving, changed, focus });
  expect(discard).toThrow('等待保存'); expect(discarded).not.toHaveBeenCalled(); saving = false; discard(); expect(discarded).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
});
