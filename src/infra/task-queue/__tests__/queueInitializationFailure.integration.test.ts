import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioProcessingQueue } from '../AudioProcessingQueue';
import { DEFAULT_CONFIG } from '../../../features/transcription/audio-preprocessing/config';
import { QueueManager } from '../queues';

class TestQueueOwner extends QueueManager {
  constructor() {
    super();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('任务队列启动失败', () => {
  it('收掉已建好的部分，之后的入口说明队列没有启动成功的原因', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-queue-failure-'));
    const worker = path.join(root, 'worker.cjs');
    await writeFile(worker, `require('node:worker_threads');`);
    vi.spyOn(AudioProcessingQueue.prototype, 'initialize').mockRejectedValue(
      new Error('disk I/O error')
    );
    const queue = new TestQueueOwner();
    try {
      await expect(
        queue.initialize({
          workerRuntime: {
            audioProcessingScriptPath: worker,
            pluginBootstrapScriptPath: worker,
          },
        })
      ).rejects.toThrow('disk I/O error');

      expect(queue.hasActiveTasks()).toBe(false);
      expect(() => queue.processAudio('/workspace/audio.wav', DEFAULT_CONFIG)).toThrow(
        '音频处理队列未启动：disk I/O error'
      );
      // 失败 owner 已清空，修复环境后允许正式重新初始化。
      vi.mocked(AudioProcessingQueue.prototype.initialize).mockRestore();
      await queue.initialize({
        workerRuntime: { audioProcessingScriptPath: worker, pluginBootstrapScriptPath: worker },
      });
      expect(queue.hasActiveTasks()).toBe(false);
    } finally {
      await queue.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
