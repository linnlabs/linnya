import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
let temporary = '', workerPath = '', workerStarts = '';
beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'canvas-layout-test-')); workerPath = path.join(temporary, 'layout-worker.cjs');
  workerStarts = path.join(temporary, 'thread-starts');
  await build({ entryPoints: [fileURLToPath(new URL('../../../orchestration/canvasComputationWorker.ts', import.meta.url))], outfile: workerPath,
    bundle: true, platform: 'node', format: 'cjs', tsconfig: fileURLToPath(new URL('../../../../../tsconfig.json', import.meta.url)),
    banner: { js: `require('node:fs').appendFileSync(${JSON.stringify(workerStarts)}, 'started\\n');` } });
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

it('连续任务复用真实线程；运行中取消终止旧线程再执行下一快照', async () => {
  const runtime = createCanvasComputationRuntime({ workerPath });
  const readStarts = async () => (await readFile(workerStarts, 'utf8')).split('\n').filter(Boolean).length;
  try {
    await runtime.check(fixture(3)); const first = await readStarts();
    for (let sequence = 50; sequence < 54; sequence++) {
      const result = await runtime.check({ ...fixture(3), sequence }); expect(result.sequence).toBe(sequence);
    }
    expect(await readStarts()).toBe(first);
    const controller = new AbortController();
    const cancelled = runtime.layout({ requestId: 'cancel-warm', snapshot: fixture(12000), algorithm: 'layered', direction: 'right' }, controller.signal);
    const after = runtime.check({ ...fixture(3), sequence: 99 });
    controller.abort();
    await expect(cancelled).rejects.toBeDefined();
    expect((await after).sequence).toBe(99);
    expect(await readStarts()).toBe(first + 1);
  } finally { await runtime.dispose(); }
}, 15_000);
it('按分区排布：区内连线卡成行、无连线卡成格，分区收紧后按阅读顺序紧挨着，区外卡避开分区', async () => {
  const section = (index: number, x: number, y: number) => CanvasCardSchema.parse({ ...identity, id: `c${index}`, type: 'section', order: String(index).padStart(6, '0'),
    x, y, width: 360, height: 240, parentId: null, data: { title: `区${index}` } });
  const member = (index: number, parent: number, x: number, y: number) => CanvasCardSchema.parse({ ...card(index), x, y, parentId: `c${parent}` });
  const link = (index: number, from: number, to: number) => CanvasEdgeSchema.parse({ ...identity, id: `e${index}`, type: 'edge', lineStyle: 'curve', direction: 'forward', label: '',
    from: { kind: 'card', cardId: `c${from}`, side: 'auto' }, to: { kind: 'card', cardId: `c${to}`, side: 'auto' } });
  // 新增时的临时位置故意拉得很开：排布结果必须与它无关。
  const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'sections', sequence: 3, elements: [
    section(1, 0, 0), member(2, 1, 9000, 40), member(3, 1, 200, 8000), member(4, 1, -4000, 300), member(5, 1, 50, 50),
    section(6, 20000, 0), member(7, 6, 20100, 100), member(8, 6, 20400, 5000),
    card(9), link(1, 2, 3), link(2, 3, 4)] });
  const runtime = createCanvasComputationRuntime({ workerPath });
  try {
    const result = await runtime.layout({ requestId: 'sections', snapshot, algorithm: 'layered', direction: 'right' });
    const after = applyPositions(snapshot, result), at = (id: string) => after.find(element => element.id === id)!;
    const inside = (child: string, parent: string) => { const c = at(child), p = at(parent);
      return c.x >= p.x + 24 && c.y >= p.y + 48 && c.x + c.width <= p.x + p.width - 24 + 0.5 && c.y + c.height <= p.y + p.height - 24 + 0.5; };
    for (const [child, parent] of [['c2', 'c1'], ['c3', 'c1'], ['c4', 'c1'], ['c5', 'c1'], ['c7', 'c6'], ['c8', 'c6']]) expect(inside(child, parent), `${child} in ${parent}`).toBe(true);
    // 连成链的三张卡在同一行从左到右；无连线的 c5 排在链下方。
    expect(new Set(['c2', 'c3', 'c4'].map(id => at(id).y + at(id).height / 2)).size).toBe(1);
    expect(at('c2').x).toBeLessThan(at('c3').x); expect(at('c3').x).toBeLessThan(at('c4').x);
    expect(at('c5').y).toBeGreaterThan(Math.max(...['c2', 'c3', 'c4'].map(id => at(id).y + at(id).height)));
    // 分区收紧：成员外框加内边距正好是分区大小。
    const tight = (parent: string, members: string[]) => { const p = at(parent);
      expect(Math.min(...members.map(id => at(id).x))).toBeCloseTo(p.x + 24); expect(Math.max(...members.map(id => at(id).x + at(id).width))).toBeCloseTo(p.x + p.width - 24);
      expect(Math.min(...members.map(id => at(id).y))).toBeCloseTo(p.y + 48); expect(Math.max(...members.map(id => at(id).y + at(id).height))).toBeCloseTo(p.y + p.height - 24); };
    tight('c1', ['c2', 'c3', 'c4', 'c5']); tight('c6', ['c7', 'c8']);
    // 两区紧挨着：不重叠，间隔只有一道窄缝。
    const [a, b] = [at('c1'), at('c6')];
    expect(canvasRectanglesOverlap(a, b)).toBe(false);
    expect(Math.min(Math.abs(b.x - (a.x + a.width)), Math.abs(b.y - (a.y + a.height)))).toBeCloseTo(24);
    for (const id of ['c1', 'c6']) expect(canvasRectanglesOverlap(at('c9'), at(id))).toBe(false);
  } finally { await runtime.dispose(); }
});
