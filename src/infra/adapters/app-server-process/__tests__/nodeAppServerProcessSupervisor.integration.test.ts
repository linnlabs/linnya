import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import type { JsonValue } from '@app/schemas';
import { describe, expect, it } from 'vitest';

import { AppServerStartupFailedError, createNodeAppServerProcessSupervisor } from '..';
import {
  encodeAppServerBootstrap,
  type AppServerBootstrap,
} from '../../../../app-hosts/linnya/app-server-bootstrap';
import { createAppServerRpcPeer } from '../../../../app-hosts/linnya/app-server-rpc';
import type { AppServerStartupProgress } from '../../../../app-hosts/linnya/app-server-control';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../../../../..');
const fixturePath = path.join(testDirectory, 'fixtures', 'runAppServerControlFixture.mjs');

describe('Node App Server process supervisor', () => {
  it.each(['executable', 'cwd'])('真实 %s 不存在时报告启动错误并完成关闭，不泄漏 EPIPE', async missing => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: missing === 'executable' ? path.join(testDirectory, 'missing-node') : process.execPath,
        entryPath: fixturePath,
        workingDirectory: missing === 'cwd' ? path.join(testDirectory, 'missing-cwd') : repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map(),
      controlTimeoutMs: 100,
    });
    await expect(supervisor.start()).rejects.toThrow('ENOENT');
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
    await expect(supervisor.waitForExit()).resolves.toMatchObject({ signal: null });
  });

  it('以绝对 Node/entry 启动、校验 epoch、ping，并等待 child owner 退出', async () => {
    const stderr: string[] = [];
    let reversePayload: JsonValue | undefined;
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', payload => {
          reversePayload = payload;
          return { acknowledged: true };
        }],
      ]),
      startTimeoutMs: 5_000,
      controlTimeoutMs: 2_000,
      onStderr: text => stderr.push(text),
    });

    const identity = await supervisor.start();
    expect(identity.pid).toBeGreaterThan(0);
    expect(identity.daemonEpoch).toMatch(/^[0-9a-f-]{36}$/u);
    expect(identity.applicationVersion).toBe('0.0.38');
    expect(identity.apiPort).toBe(3000);
    expect(identity.rendererSessionToken).toHaveLength(64);
    expect(identity.databaseReady).toBe(true);
    expect(reversePayload).toEqual({ from: 'backend' });
    process.kill(identity.pid, 'SIGINT');
    await new Promise(resolve => setTimeout(resolve, 25));
    await expect(supervisor.ping()).resolves.toBeUndefined();
    await expect(supervisor.request('backend.fixture.echo', { from: 'desktop' }))
      .resolves.toEqual({ from: 'desktop' });
    await expect(supervisor.ping()).resolves.toBeUndefined();
    const activeRequest = supervisor.request('backend.fixture.wait', null, { timeoutMs: 5_000 });
    const activeRequestExpectation = expect(activeRequest).rejects.toThrow('正在关闭');
    await waitFor(() => stderr.join('').includes('fixture-rpc-handler-started'));
    const exit = supervisor.waitForExit();
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
    await expect(exit).resolves.toMatchObject({ code: 0, signal: null, expected: true });
    await activeRequestExpectation;
    expect(stderr.join('')).toContain('fixture-owner-shutdown');
    expect(stderr.join('')).toContain('fixture-rpc-handler-aborted');
  });

  it('数据库启动阶段不计入启动超时，进度按顺序交给宿主', async () => {
    const progress: AppServerStartupProgress[] = [];
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        entryArguments: ['--database-startup-ms=1600'],
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
      // 足够 child 加载 tsx 并发出 started，但远短于模拟升级的 1.6 秒。
      startTimeoutMs: 1_200,
      onStartupProgress: event => progress.push(event),
    });
    await expect(supervisor.start()).resolves.toMatchObject({ databaseReady: true });
    expect(progress).toEqual([
      { state: 'started', upgrading: true, completedSteps: 0, totalSteps: 2 },
      { state: 'progress', upgrading: true, completedSteps: 1, totalSteps: 2 },
      { state: 'progress', upgrading: true, completedSteps: 2, totalSteps: 2 },
      { state: 'finished', upgrading: true, completedSteps: 2, totalSteps: 2 },
    ]);
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
  });

  it('数据库阶段结束后重新计时，之后迟迟不 ready 仍会超时', async () => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        entryArguments: ['--database-startup-ms=0', '--ready-delay-after-database-ms=5000'],
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
      startTimeoutMs: 1_200,
      controlTimeoutMs: 300,
    });
    await expect(supervisor.start()).rejects.toThrow('ready 超时（1200ms）');
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
  });

  it('child 启动失败时把类别交给宿主，并保留原始文案用于诊断', async () => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        entryArguments: ['--startup-failure-code=SQLITE_FULL'],
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
      controlTimeoutMs: 300,
    });
    const failure = await supervisor.start().then(
      () => { throw new Error('expected startup failure'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AppServerStartupFailedError);
    if (!(failure instanceof AppServerStartupFailedError)) throw new Error('unreachable');
    expect(failure.startupFailure).toEqual({
      reason: 'disk_full',
      code: 'SQLITE_FULL',
      migration_from_version: null,
    });
    expect(failure.message).toContain('fixture startup failure SQLITE_FULL');
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
  });

  it('RPC pipe 先于 fatal 帧断开时，仍以 fatal 帧里的启动失败原因为准', async () => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        entryArguments: ['--startup-failure-code=SQLITE_FULL', '--close-rpc-before-startup-failure'],
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
      controlTimeoutMs: 300,
    });
    const failure = await supervisor.start().then(
      () => { throw new Error('expected startup failure'); },
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AppServerStartupFailedError);
    if (!(failure instanceof AppServerStartupFailedError)) throw new Error('unreachable');
    expect(failure.startupFailure.reason).toBe('disk_full');
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
  });

  it('真实 child 运行期被强杀时报告意外退出，随后的 shutdown 不再请求已死 Backend', async () => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
    });
    const identity = await supervisor.start();
    process.kill(identity.pid, 'SIGKILL');
    await expect(supervisor.waitForExit()).resolves.toMatchObject({ expected: false });
    await expect(supervisor.request('backend.fixture.echo', null)).rejects.toThrow('已经退出');
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
  });

  it('业务已确认关停但仍需终止残留 child 时，不得报告正常退出', async () => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        entryArguments: ['--retain-shutdown-timer'],
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
      controlTimeoutMs: 300,
    });
    await supervisor.start();
    await expect(supervisor.shutdown()).rejects.toThrow('未正常关停');
    const exit = await supervisor.waitForExit();
    expect(exit.expected).toBe(true);
    expect(exit.code === 0 && exit.signal === null).toBe(false);
  });

  it('拒绝相对 executable/entry/cwd，避免 composition 偷偷回退 PATH', () => {
    expect(() => createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: 'node',
        entryPath: 'appServer.cjs',
        workingDirectory: '.',
        environment: {},
        bootstrapBytes: Buffer.from('{}\n'),
      },
      rpcHandlers: new Map(),
    })).toThrow('必须是绝对路径');
  });

  it('未 start 时拒绝等待退出，避免把调用顺序错误变成永久等待', () => {
    const supervisor = createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        workingDirectory: repositoryRoot,
        environment: collectTestEnvironment(),
        bootstrapBytes: encodeAppServerBootstrap(createBootstrap()),
      },
      rpcHandlers: new Map(),
    });
    expect(() => supervisor.waitForExit()).toThrow('尚未启动');
  });

  it('拒绝超出固定预算的 bootstrap，不能把额外 pipe 变成无界输入', () => {
    expect(() => createNodeAppServerProcessSupervisor({
      launch: {
        executablePath: process.execPath,
        entryPath: fixturePath,
        workingDirectory: repositoryRoot,
        environment: {},
        bootstrapBytes: Buffer.alloc(1024 * 1024 + 1),
      },
      rpcHandlers: new Map(),
    })).toThrow('必须在 1-1048576 bytes');
  });

  it('真实 child 在 parent pipe EOF 后收口 owner 并退出', async () => {
    const child = spawn(process.execPath, [fixturePath], {
      cwd: repositoryRoot,
      env: collectTestEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const childStdio = [...child.stdio];
    const bootstrapInput = childStdio[3];
    const rpcFromChild = childStdio[4];
    const rpcToChild = childStdio[5];
    if (!(bootstrapInput instanceof Writable)
      || !(rpcFromChild instanceof Readable)
      || !(rpcToChild instanceof Writable)) {
      throw new Error('测试 App Server bootstrap/RPC pipe 创建失败');
    }
    const rpc = createAppServerRpcPeer({
      input: rpcFromChild,
      output: rpcToChild,
      handlers: new Map([
        ['desktop.fixture.echo', () => ({ acknowledged: true })],
      ]),
    });
    bootstrapInput.end(encodeAppServerBootstrap(createBootstrap()));
    await waitFor(() => stdout.includes('"kind":"ready"'));

    child.stdin.end();
    await waitFor(() => stderr.includes('fixture-owner-shutdown'));
    rpc.dispose(new Error('fixture parent 正在关闭'));
    rpcToChild.end();
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code));
    });

    expect(exitCode).toBe(0);
    expect(stderr).toContain('fixture-owner-shutdown');
  });
});

function collectTestEnvironment(): Readonly<Record<string, string>> {
  const entries: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') entries.push([key, value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function createBootstrap(): AppServerBootstrap {
  return {
    schema_version: 6,
    host_kind: 'desktop',
    host_process: { pid: process.pid },
    backend_configuration: {
      qdrant: { host: '127.0.0.1', port: 6333 },
      server: { port: 3000 },
    },
    backend_facts: {
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: false,
      distributionIdentity: { kind: 'source', packaged: false },
      resourcesPath: '/resources',
      mainBundleDirectory: '/repo/dist/main',
      runtimePathRoots: {
        developmentRoot: '/repo',
        appDataRoot: '/app-data',
        workspaceRoot: '/workspace',
        workspaceRootIsCustom: true,
      },
      exposeProviderOutboundDebugRoutes: true,
    },
    command_host_environment: {
      kind: 'host_process_environment',
      entries: {},
    },
    headless_node_executable_path: process.execPath,
    local_process_platform_runtime: {
      schema_version: 1,
      platform: 'darwin',
    },
    host_capabilities: {
      command_approval_presenter: { available: false },
    },
    text_measurement: {
      use_browser_pretext: true,
      use_harfbuzz: true,
      worker_availability: { available: true },
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待 App Server fixture ready 超时');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
