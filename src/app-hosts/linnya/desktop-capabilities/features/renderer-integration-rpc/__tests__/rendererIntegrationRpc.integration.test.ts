import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import type { BackendRendererIntegrationPort } from '../../../definitions/backendRendererIntegrationPort';
import {
  FrontendStatus,
  InternalStage,
} from '../../../../../../features/knowledge-base/ingestion/definitions/state';
import { DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD } from '../definitions/rendererIntegrationRpc';
import { createBackendRendererIntegrationRpcClient } from '../orchestration/createBackendRendererIntegrationRpcClient';
import { createDesktopRendererIntegrationRpcHandlers } from '../orchestration/createDesktopRendererIntegrationRpcHandlers';

const LEGACY_INGESTION_ID_FIELD = resolveLegacyIngestionIdField();

function resolveLegacyIngestionIdField(): 'taskId' {
  return 'taskId';
}

describe('Backend Renderer integration RPC', () => {
  it('保持既有业务 port 与投影事实，不把 channel 选择交给 Backend', async () => {
    const disconnect = vi.fn();
    const port = createRendererPort(async () => disconnect);
    const pair = createPeerPair(port);
    const failures: Error[] = [];
    const client = createBackendRendererIntegrationRpcClient({
      rpc: pair.backend,
      onAsyncFailure: error => failures.push(error),
    });

    const disposeModelCatalog = await client.connectModelCatalogUpdates();
    client.publishKnowledgeGraphProgress({
      kbId: 'kb-1',
      percent: 50,
      totalUnits: 4,
      doneUnits: 2,
      updatedAtSeconds: 123,
    });
    client.publishTranscriptionProgress({
      stage: 'merge',
      percent: 80,
      message: '合并中',
      timestamp: 456,
    });
    client.publishWorkspaceMutation({
      type: 'workspace.document.updated',
      mutationId: 'mutation-1',
      source: 'tool',
      projectId: 'project-1',
      documentId: 'document-1',
      nodeType: 'markdown',
      mutationKind: 'pending',
    });
    client.publishPluginRendererPush({
      pluginId: 'slides',
      channel: 'slides:export-progress',
      payload: { progress: 75 },
    });
    client.publishTodosChanged('project-1');
    client.publishPluginsChanged();

    await vi.waitFor(() => {
      expect(port.publishPluginsChanged).toHaveBeenCalledOnce();
    });
    expect(port.connectModelCatalogUpdates).toHaveBeenCalledOnce();
    expect(port.publishKnowledgeGraphProgress).toHaveBeenCalledWith({
      kbId: 'kb-1',
      percent: 50,
      totalUnits: 4,
      doneUnits: 2,
      updatedAtSeconds: 123,
    });
    expect(port.publishTranscriptionProgress).toHaveBeenCalledWith({
      stage: 'merge',
      percent: 80,
      message: '合并中',
      timestamp: 456,
    });
    expect(port.publishWorkspaceMutation).toHaveBeenCalledOnce();
    expect(port.publishPluginRendererPush).toHaveBeenCalledOnce();
    expect(port.publishTodosChanged).toHaveBeenCalledWith('project-1');
    expect(failures).toEqual([]);

    disposeModelCatalog();
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    pair.dispose();
  });

  it('往返 ingestion 与三种 queue job 事实', async () => {
    const port = createRendererPort();
    const pair = createPeerPair(port);
    const failures: Error[] = [];
    const client = createBackendRendererIntegrationRpcClient({
      rpc: pair.backend,
      onAsyncFailure: error => failures.push(error),
    });

    client.publishIngestionStatus({
      [LEGACY_INGESTION_ID_FIELD]: 'task-1',
      docId: 'doc-1',
      filename: 'a.pdf',
      stage: InternalStage.PARSING,
      frontendState: {
        status: FrontendStatus.PROCESSING,
        stage: InternalStage.PARSING,
        progress: 35,
        stage_progress: 70,
        message: '解析中',
        doc_id: 'doc-1',
        filename: 'a.pdf',
        updated_at: 123,
      },
    });
    client.queueJobPresentationPublisher.publishProgress({
      jobId: 'task-1',
      progress: 35,
      data: { status: 'processing' },
    });
    client.queueJobPresentationPublisher.publishCompletion({
      jobId: 'task-1',
      result: { docId: 'doc-1' },
    });
    client.queueJobPresentationPublisher.publishFailure({
      jobId: 'task-2',
      jobData: { docId: 'doc-2' },
      errorMessage: 'boom',
      failedMessage: '处理失败',
    });

    await vi.waitFor(() => {
      expect(port.queueJobPresentationPublisher.publishFailure).toHaveBeenCalledOnce();
    });
    expect(port.publishIngestionStatus).toHaveBeenCalledOnce();
    expect(port.queueJobPresentationPublisher.publishProgress).toHaveBeenCalledOnce();
    expect(port.queueJobPresentationPublisher.publishCompletion).toHaveBeenCalledOnce();
    expect(failures).toEqual([]);
    pair.dispose();
  });

  it('Desktop handler 严格拒绝错型 payload', async () => {
    const handlers = createDesktopRendererIntegrationRpcHandlers(createRendererPort());
    const handler = handlers.get(DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD);
    if (!handler) throw new Error('todos changed handler 未注册');

    expect(() => handler({ projectId: 123 }, {
      requestId: 'invalid-payload',
      signal: new AbortController().signal,
    })).toThrow();
  });
});

function createRendererPort(
  connectModelCatalogUpdates = async (): Promise<() => void> => () => undefined,
): BackendRendererIntegrationPort {
  return {
    connectModelCatalogUpdates: vi.fn(connectModelCatalogUpdates),
    publishIngestionStatus: vi.fn(),
    queueJobPresentationPublisher: {
      publishProgress: vi.fn(),
      publishCompletion: vi.fn(),
      publishFailure: vi.fn(),
    },
    publishKnowledgeGraphProgress: vi.fn(),
    publishTranscriptionProgress: vi.fn(),
    publishWorkspaceMutation: vi.fn(),
    publishPluginRendererPush: vi.fn(),
    publishTodosChanged: vi.fn(),
    publishPluginsChanged: vi.fn(),
  };
}

function createPeerPair(port: BackendRendererIntegrationPort) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: createDesktopRendererIntegrationRpcHandlers(port),
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: new Map(),
  });
  return {
    desktop,
    backend,
    dispose() {
      desktop.dispose();
      backend.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}
