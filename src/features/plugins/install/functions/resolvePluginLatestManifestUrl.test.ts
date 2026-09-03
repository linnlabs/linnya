import { describe, expect, it } from 'vitest';

import { resolvePluginLatestManifestUrl } from './resolvePluginLatestManifestUrl';

describe('resolvePluginLatestManifestUrl', () => {
  it('允许测试显式注入下载根，但不读取运行环境变量', () => {
    expect(resolvePluginLatestManifestUrl({
      pluginId: 'slides',
      defaultRootUrl: 'https://download.example.test/plugins',
    })).toBe('https://download.example.test/plugins/slides/latest.json');
  });

  it('使用固定的 Linnya 官方下载根', () => {
    expect(resolvePluginLatestManifestUrl({
      pluginId: 'mindmap',
    })).toBe('https://download.linnyai.com/plugins/mindmap/latest.json');
  });

  it('拒绝不能作为远程路径片段的插件 ID', () => {
    expect(() => resolvePluginLatestManifestUrl({
      pluginId: '../slides',
    })).toThrow('插件 ID 不能用于官方远程下载路径');
  });
});
