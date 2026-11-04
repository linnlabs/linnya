// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { CanvasTextCardSchema, CanvasEdgeSchema, createCanvasPlainTextDocument, type CanvasCamera, type CanvasCard, type CanvasSnapshot, type CanvasArrangeRequest } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, type CanvasDocumentPort } from '../../features/canvasDocument';
import { createCanvasLayoutCommands, type CanvasArrangementPort } from '../../features/layoutCommands';
import { createCanvasTextCreation } from '../../features/textCreation';
import { createCanvasKeyboardHandler } from '../../features/accessibility';
import { createCanvasViewportCommands } from '../createCanvasViewportCommands';
import { createCanvasTreeCreation } from '../createCanvasTreeCreation';

const identity = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0 };
const card = (id: string, x: number, y: number) => CanvasTextCardSchema.parse({ ...identity, id, type: 'text', x, y, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument(id) } });
async function fixture() {
  const source = card('c1', 1500, 900), parent = card('c9', 1000, 900);
  const edge = CanvasEdgeSchema.parse({ ...identity, id: 'e1', type: 'edge', from: { kind: 'card', cardId: parent.id, side: 'auto' }, to: { kind: 'card', cardId: source.id, side: 'auto' }, direction: 'forward', lineStyle: 'curve', label: '' });
  let snapshot: CanvasSnapshot = { schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [source, parent, edge] };
  const commit = vi.fn<CanvasDocumentPort['commit']>(), undo = vi.fn<CanvasDocumentPort['undo']>();
  const port: CanvasDocumentPort = { read: async () => snapshot, changes: async () => ({ kind: 'snapshot', snapshot }), editing: async () => {}, commit, undo, close: async () => {}, subscribe: () => () => {} };
  const session = createCanvasDocumentSession(port); await session.open('doc');
  let camera: CanvasCamera = { x: 0, y: 0, zoom: 0.75 }, selected = [source.id];
  const cards = () => session.state.snapshot.value?.elements.filter((element): element is CanvasCard => element.type !== 'edge') ?? [];
  const canvas = document.createElement('canvas'); Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const viewport = createCanvasViewportCommands({ kernel: { canvas, fit: () => {}, readCamera: () => camera, setCamera: value => { camera = value; }, animateCamera: () => {}, finishTransitions: () => {}, readEdgeGeometry: () => null }, setCamera: () => {}, refresh: () => {}, cards, selected: () => [], elements: () => snapshot.elements, select: async () => true, selectEdge: async () => true });
  const arrange = vi.fn(async (request: CanvasArrangeRequest): ReturnType<CanvasArrangementPort['arrange']> => {
    const created = card('c2', 5000, 3000); snapshot = { ...snapshot, sequence: 1, elements: [...snapshot.elements, created] };
    return { diagnostics: [], computation: null, replayed: false, commit: { documentId: 'doc', requestId: request.requestId, sequence: 1, refs: { $created: created.id }, results: request.operations.map((operation, index) => ({ index, id: operation.op === 'connect' ? edge.id : created.id, status: 'applied', reason: null })) } };
  });
  const layout = createCanvasLayoutCommands(session, { arrange, cancel: async () => {} });
  const creation = createCanvasTextCreation(session, async id => { selected = [id]; viewport.reveal(id); }, (operations, historyGroupId, arrangement) => arrangement ? layout.run(arrangement, operations, historyGroupId) : session.commit(operations, historyGroupId));
  const createTree = createCanvasTreeCreation({ finish: () => creation.save(true), plan: kind => layout.planTree(selected, kind), create: async plan => creation.begin(plan.point, plan.from, '', plan.options), reveal: viewport.revealRectangle });
  const keydown = createCanvasKeyboardHandler({ isEditing: () => creation.state.draft.value !== null, treeMode: () => selected.length === 1, createTree, selection: () => selected, allIds: () => cards().map(value => value.id), zoomValue: () => camera.zoom,
    duplicate: async () => {}, undo: async () => {}, remove: async () => {}, edit: async () => {}, escape: async () => { await creation.save(true); }, select: async () => {}, fit: () => {}, zoom: () => {}, move: async () => {}, navigation: () => null });
  return { session, layout, creation, keydown, arrange, commit, undo, readCamera: () => camera, selected: () => selected };
}
function expectVisible(rectangle: { x: number; y: number; width: number; height: number }, camera: CanvasCamera) {
  expect(rectangle.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(28);
  expect(rectangle.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(28);
  expect((rectangle.x + rectangle.width) * camera.zoom + camera.x).toBeLessThanOrEqual(772);
  expect((rectangle.y + rectangle.height) * camera.zoom + camera.y).toBeLessThanOrEqual(572);
}
it.each(['Tab', 'Enter'])('%s 创建先显露本地输入，保存后显露后台最终排布位置，空草稿取消不写入', async key => {
  const f = await fixture();
  await f.keydown(new KeyboardEvent('keydown', { key }));
  const first = f.creation.state.draft.value; if (!first) throw new Error('Local creation did not start');
  expectVisible(first, f.readCamera()); expect(f.readCamera().zoom).toBe(0.75);
  await f.keydown(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(f.creation.state.draft.value).toBeNull(); expect(f.arrange).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled(); expect(f.undo).not.toHaveBeenCalled();
  await f.keydown(new KeyboardEvent('keydown', { key })); f.creation.update(createCanvasPlainTextDocument('输入后保存'));
  await f.keydown(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(f.arrange).toHaveBeenCalledOnce(); expect(f.arrange.mock.calls[0]?.[0].operations.map(operation => operation.op)).toEqual(['addText', 'connect']);
  expect(f.creation.state.draft.value).toBeNull(); expect(f.selected()).toEqual(['c2']); expectVisible(card('c2', 5000, 3000), f.readCamera()); expect(f.readCamera().zoom).toBe(0.75);
  expect(f.commit).not.toHaveBeenCalled(); expect(f.undo).not.toHaveBeenCalled(); await f.layout.dispose(); await f.session.close();
});
