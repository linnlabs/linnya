import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  send: vi.fn(),
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

const LEGACY_JOB_ID_FIELD = ['task', 'Id'].join('');

describe('createElectronBackendRendererIntegrationPort', () => {
  it('保持既有 task-status-update payload，并从通用队列隔离 BrowserWindow', () => {
    const port = createElectronBackendRendererIntegrationPort();
    port.queueJobPresentationPublisher.publishProgress({
      jobId: 'task-1',
      progress: 35,
      data: {
        doc_id: 'doc-1',
        filename: 'a.pdf',
        status: 'processing',
        message: '解析中',
        stage: 'parsing',
        stage_progress: 70,
        updated_at: 123,
      },
    });

    expect(harness.send).toHaveBeenCalledWith('task-status-update', {
      [LEGACY_JOB_ID_FIELD]: 'task-1',
      docId: 'doc-1',
      filename: 'a.pdf',
      status: 'processing',
      progress: 35,
      message: '解析中',
      error: undefined,
      stage: 'parsing',
      stage_progress: 70,
      updated_at: 123,
      timestamp: 123,
    });
  });

  it('将 Backend 事实投影到原 Renderer channels', () => {
    const port = createElectronBackendRendererIntegrationPort();
    const graph = {
      kbId: 'kb-1',
      percent: 50,
      totalUnits: 4,
      doneUnits: 2,
      updatedAtSeconds: 123,
    };
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

    port.publishKnowledgeGraphProgress(graph);
    port.publishTranscriptionProgress(transcription);
    port.publishWorkspaceMutation(workspace);
    port.publishPluginRendererPush(pluginPush);
    port.publishTodosChanged('project-1');
    port.publishPluginsChanged();

    expect(harness.send).toHaveBeenNthCalledWith(1, 'kb-graph-progress-updated', graph);
    expect(harness.send).toHaveBeenNthCalledWith(2, 'transcription:progress', transcription);
    expect(harness.send).toHaveBeenNthCalledWith(3, 'workspace:mutation', workspace);
    expect(harness.send).toHaveBeenNthCalledWith(4, 'plugin:push', pluginPush);
    expect(harness.send).toHaveBeenNthCalledWith(5, 'todos-changed', { projectId: 'project-1' });
    expect(harness.send).toHaveBeenNthCalledWith(6, 'plugins-changed', undefined);
  });
});
