import { describe, expect, it } from 'vitest';

import { resolvePluginLatestManifestUrl } from './resolvePluginLatestManifestUrl';

describe('resolvePluginLatestManifestUrl', () => {
  it('优先使用统一的插件级 latest URL 环境变量', () => {
    expect(resolvePluginLatestManifestUrl({
      pluginId: 'slides',
      env: {
        LINNYA_PLUGIN_SLIDES_LATEST_URL: 'https://example.test/slides/latest.json',
        LINNYA_PLUGIN_DOWNLOAD_ROOT_URL: 'https://download.example.test/plugins',
      },
    })).toBe('https://example.test/slides/latest.json');
  });

  it('不再读取具体插件专属的遗留 latest URL 变量', () => {
    expect(resolvePluginLatestManifestUrl({
      pluginId: 'mindmap',
      env: {
        LINNYA_MINDMAP_PLUGIN_LATEST_URL: 'https://legacy.example.test/mindmap/latest.json',
        LINNYA_PLUGIN_DOWNLOAD_ROOT_URL: 'https://download.example.test/plugins',
      },
    })).toBe('https://download.example.test/plugins/mindmap/latest.json');
  });

  it('按下载根目录拼出标准 latest.json 地址', () => {
    expect(resolvePluginLatestManifestUrl({
      pluginId: 'mindmap',
      env: {
        LINNYA_PLUGIN_DOWNLOAD_ROOT_URL: 'https://download.example.test/plugins/',
      },
    })).toBe('https://download.example.test/plugins/mindmap/latest.json');
  });

  it('拒绝不能作为远程路径片段的插件 ID', () => {
    expect(() => resolvePluginLatestManifestUrl({
      pluginId: '../slides',
      env: {},
    })).toThrow('插件 ID 不能用于官方远程下载路径');
  });
});
