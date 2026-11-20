import { describe, expect, it } from 'vitest';
import { RENDERER_PLUGIN_LOAD_MESSAGE_FALLBACKS } from '../definitions/rendererPluginLoadMessageCatalog';
import type { RendererPluginLoadMessageResolver } from '../definitions/rendererPluginLoadMessages';
import type { RuntimeRendererPluginLoaderDiagnostics } from '../loader/runtimeRendererPluginLoader';
import { clearRendererPluginRegistryForTest, describeRendererPluginRegistryForDiagnostics } from '../registry';
import {
  buildRendererPluginLoadFailureMessage,
  summarizeRendererPluginLoadFailures,
} from './rendererPluginLoadFailurePresentation';

const message: RendererPluginLoadMessageResolver = (key, params) =>
  RENDERER_PLUGIN_LOAD_MESSAGE_FALLBACKS[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));

function diagnostics(
  overrides: Partial<RuntimeRendererPluginLoaderDiagnostics>,
): RuntimeRendererPluginLoaderDiagnostics {
  return {
    runId: 3,
    status: 'failed',
    startedAt: null,
    completedAt: null,
    hostModules: null,
    registryBeforeEntriesApi: null,
    entries: [],
    registryAfterSync: null,
    sync: null,
    error: null,
    ...overrides,
  };
}

function failure(pluginId: string, reason: 'import-timeout' | 'error') {
  clearRendererPluginRegistryForTest();
  const emptyRegistry = describeRendererPluginRegistryForDiagnostics();
  return {
    entry: {
      pluginId,
      version: '1.0.0',
      rendererUiRange: '^3.0.0',
      entryUrl: `plugin://${pluginId}/index.js`,
      cssUrls: [],
      cssCount: 0,
      sourceKind: null,
      pluginDir: null,
      entryPath: null,
    },
    phase: 'import-start' as const,
    reason,
    moduleExports: {
      exportType: 'not-imported',
      exportKeys: [],
      hasRendererPlugin: false,
      hasDefault: false,
      rendererPluginLooksLikeContribution: false,
      defaultLooksLikeContribution: false,
    },
    contribution: null,
    registryBefore: emptyRegistry,
    registryAfterCleanup: emptyRegistry,
    registeredBefore: false,
    activeBefore: false,
    registeredAfterCleanup: false,
    activeAfterCleanup: false,
    error: {},
  };
}

describe('renderer plugin load failure presentation', () => {
  it('成功、运行中和无失败的同步不产生提示', () => {
    expect(summarizeRendererPluginLoadFailures(diagnostics({ status: 'success' }))).toBeNull();
    expect(summarizeRendererPluginLoadFailures(diagnostics({ status: 'running' }))).toBeNull();
    expect(summarizeRendererPluginLoadFailures(diagnostics({
      sync: { processedPluginIds: [], deactivatedPluginIds: [], failures: [] },
    }))).toBeNull();
  });

  it('入口级失败按插件列出，整轮失败给通用提示', () => {
    const summary = summarizeRendererPluginLoadFailures(diagnostics({
      sync: {
        processedPluginIds: ['canvas', 'slides'],
        deactivatedPluginIds: [],
        failures: [failure('canvas', 'import-timeout'), failure('slides', 'error')],
      },
    }));
    expect(summary).toEqual({
      runId: 3,
      failures: [
        { pluginId: 'canvas', reason: 'import-timeout' },
        { pluginId: 'slides', reason: 'error' },
      ],
    });
    const names: Record<string, string> = { canvas: '画布', slides: '幻灯片' };
    expect(buildRendererPluginLoadFailureMessage(summary!, {
      message,
      resolvePluginName: (pluginId) => names[pluginId] ?? pluginId,
    })).toBe('2 个插件未能加载：画布、幻灯片。相关文档暂时无法打开。');

    const wholeRunFailure = summarizeRendererPluginLoadFailures(diagnostics({ sync: null }));
    expect(buildRendererPluginLoadFailureMessage(wholeRunFailure!, {
      message,
      resolvePluginName: (pluginId) => pluginId,
    })).toBe('插件未能加载，相关文档暂时无法打开。');
  });
});
