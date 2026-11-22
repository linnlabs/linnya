import { describe, expect, it, vi } from 'vitest';

import { restoreDeclaredPluginsWithUserData } from './restoreDeclaredPluginsWithUserData';

describe('有资料的按需插件自动安装', () => {
  it('只安装判定需要恢复的插件，逐个进行；没有资料的插件不下载', async () => {
    const order: string[] = [];
    const install = vi.fn(async (pluginId: string) => { order.push(`start:${pluginId}`); await Promise.resolve(); order.push(`end:${pluginId}`); });
    const restored = await restoreDeclaredPluginsWithUserData({
      declaredPluginIds: ['knowledge', 'mindmap', 'notes'],
      shouldRestore: pluginId => pluginId !== 'mindmap',
      install,
      recordDiagnostic: () => {},
    });
    expect(restored).toEqual(['knowledge', 'notes']);
    expect(install).not.toHaveBeenCalledWith('mindmap');
    expect(order).toEqual(['start:knowledge', 'end:knowledge', 'start:notes', 'end:notes']);
  });

  it('一个插件安装或判定失败只记诊断，不影响其他插件', async () => {
    const diagnostics: string[] = [];
    const restored = await restoreDeclaredPluginsWithUserData({
      declaredPluginIds: ['broken-check', 'offline', 'ok'],
      shouldRestore: pluginId => {
        if (pluginId === 'broken-check') throw new Error('db locked');
        return true;
      },
      install: async pluginId => { if (pluginId === 'offline') throw new Error('network'); },
      recordDiagnostic: ({ pluginId, level, message }) => diagnostics.push(`${level}:${pluginId}:${message}`),
    });
    expect(restored).toEqual(['ok']);
    expect(diagnostics.some(line => line.startsWith('error:broken-check:判断是否需要自动安装失败'))).toBe(true);
    expect(diagnostics.some(line => line.startsWith('error:offline:自动安装失败，资料保留'))).toBe(true);
  });
});
