import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type {
  OwnedPipeProcess,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../../shared/process-runtime';
import { createLocalProcessPlatformLauncher } from '../../../../local-process-runtime/production-runtime';
import { createOwnedQdrantProcess } from './createOwnedQdrantProcess';

const describeMacOs = process.platform === 'darwin' ? describe : describe.skip;

describe('createOwnedQdrantProcess', () => {
  it('平台 owner 启动失败时关闭已经取得的日志资源', async () => {
    const output = new PassThrough();
    const startupFailure = new Error('owner unavailable');

    await expect(createOwnedQdrantProcess({
      launchOwnedPipeProcess: async () => { throw startupFailure; },
      launch: launchFacts(),
      output,
    })).rejects.toBe(startupFailure);
    expect(output.writableFinished).toBe(true);
  });

  it('自然退出也等待 tree-empty、资源释放和日志终态', async () => {
    const rootExit = deferred<OwnedProcessRootExit>();
    const treeEmpty = deferred<OwnedProcessTreeStopResult>();
    const release = vi.fn(async (): Promise<OwnedProcessResourceReleaseResult> => ({
      status: 'succeeded',
    }));
    const owner = createOwner({ rootExit: rootExit.promise, treeEmpty: treeEmpty.promise, release });
    const output = new PassThrough();
    const bytes: Buffer[] = [];
    output.on('data', chunk => bytes.push(Buffer.from(chunk)));
    const process = await createOwnedQdrantProcess({
      launchOwnedPipeProcess: async () => owner,
      launch: launchFacts(),
      output,
    });

    owner.stdout.push('stdout');
    owner.stderr.push('stderr');
    owner.stdout.push(null);
    owner.stderr.push(null);
    rootExit.resolve({ exitCode: 0, signal: null });
    let terminalSettled = false;
    void process.terminal.then(() => { terminalSettled = true; });
    await Promise.resolve();
    expect(terminalSettled).toBe(false);

    treeEmpty.resolve({ status: 'succeeded' });
    await expect(process.terminal).resolves.toEqual({ exitCode: 0, signal: null });
    expect(release).toHaveBeenCalledOnce();
    expect(output.writableFinished).toBe(true);
    expect(Buffer.concat(bytes).toString('utf8')).toContain('stdout');
    expect(Buffer.concat(bytes).toString('utf8')).toContain('stderr');
  });

  it('App stop 在 tree-empty 和 release 完成前不结算', async () => {
    const rootExit = deferred<OwnedProcessRootExit>();
    const treeEmpty = deferred<OwnedProcessTreeStopResult>();
    const stopTree = deferred<OwnedProcessTreeStopResult>();
    const releaseResult = deferred<OwnedProcessResourceReleaseResult>();
    const owner = createOwner({
      rootExit: rootExit.promise,
      treeEmpty: treeEmpty.promise,
      stopAndWaitForTreeEmpty: vi.fn(() => stopTree.promise),
      release: vi.fn(() => releaseResult.promise),
    });
    const process = await createOwnedQdrantProcess({
      launchOwnedPipeProcess: async () => owner,
      launch: launchFacts(),
      output: new PassThrough(),
    });

    const stopped = process.stopAndWait();
    let stoppedSettled = false;
    void stopped.then(() => { stoppedSettled = true; });
    stopTree.resolve({ status: 'succeeded' });
    await Promise.resolve();
    expect(stoppedSettled).toBe(false);
    releaseResult.resolve({ status: 'succeeded' });
    rootExit.resolve({ exitCode: null, signal: 'SIGTERM' });
    treeEmpty.resolve({ status: 'succeeded' });
    await stopped;
    expect(stoppedSettled).toBe(true);
  });

  it('进程树清理失败时保留失败事实', async () => {
    const cleanupError = new Error('tree is still alive');
    const owner = createOwner({
      rootExit: Promise.resolve({ exitCode: null, signal: 'SIGKILL' }),
      treeEmpty: Promise.resolve({ status: 'failed', error: cleanupError }),
      release: vi.fn(async () => ({ status: 'succeeded' as const })),
    });
    const process = await createOwnedQdrantProcess({
      launchOwnedPipeProcess: async () => owner,
      launch: launchFacts(),
      output: new PassThrough(),
    });

    await expect(process.terminal).rejects.toMatchObject({
      name: 'QdrantProcessCleanupError',
      treeCleanup: { status: 'failed', error: cleanupError },
    });
  });
});

describeMacOs('Qdrant macOS process owner 组合门禁', () => {
  it('真实 child 忽略 TERM 时仍等待公共 owner 证明进程组为空', async () => {
    const output = new PassThrough();
    output.resume();
    const process = await createOwnedQdrantProcess({
      launchOwnedPipeProcess: createLocalProcessPlatformLauncher({
        schema_version: 1,
        platform: 'darwin',
      }),
      launch: {
        executablePath: '/bin/sh',
        argv: ['-c', "trap '' TERM; while true; do sleep 1; done"],
        cwd: '/tmp',
        environment: { PATH: '/usr/bin:/bin' },
      },
      output,
    });

    await process.stopAndWait();
    await expect(process.terminal).resolves.toMatchObject({ exitCode: null });
    expect(output.writableFinished).toBe(true);
  });
});

function createOwner(input: {
  readonly rootExit: Promise<OwnedProcessRootExit>;
  readonly treeEmpty: Promise<OwnedProcessTreeStopResult>;
  readonly stopAndWaitForTreeEmpty?: () => Promise<OwnedProcessTreeStopResult>;
  readonly release: () => Promise<OwnedProcessResourceReleaseResult>;
}): OwnedPipeProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return {
    stdout,
    stderr,
    rootExit: input.rootExit,
    rootClose: input.rootExit.then(() => undefined),
    treeEmpty: input.treeEmpty,
    stopAndWaitForTreeEmpty: input.stopAndWaitForTreeEmpty ?? (() => input.treeEmpty),
    release: input.release,
  };
}

function launchFacts() {
  return {
    executablePath: '/runtime/qdrant',
    argv: ['--config-path', '/data/config.yaml'],
    cwd: '/data',
    environment: Object.freeze({ PATH: '/usr/bin:/bin' }),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
