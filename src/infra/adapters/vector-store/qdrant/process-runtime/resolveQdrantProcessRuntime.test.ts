import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { QdrantRuntimeMissingError } from './qdrantProcessRuntime';
import { resolveQdrantProcessRuntime } from './resolveQdrantProcessRuntime';

describe('resolveQdrantProcessRuntime', () => {
  it('开发环境只从固定 extraResources 解析 macOS 二进制并清除代理', () => {
    const runtime = resolveQdrantProcessRuntime({
      packaged: false,
      resourcesPath: '/workspace/extraResources',
      mainBundleDirectory: '/workspace/dist/main',
      platform: 'darwin',
      architecture: 'arm64',
      hostEnvironment: {
        PATH: '/usr/bin:/bin',
        HTTP_PROXY: 'http://127.0.0.1:8000',
        no_proxy: 'localhost',
      },
    });

    expect(runtime).toMatchObject({
      binaryPath: '/workspace/extraResources/bin/qdrant/mac-arm64/qdrant',
      platform: 'darwin',
      environment: {
        PATH: '/usr/bin:/bin',
        QDRANT__TELEMETRY_DISABLED: 'true',
      },
    });
  });

  it('正式 Windows 运行时只使用 resources 中的发布资产', () => {
    expect(resolveQdrantProcessRuntime({
      packaged: true,
      resourcesPath: 'C:\\Program Files\\Linnya\\resources',
      mainBundleDirectory: 'C:\\Program Files\\Linnya\\resources\\app.asar\\dist\\main',
      platform: 'win32',
      architecture: 'x64',
      hostEnvironment: { SystemRoot: 'C:\\Windows' },
    })).toMatchObject({
      binaryPath: 'C:\\Program Files\\Linnya\\resources\\bin\\qdrant\\qdrant.exe',
      platform: 'win32',
    });
  });

  it('拒绝没有正式发布资产的平台组合', () => {
    expect(() => resolveQdrantProcessRuntime({
      packaged: false,
      resourcesPath: '/workspace/extraResources',
      mainBundleDirectory: '/workspace/dist/main',
      platform: 'linux',
      architecture: 'x64',
      hostEnvironment: {},
    })).toThrow('不支持 linux/x64');
  });

  it('启动时先用已安装运行时组件，其次安装包内副本，都没有时报运行时缺失', async () => {
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-qdrant-runtime-'));
    try {
      const base = {
        packaged: true, resourcesPath: resources, mainBundleDirectory: path.join(resources, 'app.asar', 'dist', 'main'),
        platform: 'darwin' as const, architecture: 'arm64' as const, hostEnvironment: {},
      };
      const installed = resolveQdrantProcessRuntime({ ...base, resolveInstalledExecutable: async () => '/runtimes/qdrant/1.14.1/qdrant' });
      await expect(installed.resolveExecutable?.()).resolves.toBe('/runtimes/qdrant/1.14.1/qdrant');

      const noComponent = resolveQdrantProcessRuntime({ ...base, resolveInstalledExecutable: async () => null });
      await expect(noComponent.resolveExecutable?.()).rejects.toBeInstanceOf(QdrantRuntimeMissingError);

      fs.mkdirSync(path.join(resources, 'bin', 'qdrant'), { recursive: true });
      fs.writeFileSync(path.join(resources, 'bin', 'qdrant', 'qdrant'), 'bundled');
      await expect(noComponent.resolveExecutable?.()).resolves.toBe(path.join(resources, 'bin', 'qdrant', 'qdrant'));
    } finally {
      fs.rmSync(resources, { recursive: true, force: true });
    }
  });
});
