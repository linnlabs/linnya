import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioProcessingQueue } from '../AudioProcessingQueue';
import { IngestionJobPayloadSchema } from '../jobs';
import { QueueManager } from '../queues';

class TestQueueOwner extends QueueManager {
  constructor() { super(); }
}

afterEach(() => vi.restoreAllMocks());

describe('任务队列启动失败', () => {
  it('收掉已建好的部分，之后的入口说明队列没有启动成功的原因', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-queue-failure-'));
    const worker = path.join(root, 'worker.cjs');
    await writeFile(worker, `require('node:worker_threads');`);
    vi.spyOn(AudioProcessingQueue.prototype, 'initialize')
      .mockRejectedValue(new Error('disk I/O error'));
    const queue = new TestQueueOwner();
    try {
      await expect(queue.initialize({
        workerRuntime: {
          ingestionScriptPath: worker, graphIndexingScriptPath: worker,
          graphExtractionScriptPath: worker, audioProcessingScriptPath: worker,
        },
        runtimePathRoots: { developmentRoot: root, appDataRoot: root, workspaceRoot: root, workspaceRootIsCustom: false },
        distributionIdentity: { kind: 'source', packaged: false },
      })).rejects.toThrow('disk I/O error');

      const reason = '后台任务队列没有启动成功，暂时不能执行（disk I/O error）';
      // 摄入队列在音频队列之前建好；失败后已经收掉，不能继续接任务。
      expect(() => queue.getQueueStats()).toThrow(reason);
      await expect(queue.addIngestionTask(IngestionJobPayloadSchema.parse({
        taskId: 'ingestion', kbId: 'kb', docId: 'doc', embeddingModelId: 'embedding',
        filename: 'doc.txt', filePath: '/workspace/doc.txt',
      }))).rejects.toThrow(reason);
      expect(() => queue.processAudio('/workspace/audio.wav', {} as never)).toThrow(reason);
    } finally {
      await queue.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
