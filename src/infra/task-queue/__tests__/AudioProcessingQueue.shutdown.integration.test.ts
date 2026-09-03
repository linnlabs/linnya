import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../../features/transcription/audio-preprocessing/config';
import { AudioProcessingQueue } from '../AudioProcessingQueue';

const temporaryDirectories: string[] = [];
const shutdownWorkerPath = fileURLToPath(new URL(
  './fixtures/audioProcessingShutdown.worker.cjs',
  import.meta.url,
));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('AudioProcessingQueue shutdown', () => {
  it('等待活动 Worker 真实退出，且并发关闭共享同一 settlement', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-audio-worker-owner-'));
    temporaryDirectories.push(root);
    const markerPath = path.join(root, 'worker.log');
    const queue = new AudioProcessingQueue();
    await queue.initialize(shutdownWorkerPath);

    const cancellation = vi.fn();
    queue.processAudio(markerPath, DEFAULT_CONFIG).on('error', cancellation);
    await vi.waitFor(async () => {
      expect(await readFile(markerPath, 'utf8')).toContain('started');
    });

    const firstShutdown = queue.shutdown();
    const secondShutdown = queue.shutdown();
    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;

    const contentAfterShutdown = await readFile(markerPath, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(await readFile(markerPath, 'utf8')).toBe(contentAfterShutdown);
    expect(cancellation).toHaveBeenCalledWith(expect.objectContaining({
      message: '音频处理任务因队列关闭而取消',
    }));
    expect(() => queue.processAudio(markerPath, DEFAULT_CONFIG)).toThrow('未初始化');
  });
});
