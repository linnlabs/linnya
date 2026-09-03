import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePluginCliClientPath } from './resolvePluginCliClientPath';

describe('resolvePluginCliClientPath', () => {
  it('开发态只解析当前 main bundle 生成物，发布态只解析 Resources 制品', () => {
    expect(resolvePluginCliClientPath({
      packaged: false,
      resourcesPath: '/Applications/Linnya.app/Contents/Resources',
      mainBundleDirectory: '/repo/dist/main',
      platform: 'darwin',
      architecture: 'arm64',
    })).toBe(path.join(
      '/repo/dist/main/plugin-cli-runtime/darwin/arm64/linnya-plugin-cli-client',
    ));
    expect(resolvePluginCliClientPath({
      packaged: true,
      resourcesPath: 'C:\\Program Files\\Linnya\\resources',
      mainBundleDirectory: 'C:\\repo\\dist\\main',
      platform: 'win32',
      architecture: 'x64',
    })).toBe(path.win32.join(
      'C:\\Program Files\\Linnya\\resources',
      'command-runtime/plugin-cli/win32/x64/linnya-plugin-cli-client.exe',
    ));
  });

  it('不从 PATH、旧安装目录或其它架构回退', () => {
    expect(() => resolvePluginCliClientPath({
      packaged: true,
      resourcesPath: '/resources',
      mainBundleDirectory: '/dist/main',
      platform: 'darwin',
      architecture: 'x64',
    })).toThrow('does not support darwin/x64');
  });
});
