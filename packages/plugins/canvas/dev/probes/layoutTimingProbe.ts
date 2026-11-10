import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvasComputationRuntime } from '../../src/backend/capabilities/canvasComputation';
import { CanvasLayoutOptionsSchema, CanvasSnapshotSchema, type CanvasLayoutComputation } from '../../src/shared';

const { values } = parseArgs({ options: { count: { type: 'string', default: '300' }, samples: { type: 'string', default: '5' },
  algorithm: { type: 'string', default: 'layered' }, output: { type: 'string', default: '_dev_data/canvas-layout-timing/results.json' } } });
const count = Number(values.count), samples = Number(values.samples);
if (!Number.isInteger(count) || count < 1 || count > 12000 || !Number.isInteger(samples) || samples < 1 || samples > 100) throw new Error('Invalid probe count/samples');
const options = CanvasLayoutOptionsSchema.parse({ algorithm: values.algorithm, direction: 'right' });
const actor = { kind: 'agent', conversationId: 'layout-probe', runId: 'diagnostic' };
const base = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: actor, updatedBy: actor, createdAt: 0, updatedAt: 0 };
const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'layout-timing-fixture', sequence: 1, elements: [
  ...Array.from({ length: count }, (_, index) => ({ ...base, id: `c${index + 1}`, type: 'text', x: index % 20 * 50, y: Math.floor(index / 20) * 50,
    width: 240 + index % 3 * 20, height: 72 + index % 5 * 32, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `测高事实 ${index + 1}` }] }] } } })),
  ...Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({ ...base, id: `e${index + 1}`, type: 'edge', direction: 'forward', lineStyle: 'curve', label: '',
    from: { kind: 'card', cardId: `c${Math.floor(index / 2) + 1}`, side: 'auto' }, to: { kind: 'card', cardId: `c${index + 2}`, side: 'auto' } })),
] });
const runtime = createCanvasComputationRuntime({ workerPath: path.resolve('packages/plugins/canvas/dist/backend/canvas-computation-worker.cjs') });
const executions: CanvasLayoutComputation[] = [];
try {
  for (let index = 0; index < samples; index++) {
    const result = await runtime.layout({ ...options, snapshot: { ...snapshot, sequence: index + 1 }, requestId: `timing-${options.algorithm}-${index + 1}` });
    executions.push(result.computation);
  }
} finally { await runtime.dispose(); }
const sorted = executions.map(execution => execution.executionMs).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
const report = { source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) },
  measurement: 'node-worker-layout-execution', fixture: 'mixed-height-binary-tree', actualModelTask: false, count, samples,
  p50Ms: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, executions };
const file = path.resolve(values.output ?? '_dev_data/canvas-layout-timing/results.json'); await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
