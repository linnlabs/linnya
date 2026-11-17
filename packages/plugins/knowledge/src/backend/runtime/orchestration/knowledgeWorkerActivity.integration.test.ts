import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QueueManager } from 'src/infra/task-queue/queues';
import { IngestionJobPayloadSchema } from 'src/infra/task-queue/jobs';
import { createKnowledgeActivityOwner } from './createKnowledgeActivityOwner';

class TestQueueOwner extends QueueManager { constructor() { super(); } }

describe('knowledge cross-worker activity admission', () => {
  it('真实摄入 Worker 未退出前维护与重建不可进入，取消释放后可以维护，其他库不受影响', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-activity-'));
    const worker = path.join(root, 'owned-worker.cjs');
    const marker = path.join(root, 'exit.txt');
    await writeFile(worker, `
      const { parentPort, workerData } = require('node:worker_threads');
      const { writeFileSync } = require('node:fs');
      const hold = setInterval(() => {}, 1000);
      parentPort.on('message', message => {
        if (message.cmd === 'cancel') {
          writeFileSync(workerData.filePath, 'worker exited');
          clearInterval(hold);
          parentPort.close();
        }
      });
      parentPort.postMessage({ type: 'progress', progress: 1, data: {} });
    `);
    const queue = new TestQueueOwner();
    const activity = createKnowledgeActivityOwner();
    try {
      await queue.initialize({
        workerRuntime: { pluginBootstrapScriptPath: worker, ingestionScriptPath: worker, graphExtractionScriptPath: worker, graphIndexingScriptPath: worker, audioProcessingScriptPath: worker },
        runtimePathRoots: { developmentRoot: root, appDataRoot: root, workspaceRoot: root, workspaceRootIsCustom: false },
        distributionIdentity: { kind: 'source', packaged: false },
        maxConcurrency: 1, knowledgeActivity: activity,
        resolveQdrantUrl: async () => 'http://127.0.0.1:49200',
      });
      const ready = new Promise<void>(resolve => queue.once('ingestion:taskProgress', () => resolve()));
      await queue.addIngestionTask(IngestionJobPayloadSchema.parse({
        taskId: 'worker-job', kbId: 'library', docId: 'document', embeddingModelId: 'model', filename: 'source.md', filePath: marker,
      }));
      await ready;
      expect(() => activity.begin('library', 'maintenance')).toThrow('正在执行');
      expect(() => activity.begin('library', 'rebuild')).toThrow('正在执行');
      const other = activity.begin('other', 'maintenance'); other.release();
      await queue.cancelIngestionTask('worker-job');
      await activity.whenIdle('library');
      expect(await readFile(marker, 'utf8')).toBe('worker exited');
      const maintenance = activity.begin('library', 'maintenance');
      await expect(queue.addIngestionTask(IngestionJobPayloadSchema.parse({
        taskId: 'must-not-start', kbId: 'library', docId: 'document', embeddingModelId: 'model', filename: 'source.md', filePath: marker,
      }))).rejects.toThrow('正在执行');
      maintenance.release();
      expect(activity.hasActivity()).toBe(false);
    } finally {
      await queue.shutdown();
      await activity.drain();
      await rm(root, { recursive: true, force: true });
    }
  });
});
