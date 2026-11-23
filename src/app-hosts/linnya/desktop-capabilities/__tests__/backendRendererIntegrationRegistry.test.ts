import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearBackendRendererIntegrationPortForTesting,
  getBackendRendererIntegrationPort,
  installBackendRendererIntegrationPort,
  type BackendRendererIntegrationPort,
} from '..';

afterEach(clearBackendRendererIntegrationPortForTesting);

describe('Backend renderer integration registry', () => {
  it('冻结同一 App owner 的唯一 Renderer integration', () => {
    const port = createPort();
    installBackendRendererIntegrationPort(port);
    installBackendRendererIntegrationPort(port);
    expect(getBackendRendererIntegrationPort()).toBe(port);
    expect(() => installBackendRendererIntegrationPort(createPort()))
      .toThrow('已安装另一实现');
  });
});

function createPort(): BackendRendererIntegrationPort {
  return Object.freeze({
    connectModelCatalogUpdates: async () => () => undefined,
    publishTranscriptionProgress: vi.fn(),
    publishWorkspaceMutation: vi.fn(),
    publishPluginRendererPush: vi.fn(),
    publishTodosChanged: vi.fn(),
    publishModelsChanged: vi.fn(),
    publishConversationActivityChanged: vi.fn(),
    publishScheduledTasksChanged: vi.fn(),
    publishPluginsChanged: vi.fn(),
    publishPluginDataChanged: vi.fn(),
    publishPluginInstallProgress: vi.fn(),
  });
}
