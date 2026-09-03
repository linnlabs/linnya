import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import {
  clearBackendRendererIntegrationPortForTesting,
  installBackendRendererIntegrationPort,
} from 'src/app-hosts/linnya/desktop-capabilities';
import { PLUGIN_RENDERER_PUSH_CHANNEL, broadcastRendererPluginMessage } from './pluginRendererPush';

describe('pluginRendererPush', () => {
  const publishPluginRendererPush = vi.fn();

  beforeEach(() => {
    clearPluginRuntimeStateForTests();
    backendPluginRegistry.clear();
    clearBackendRendererIntegrationPortForTesting();
    publishPluginRendererPush.mockReset();
    installBackendRendererIntegrationPort({
      connectModelCatalogUpdates: async () => () => undefined,
      publishIngestionStatus: vi.fn(),
      queueJobPresentationPublisher: {
        publishProgress: vi.fn(),
        publishCompletion: vi.fn(),
        publishFailure: vi.fn(),
      },
      publishKnowledgeGraphProgress: vi.fn(),
      publishTranscriptionProgress: vi.fn(),
      publishWorkspaceMutation: vi.fn(),
      publishPluginRendererPush,
      publishTodosChanged: vi.fn(),
      publishPluginsChanged: vi.fn(),
    });
  });

  function registerPushTestPlugin(): void {
    backendPluginRegistry.register({
      meta: {
        id: 'push-test',
        name: 'Push Test',
        version: '1.0.0',
        description: 'Renderer push contract test plugin',
        developer: 'Linnya',
        builtin: true,
      },
      rendererPush: {
        channels: ['push-test:changed'],
      },
    });
  }

  it('broadcasts declared plugin push events through the generic plugin channel', () => {
    registerPushTestPlugin();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'push-test'],
      enabledPluginIds: ['platform', 'push-test'],
    });

    broadcastRendererPluginMessage('push-test', 'push-test:changed', { nodeId: 'node-1' });

    expect(PLUGIN_RENDERER_PUSH_CHANNEL).toBe('plugin:push');
    expect(publishPluginRendererPush).toHaveBeenCalledWith({
      pluginId: 'push-test',
      channel: 'push-test:changed',
      payload: { nodeId: 'node-1' },
    });
  });

  it('rejects disabled plugins before sending', () => {
    registerPushTestPlugin();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'push-test'],
      enabledPluginIds: ['platform'],
    });

    expect(() => broadcastRendererPluginMessage('push-test', 'push-test:changed', {}))
      .toThrow('插件未启用');
    expect(publishPluginRendererPush).not.toHaveBeenCalled();
  });

  it('rejects undeclared push channels before sending', () => {
    registerPushTestPlugin();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'push-test'],
      enabledPluginIds: ['platform', 'push-test'],
    });

    expect(() => broadcastRendererPluginMessage('push-test', 'push-test:unknown', {}))
      .toThrow('插件未声明 renderer push channel');
    expect(publishPluginRendererPush).not.toHaveBeenCalled();
  });
});
