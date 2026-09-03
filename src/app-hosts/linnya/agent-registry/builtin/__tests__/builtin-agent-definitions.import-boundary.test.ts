import { describe, expect, it, vi } from 'vitest';

describe('builtin agent definitions import boundary', () => {
  it('加载静态 AgentDefinition 清单时不读取插件运行态数据库', async () => {
    vi.resetModules();
    const runtimeState = await import('../../../plugin-registry/pluginRuntimeState');
    runtimeState.clearPluginRuntimeStateForTests();
    runtimeState.clearPluginRuntimeDatabaseForTests();

    expect(() => runtimeState.getRuntimeEnabledPluginIds())
      .toThrow(runtimeState.PluginRuntimeDatabaseNotReadyError);

    const definitionsModule = await import('../builtin-agent-definitions');

    expect(definitionsModule.BUILTIN_AGENT_DEFINITIONS.length).toBeGreaterThan(0);
  }, 15_000);
});
