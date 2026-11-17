import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  send: vi.fn(),
  secondarySend: vi.fn(),
  connect: vi.fn(() => () => undefined),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: harness.send,
      },
    }, {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: harness.secondarySend },
    }],
  },
}));

vi.mock('../../window-manager', () => ({ getMainWindow: () => null }));
vi.mock('../../events/rendererReadyEvent', () => ({
  subscribeRendererReady: harness.subscribe,
}));
vi.mock('../../services/modelCatalog/cloudModelsBroadcaster', () => ({
  installCloudModelsBroadcaster: harness.connect,
  notifyCloudModelsRendererReady: vi.fn(),
}));

import { createElectronBackendRendererIntegrationPort } from './createElectronBackendRendererIntegrationPort';

beforeEach(() => vi.clearAllMocks());

describe('createElectronBackendRendererIntegrationPort', () => {
  it('知识库进度经plugin:push原样广播，不再产生Host专属任务channel', () => {
    const port = createElectronBackendRendererIntegrationPort();
    const envelope = { pluginId: 'knowledge', channel: 'task-status-updated', payload: { taskId: 'task-1', docId: 'doc-1', status: 'processing', progress: 35 } };
    port.publishPluginRendererPush(envelope);
    expect(harness.send).toHaveBeenCalledExactlyOnceWith('plugin:push', envelope);
    expect(harness.secondarySend).toHaveBeenCalledExactlyOnceWith('plugin:push', envelope);
  });

  it('将 Backend 事实投影到原 Renderer channels', () => {
    const port = createElectronBackendRendererIntegrationPort();
    const transcription = {
      stage: 'merge',
      percent: 80,
      message: '合并中',
      timestamp: 456,
    };
    const workspace = {
      type: 'workspace.document.updated' as const,
      mutationId: 'mutation-1',
      source: 'tool' as const,
      projectId: 'project-1',
      documentId: 'document-1',
      nodeType: 'markdown',
      mutationKind: 'pending' as const,
    };
    const pluginPush = {
      pluginId: 'slides',
      channel: 'slides:export-progress',
      payload: { progress: 75 },
    };

    port.publishTranscriptionProgress(transcription);
    port.publishWorkspaceMutation(workspace);
    port.publishPluginRendererPush(pluginPush);
    port.publishTodosChanged('project-1');
    port.publishPluginsChanged();

    expect(harness.send).toHaveBeenNthCalledWith(1, 'transcription:progress', transcription);
    expect(harness.send).toHaveBeenNthCalledWith(2, 'workspace:mutation', workspace);
    expect(harness.send).toHaveBeenNthCalledWith(3, 'plugin:push', pluginPush);
    expect(harness.send).toHaveBeenNthCalledWith(4, 'todos-changed', { projectId: 'project-1' });
    expect(harness.send).toHaveBeenNthCalledWith(5, 'plugins-changed', undefined);
    expect(harness.secondarySend.mock.calls).toEqual([['workspace:mutation', workspace], ['plugin:push', pluginPush]]);
  });
});
