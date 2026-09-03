import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('builtin agent definitions import boundary', () => {
  it('加载静态 AgentDefinition 模块时不读取插件清单或运行态数据库', async () => {
    vi.resetModules();
    const runtimeState = await import('../../../plugin-registry/pluginRuntimeState');
    runtimeState.clearPluginRuntimeStateForTests();
    runtimeState.clearPluginRuntimeDatabaseForTests();

    vi.stubEnv('LINNYA_PLUGIN_ROOT', '/tmp/linnya-plugin-root');

    expect(() => runtimeState.getRuntimeEnabledPluginIds())
      .toThrow(runtimeState.PluginRuntimeDatabaseNotReadyError);

    const definitionsModule = await import('../builtin-agent-definitions');

    expect(definitionsModule.getBuiltinAgentDefinitions).toEqual(expect.any(Function));
  }, 15_000);
});
