import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import type { BackendRendererIntegrationPort } from '../../../definitions/backendRendererIntegrationPort';
import { KnowledgeTaskStatusViewSchema, KnowledgeGraphProgressSchema } from '@plugin/knowledge/shared';
import { DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD } from '../definitions/rendererIntegrationRpc';
import { createBackendRendererIntegrationRpcClient } from '../orchestration/createBackendRendererIntegrationRpcClient';
import { createDesktopRendererIntegrationRpcHandlers } from '../orchestration/createDesktopRendererIntegrationRpcHandlers';

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
    client.publishWorkspaceMutation({
      type: 'project.created',
      mutationId: 'project-mutation',
      projectId: 'another-project',
    });
    client.publishWorkspaceMutation({
      type: 'project.deleted',
      mutationId: 'project-deleted',
      projectId: 'another-project',
    });
    client.publishPluginRendererPush({
      pluginId: 'slides',
      channel: 'slides:export-progress',
      payload: { progress: 75 },
    });
    client.publishTodosChanged('project-1');
    client.publishPluginsChanged();
    client.publishPluginDataChanged('demo');
    client.publishModelsChanged();
    client.publishConversationActivityChanged();

    await vi.waitFor(() => {
      expect(port.publishPluginsChanged).toHaveBeenCalledOnce();
      expect(port.publishPluginDataChanged).toHaveBeenCalledExactlyOnceWith('demo');
      expect(port.publishModelsChanged).toHaveBeenCalledOnce();
      expect(port.publishConversationActivityChanged).toHaveBeenCalledOnce();
    });
    expect(port.connectModelCatalogUpdates).toHaveBeenCalledOnce();
    expect(port.publishTranscriptionProgress).toHaveBeenCalledWith({
      stage: 'merge',
      percent: 80,
      message: '合并中',
      timestamp: 456,
    });
    expect(port.publishWorkspaceMutation).toHaveBeenCalledTimes(3);
    expect(port.publishWorkspaceMutation).toHaveBeenCalledWith({
      type: 'project.created',
      mutationId: 'project-mutation',
      projectId: 'another-project',
    });
    expect(port.publishWorkspaceMutation).toHaveBeenCalledWith({
      type: 'project.deleted',
      mutationId: 'project-deleted',
      projectId: 'another-project',
    });
    expect(port.publishPluginRendererPush).toHaveBeenCalledOnce();
    expect(port.publishTodosChanged).toHaveBeenCalledWith('project-1');
    expect(failures).toEqual([]);

    disposeModelCatalog();
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    pair.dispose();
  });

  it('知识库正式任务与图谱schema经通用plugin push往返，可选undefined按JSON省略', async () => {
    const port = createRendererPort();
    const pair = createPeerPair(port);
    const failures: Error[] = [];
    const client = createBackendRendererIntegrationRpcClient({ rpc: pair.backend, onAsyncFailure: error => failures.push(error) });
    try {
      for (const status of ['processing', 'completed', 'failed']) {
        const payload = KnowledgeTaskStatusViewSchema.parse({
          taskId: `task-${status}`, docId: 'doc-1', status, progress: status === 'completed' ? 100 : 35,
          stage: status === 'processing' ? 'parsing' : status, stage_progress: undefined,
          message: status, error: status === 'failed' ? 'provider unavailable' : undefined, updatedAt: 123,
          estimatedTimeRemaining: undefined,
        });
        client.publishPluginRendererPush({ pluginId: 'knowledge', channel: 'task-status-updated', payload });
      }
      const graph = KnowledgeGraphProgressSchema.parse({ kbId: 'kb-1', percent: 50, totalUnits: 4, doneUnits: 2, updatedAtSeconds: 123 });
      client.publishPluginRendererPush({ pluginId: 'knowledge', channel: 'graph-progress-updated', payload: graph });
      await vi.waitFor(() => expect(port.publishPluginRendererPush).toHaveBeenCalledTimes(4));
      expect(port.publishPluginRendererPush).toHaveBeenNthCalledWith(1, {
        pluginId: 'knowledge', channel: 'task-status-updated',
        payload: { taskId: 'task-processing', docId: 'doc-1', status: 'processing', progress: 35, stage: 'parsing', message: 'processing', updatedAt: 123 },
      });
      expect(port.publishPluginRendererPush).toHaveBeenNthCalledWith(3, {
        pluginId: 'knowledge', channel: 'task-status-updated',
        payload: { taskId: 'task-failed', docId: 'doc-1', status: 'failed', progress: 35, stage: 'failed', message: 'failed', error: 'provider unavailable', updatedAt: 123 },
      });
      expect(port.publishPluginRendererPush).toHaveBeenLastCalledWith({ pluginId: 'knowledge', channel: 'graph-progress-updated', payload: graph });
      expect(failures).toEqual([]);
    } finally { pair.dispose(); }
  });

  it('无效通知交给现有诊断口，不能让任务失败回报再次抛错', () => {
    const request = vi.fn();
    const failures: Error[] = [];
    const client = createBackendRendererIntegrationRpcClient({
      rpc: { request },
      onAsyncFailure: error => failures.push(error),
    });
    for (const payload of [{ score: Number.NaN }, { values: [undefined] }]) {
      expect(() => client.publishPluginRendererPush({ pluginId: 'knowledge', channel: 'task-status-updated', payload })).not.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
    expect(failures).toHaveLength(2);
  });

  it('Desktop handler 严格拒绝错型 payload', async () => {
    const handlers = createDesktopRendererIntegrationRpcHandlers(createRendererPort());
    const handler = handlers.get(DESKTOP_RENDERER_TODOS_CHANGED_RPC_METHOD);
    if (!handler) throw new Error('todos changed handler 未注册');

    expect(() =>
      handler(
        { projectId: 123 },
        {
          requestId: 'invalid-payload',
          signal: new AbortController().signal,
        }
      )
    ).toThrow();
  });
});

function createRendererPort(
  connectModelCatalogUpdates = async (): Promise<() => void> => () => undefined
): BackendRendererIntegrationPort {
  return {
    connectModelCatalogUpdates: vi.fn(connectModelCatalogUpdates),
    publishTranscriptionProgress: vi.fn(),
    publishWorkspaceMutation: vi.fn(),
    publishPluginRendererPush: vi.fn(),
    publishTodosChanged: vi.fn(),
    publishModelsChanged: vi.fn(),
    publishConversationActivityChanged: vi.fn(),
    publishPluginsChanged: vi.fn(),
    publishPluginDataChanged: vi.fn(),
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
