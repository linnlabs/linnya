import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  enableFileLogging,
  shutdownDiagnosticLogging,
} from '../../../shared/logger';
import { WorkerThreadQueue } from '../WorkerThreadQueue';

const temporaryDirectories: string[] = [];
const diagnosticWorkerPath = fileURLToPath(new URL('./fixtures/diagnosticLog.worker.cjs', import.meta.url));
const shutdownWorkerPath = fileURLToPath(new URL('./fixtures/workerShutdown.worker.cjs', import.meta.url));
const runtimePathRootsWorkerPath = fileURLToPath(new URL('./fixtures/runtimePathRoots.worker.cjs', import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('WorkerThreadQueue 诊断日志与退出合同', () => {
  it('把 owner 冻结的路径事实原样传入 Worker，而不让 Worker 根据 cwd 重算', async () => {
    const runtimePathRoots = Object.freeze({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/desktop/app-data/AIService',
      workspaceRoot: '/desktop/documents/Linnya',
      workspaceRootIsCustom: false,
    });
    const queue = new WorkerThreadQueue<{ taskId: string }>({
      maxConcurrency: 1,
      workerScript: runtimePathRootsWorkerPath,
      runtimePathRoots,
    });
    const completed = new Promise<unknown>((resolve, reject) => {
      queue.once('taskCompleted', (event: { result: unknown }) => resolve(event.result));
      queue.once('taskFailed', (task: { error?: string }) => reject(new Error(task.error ?? 'worker failed')));
    });

    await queue.addTask({ taskId: 'runtime-path-roots' });
    await expect(completed).resolves.toEqual(runtimePathRoots);
    await queue.shutdown();
  });

  it('worker 有界摘要经主线程队列进入 App 唯一文件 writer', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-worker-log-'));
    temporaryDirectories.push(directory);
    const logPath = path.join(directory, 'backend-2026-07-31.log');
    enableFileLogging(true, logPath);
    const queue = new WorkerThreadQueue<{ taskId: string }>({
      maxConcurrency: 1,
      workerScript: diagnosticWorkerPath,
    });
    const completed = new Promise<void>((resolve, reject) => {
      queue.once('taskCompleted', () => resolve());
      queue.once('taskFailed', (task: { error?: string }) => reject(new Error(task.error ?? 'worker failed')));
    });

    await queue.addTask({ taskId: 'diagnostic-worker' });
    await completed;
    await queue.shutdown();
    const shutdown = await shutdownDiagnosticLogging();
    enableFileLogging(false);

    expect(shutdown?.complete).toBe(true);
    expect(await readFile(logPath, 'utf8')).toContain('[FixtureWorker] bounded worker summary');
  });

  it('shutdown 等待真实 worker 退出，且不会在收尾回调中拉起待处理任务', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-worker-shutdown-'));
    temporaryDirectories.push(directory);
    const markerPath = path.join(directory, 'started.log');
    const queue = new WorkerThreadQueue<{ taskId: string; markerPath: string }>({
      maxConcurrency: 1,
      workerScript: shutdownWorkerPath,
    });
    const failed = vi.fn();
    queue.on('taskFailed', failed);
    await queue.addTask({ taskId: 'running', markerPath });
    await queue.addTask({ taskId: 'must-not-start', markerPath });
    await vi.waitFor(async () => {
      expect(await readFile(markerPath, 'utf8')).toBe('running\n');
    });

    await queue.shutdown();

    expect(await readFile(markerPath, 'utf8')).toBe('running\n');
    expect(failed).not.toHaveBeenCalled();
    await expect(queue.addTask({ taskId: 'late', markerPath })).rejects.toThrow('任务队列正在关闭');
  });
});
