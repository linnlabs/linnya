import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveQueueWorkerRuntime } from './resolveQueueWorkerRuntime';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, {
        recursive: true,
        force: true,
      })
    )
  );
});

describe('resolveQueueWorkerRuntime', () => {
  it('从 main bundle 同级目录冻结 Worker 产物路径', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-queue-worker-runtime-'));
    temporaryDirectories.push(root);
    const mainBundleDirectory = path.join(root, 'dist', 'main');
    const workerBundleDirectory = path.dirname(mainBundleDirectory);
    await mkdir(workerBundleDirectory, { recursive: true });
    await Promise.all(
      ['plugin-runtime.worker.cjs', 'audio-processing.worker.cjs'].map(filename =>
        writeFile(path.join(workerBundleDirectory, filename), '')
      )
    );

    const runtime = resolveQueueWorkerRuntime(mainBundleDirectory);

    expect(runtime).toEqual({
      audioProcessingScriptPath: path.join(workerBundleDirectory, 'audio-processing.worker.cjs'),
      pluginBootstrapScriptPath: path.join(workerBundleDirectory, 'plugin-runtime.worker.cjs'),
    });
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('启动时拒绝缺失 Worker bundle，而不是等到首次业务执行才失败', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-queue-worker-missing-'));
    temporaryDirectories.push(root);

    expect(() => resolveQueueWorkerRuntime(path.join(root, 'dist', 'main'))).toThrow(
      'plugin-runtime.worker.cjs'
    );
  });
});
