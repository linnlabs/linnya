import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import { createLocalProcessPlatformLauncher } from './createLocalProcessPlatformLauncher';

const describeMacOs = process.platform === 'darwin' ? describe : describe.skip;

describeMacOs('macOS 公共进程 owner 组合', () => {
  it('真实启动 pipe 子进程并分别等待根退出、双流、整树和资源释放', async () => {
    const launch = createLocalProcessPlatformLauncher({
      schema_version: 1,
      platform: 'darwin',
    });
    const owned = await launch({
      executablePath: '/bin/sh',
      argv: ['-c', 'printf stdout-value; printf stderr-value >&2'],
      cwd: '/tmp',
      environment: { PATH: '/usr/bin:/bin' },
    });
    const stdout = collect(owned.stdout);
    const stderr = collect(owned.stderr);

    await expect(owned.rootExit).resolves.toEqual({ exitCode: 0, signal: null });
    await expect(owned.rootClose).resolves.toBeUndefined();
    await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
    await expect(stdout).resolves.toBe('stdout-value');
    await expect(stderr).resolves.toBe('stderr-value');
    await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
  });
});

describe('平台 owner 事实拒绝宿主错配', () => {
  it.skipIf(process.platform === 'win32')('在非 Windows 宿主拒绝 Windows runtime', () => {
    expect(() => createLocalProcessPlatformLauncher({
      schema_version: 1,
      platform: 'win32',
      manifest_path: 'C:\\runtime\\manifest.json',
      expected_runtime_version: '1',
      expected_application_version: '1',
      trust: { kind: 'development' },
    })).toThrow('Windows local process runtime was configured on another platform');
  });
});

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  await once(stream, 'end');
  return Buffer.concat(chunks).toString('utf8');
}
