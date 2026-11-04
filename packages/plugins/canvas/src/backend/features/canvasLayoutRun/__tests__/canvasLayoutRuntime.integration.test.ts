import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasCardSchema, CanvasEdgeSchema, CanvasSnapshotSchema, canvasRectanglesOverlap, type CanvasCard, type CanvasLayoutResult, type CanvasSnapshot } from '../../../../shared';
import { createCanvasComputationRuntime } from '../../../capabilities/canvasComputation';

const source = { kind: 'user', conversationId: null, runId: null };
const identity = { schemaVersion: 1, revision: 7, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 };
const card = (index: number) => CanvasCardSchema.parse({ ...identity, id: `c${index}`, type: 'text', order: String(index).padStart(6, '0'), x: index * 10, y: index * 7,
  width: 120 + index % 3 * 30, height: 60 + index % 4 * 70, parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `真实测高事实 ${index}` }] }] } } });
function fixture(count: number): CanvasSnapshot {
  const cards = Array.from({ length: count }, (_, index) => card(index + 1));
  const edges = cards.slice(1).map((child, index) => CanvasEdgeSchema.parse({ ...identity, id: `e${index + 1}`, type: 'edge', lineStyle: 'curve', direction: 'forward', label: '',
    from: { kind: 'card', cardId: cards[index].id, side: 'auto' }, to: { kind: 'card', cardId: child.id, side: 'auto' } }));
  return CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'layout-test', sequence: 41, elements: [...cards, ...edges] });
}
let temporary = '', workerPath = '';
beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'canvas-layout-test-')); workerPath = path.join(temporary, 'layout-worker.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('../../../orchestration/canvasComputationWorker.ts', import.meta.url))], outfile: workerPath,
    bundle: true, platform: 'node', format: 'cjs', tsconfig: fileURLToPath(new URL('../../../../../tsconfig.json', import.meta.url)) });
});
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

function applyPositions(snapshot: CanvasSnapshot, result: CanvasLayoutResult): CanvasCard[] {
  return snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge').map(element => {
    const operation = result.operations.find(candidate => candidate.op === 'update' && candidate.id === element.id);
    return operation?.op === 'update' ? CanvasCardSchema.parse({ ...element, ...operation.patch }) : element;
  });
}
it('真实worker三种排布都使用尺寸事实，并保留未选中、锁定与正在编辑的卡', async () => {
  const original = fixture(8);
  original.elements[6].locked = true;
  const targets = original.elements.filter((element): element is CanvasCard => element.type !== 'edge').slice(0, 7).map(element => element.id);
  const runtime = createCanvasComputationRuntime({ workerPath });
  try {
    for (const algorithm of ['tree', 'grid', 'layered'] as const) {
      const result = await runtime.layout({ requestId: `scope-${algorithm}`, snapshot: original, algorithm, direction: 'right', elementIds: targets, protectedElementIds: ['c6'] });
      expect(result.sequence).toBe(41);
      expect(result.computation).toMatchObject({ requestId: `scope-${algorithm}`, origin: 'node-worker', sequence: 41, algorithm });
      expect(result.computation.executionMs).toBeGreaterThan(0);
      expect(result.operations.every(operation => operation.op === 'update' && operation.baseRevision === 7)).toBe(true);
      const after = applyPositions(original, result);
      for (const id of ['c6', 'c7', 'c8']) expect(after.find(element => element.id === id)).toEqual(original.elements.find(element => element.id === id));
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < after.length; j++) expect(canvasRectanglesOverlap(after[i], after[j])).toBe(false);
      expect(after.map(element => element.data)).toEqual(original.elements.filter((element): element is CanvasCard => element.type !== 'edge').map(element => element.data));
      expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('locked');
      expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('editing');
    }
  } finally { await runtime.dispose(); }
});
it('有环与多父节点时保留图事实，只选择先到的树父节点', async () => {
  const snapshot = fixture(3), cards = snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
  snapshot.elements.push(CanvasEdgeSchema.parse({ ...identity, id: 'e3', type: 'edge', lineStyle: 'curve', direction: 'forward', label: '保留环',
    from: { kind: 'card', cardId: cards[2].id, side: 'auto' }, to: { kind: 'card', cardId: cards[0].id, side: 'auto' } }));
  const runtime = createCanvasComputationRuntime({ workerPath });
  try {
    const result = await runtime.layout({ requestId: 'tree-41', snapshot, algorithm: 'tree', direction: 'down' });
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'cycle_or_multiple_parents')).toBe(true);
    expect(result.operations.every(operation => operation.op === 'update' && Object.keys(operation.patch).every(key => key === 'x' || key === 'y'))).toBe(true);
    expect(snapshot.elements.filter(element => element.type === 'edge')).toHaveLength(3);
  } finally { await runtime.dispose(); }
});
it('12000长链不耗尽调用栈；中断真实计算后下一请求保留自己的序号', async () => {
  const snapshot = fixture(12000), runtime = createCanvasComputationRuntime({ workerPath });
  try {
    const result = await runtime.layout({ requestId: 'tree-41', snapshot, algorithm: 'tree', direction: 'right' });
    expect(result.operations.length).toBeGreaterThanOrEqual(11999);
    const controller = new AbortController();
    const cancelled = runtime.layout({ requestId: 'cancel-41', snapshot, algorithm: 'layered', direction: 'right' }, controller.signal);
    controller.abort(); await expect(cancelled).rejects.toBeDefined();
    const next = await runtime.layout({ requestId: 'after-cancel-42', snapshot: { ...fixture(3), sequence: 42 }, algorithm: 'grid', direction: 'down' });
    expect(next.sequence).toBe(42); expect(next.computation.requestId).toBe('after-cancel-42'); expect(next.computation.sequence).toBe(42); expect(next.operations.length).toBeGreaterThan(0);
  } finally { await runtime.dispose(); }
}, 15000);
it('check经同一真实计算worker读取精确快照，报告重叠而不移动卡片', async () => {
  const snapshot = fixture(3), before = JSON.stringify(snapshot), runtime = createCanvasComputationRuntime({ workerPath });
  try {
    const result = await runtime.check(snapshot);
    expect(result.sequence).toBe(41); expect(result.cardCount).toBe(3); expect(result.edgeCount).toBe(2);
    expect(result.overlapCount).toBeGreaterThan(0); expect(result.overlaps.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).toBe(before);
  } finally { await runtime.dispose(); }
});
