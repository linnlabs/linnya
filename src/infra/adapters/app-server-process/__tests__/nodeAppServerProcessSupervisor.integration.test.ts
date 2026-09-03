import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import type { JsonValue } from '@app/schemas';
import { describe, expect, it } from 'vitest';

import { createNodeAppServerProcessSupervisor } from '..';
import {
  encodeAppServerBootstrap,
  type AppServerBootstrap,
} from '../../../../app-hosts/linnya/app-server-bootstrap';
import { createAppServerRpcPeer } from '../../../../app-hosts/linnya/app-server-rpc';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../../../../..');
const fixturePath = path.join(testDirectory, 'fixtures', 'runAppServerControlFixture.mjs');

describe('Node App Server process supervisor', () => {
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
    await expect(supervisor.request('backend.fixture.echo', { from: 'desktop' }))
      .resolves.toEqual({ from: 'desktop' });
    await expect(supervisor.ping()).resolves.toBeUndefined();
    const activeRequest = supervisor.request('backend.fixture.wait', null, { timeoutMs: 5_000 });
    const activeRequestExpectation = expect(activeRequest).rejects.toThrow('正在关闭');
    await waitFor(() => stderr.join('').includes('fixture-rpc-handler-started'));
    await expect(supervisor.shutdown()).resolves.toBeUndefined();
    await activeRequestExpectation;
    expect(stderr.join('')).toContain('fixture-owner-shutdown');
    expect(stderr.join('')).toContain('fixture-rpc-handler-aborted');
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
    schema_version: 2,
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
      legacyUserDataDirectory: '/app-user-data',
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
