import path from 'node:path';
import { createCanvasComputationRuntime } from '../../src/backend/capabilities/canvasComputation/createCanvasComputationRuntime';
import { CanvasSnapshotSchema } from '../../src/shared';

async function run() {
const packageRoot = process.argv[2]; if (!packageRoot) throw new Error('Isolated Canvas artifact root required');
const source = { kind: 'user', conversationId: null, runId: null };
const base = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0 };
const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'artifact', sequence: 7, elements: [
  ...[0, 1, 2].map(index => ({ ...base, id: `c${index + 1}`, type: 'text', x: index * 10, y: index * 10, width: 280, height: 120 + index * 60,
    parentId: null, data: { contentVersion: 1, content: { type: 'doc', content: [] } } })),
  ...[0, 1].map(index => ({ ...base, id: `e${index + 1}`, type: 'edge', direction: 'forward', lineStyle: 'curve', linePattern: 'solid', label: '',
    from: { kind: 'card', cardId: `c${index + 1}`, side: 'auto' }, to: { kind: 'card', cardId: `c${index + 2}`, side: 'auto' } })),
] });
const runtime = createCanvasComputationRuntime({ workerPath: path.join(packageRoot, 'dist/backend/canvas-computation-worker.cjs') });
try {
  const check = await runtime.check(snapshot); if (check.sequence !== 7 || !check.overlapCount) throw new Error('artifact_check_did_not_execute');
  for (const algorithm of ['tree', 'grid', 'layered'] as const) {
    const result = await runtime.layout({ snapshot, algorithm, direction: 'right' });
    if (result.sequence !== 7 || result.operations.length < 2 || result.operations.some(operation => operation.baseRevision !== 1)) throw new Error(`artifact_layout_missing:${algorithm}`);
  }
  const abort = new AbortController();
  const cancelled = runtime.layout({ snapshot, algorithm: 'layered', direction: 'down' }, abort.signal).then(() => false, () => true); abort.abort();
  if (!await cancelled || (await runtime.check(snapshot)).sequence !== 7) throw new Error('artifact_worker_cancel_or_recovery_failed');
  console.log('[canvas-artifact] isolated compiled check/tree/grid/ELK/cancel passed');
} finally { await runtime.dispose(); }

}
void run().catch(error => { console.error(error); process.exitCode = 1; });
