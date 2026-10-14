import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QueueManager } from '../queues';
import { IngestionJobPayloadSchema } from '../jobs';
import { resolveWorkerQdrantUrl } from '../functions/resolveWorkerQdrantUrl';

class TestQueueOwner extends QueueManager {
  constructor() { super(); }
}

describe('向量 Worker 的实例归属', () => {
  it('摄入与图谱队列向真实 Worker 传入 owner 地址，覆盖任务中的其他实例地址', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-queue-endpoint-'));
    const worker = path.join(root, 'endpoint.cjs');
    await writeFile(worker, `
      const { parentPort, workerData } = require('node:worker_threads');
      parentPort.postMessage({ type: 'completed', result: { envVars: workerData.envVars } });
    `);
    const queue = new TestQueueOwner();
    try {
      await queue.initialize({
        workerRuntime: {
          ingestionScriptPath: worker, graphIndexingScriptPath: worker,
          graphExtractionScriptPath: worker, audioProcessingScriptPath: worker,
        },
        runtimePathRoots: { developmentRoot: root, appDataRoot: root, workspaceRoot: root, workspaceRootIsCustom: false },
        distributionIdentity: { kind: 'source', packaged: false },
        qdrantUrl: 'http://127.0.0.1:49200',
      });
      const completed = (name: string) => new Promise<unknown>((resolve, reject) => {
        queue.once(`${name}:taskCompleted`, (event: { result: unknown }) => resolve(event.result));
        queue.once(`${name}:taskFailed`, reject);
      });
      const ingestion = completed('ingestion');
      const graph = completed('graphIndexing');
      const payload = {
        taskId: 'ingestion', kbId: 'kb', docId: 'doc', embeddingModelId: 'embedding',
        filename: 'doc.txt', filePath: '/workspace/doc.txt',
        envVars: { QDRANT_URL: 'http://127.0.0.1:6333' },
      };
      await queue.addIngestionTask(IngestionJobPayloadSchema.parse(payload));
      await queue.addGraphIndexingTask({ ...payload, taskId: 'graph' });
      expect(resolveWorkerQdrantUrl(await ingestion)).toBe('http://127.0.0.1:49200');
      expect(resolveWorkerQdrantUrl(await graph)).toBe('http://127.0.0.1:49200');
      expect(() => resolveWorkerQdrantUrl({})).toThrow();
    } finally {
      await queue.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
