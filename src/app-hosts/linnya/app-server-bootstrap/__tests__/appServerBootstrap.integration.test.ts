import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  encodeAppServerBootstrap,
  parseAppServerBootstrap,
  readAppServerBootstrap,
  type AppServerBootstrap,
} from '..';

describe('App Server bootstrap', () => {
  it('通过 dedicated pipe 传递并冻结唯一 data-only 启动帧', async () => {
    const input = new PassThrough();
    const settlement = readAppServerBootstrap(input);
    input.end(encodeAppServerBootstrap(createBootstrap()));

    const parsed = await settlement;
    expect(parsed.backend_facts.runtimePathRoots.workspaceRoot).toBe('/workspace');
    expect(parsed.command_host_environment.entries).toEqual({ LANG: 'zh_CN.UTF-8' });
    expect(parsed.headless_node_executable_path).toBe('/runtime/bin/node');
    expect(parsed.local_process_platform_runtime.platform).toBe('darwin');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.backend_facts.runtimePathRoots)).toBe(true);
  });

  it('拒绝相对宿主路径与未知字段', () => {
    const bootstrap = createBootstrap();
    expect(() => parseAppServerBootstrap({
      ...bootstrap,
      backend_facts: {
        ...bootstrap.backend_facts,
        mainBundleDirectory: 'dist/main',
        unexpected: true,
      },
    })).toThrow();
  });

  it('拒绝缺帧和多帧', async () => {
    const emptyInput = new PassThrough();
    const emptySettlement = readAppServerBootstrap(emptyInput);
    emptyInput.end();
    await expect(emptySettlement).rejects.toThrow('未提供启动帧');

    const multipleInput = new PassThrough();
    const multipleSettlement = readAppServerBootstrap(multipleInput);
    const frame = encodeAppServerBootstrap(createBootstrap());
    multipleInput.end(Buffer.concat([frame, frame]));
    await expect(multipleSettlement).rejects.toThrow('包含多个帧');
  });
});

function createBootstrap(): AppServerBootstrap {
  return {
    schema_version: 1,
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
      entries: { LANG: 'zh_CN.UTF-8' },
    },
    headless_node_executable_path: '/runtime/bin/node',
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
