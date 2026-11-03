import { createWorkspaceService, publishWorkspaceDocumentUpdated, Logger } from '@plugin/backend/workspaceRuntime';
import { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import {
  CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE, CANVAS_CHANGED_CHANNEL, CANVAS_GROUPS_CHANGED_CHANNEL, CanvasRendererCommitRequestSchema,
  type CanvasSnapshot, type CanvasUndoRequest, type CanvasCommitRequest,
} from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { initializeCanvasDocument, readCanvasSnapshot, readCanvasSynchronization, updateCanvasEditingClaim } from '../features/canvasCommit';
import { createCanvasHistoryRuntime } from '../features/canvasUndoHistory';
import { collectCanvasCommandAssetIds, readCanvasDocumentIdentity, CanvasDocumentFailure } from '../features/canvasDocument';
import { readCanvasPendingBatches } from '../features/agentChanges';
import { createCanvasTextSnapshots } from './createCanvasTextSnapshots';
import { createCanvasDocumentCommitParticipants } from '../adapters/createCanvasDocumentCommitParticipants';
import { readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasDocument } from '../features/canvasProjection';

export function createCanvasDocumentRuntime(database: CanvasDatabase, references = createDocumentReferenceMarkdownRuntime(database)) {
  const logger = new Logger('Canvas');
  const workspace = createWorkspaceService(database);
  const textSnapshots = createCanvasTextSnapshots(database);
  const views = new Set<string>();
  const admission = createCanvasDocumentCommitParticipants(database, references);
  const editing: ReturnType<typeof createCanvasHistoryRuntime> = createCanvasHistoryRuntime({ database,
    pendingApproval: admission.pendingApproval,
    groupsChanged(documentId) { broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_GROUPS_CHANGED_CHANNEL, { documentId }); },
    ports: {
    participants: admission.participants,
    publish(plan, context) {
      const node = readCanvasDocumentIdentity(database, context.documentId);
      textSnapshots.schedule(context.documentId);
      broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, { documentId: context.documentId, sequence: plan.state.sequence });
      publishWorkspaceDocumentUpdated({ documentId: context.documentId, projectId: node.projectId, nodeType: CANVAS_DOCUMENT_TYPE,
        mutationKind: 'incremental', versionNumber: plan.state.sequence });
    },
    publicationFailed(error) { logger.error('Canvas 已提交，后续通知失败；客户端须按序号补拉', { error }); },
  } });

  function read(documentId: string, projectId?: string, viewId?: string): CanvasSnapshot {
    readCanvasDocumentIdentity(database, documentId, projectId);
    if (viewId) { editing.registerView({ documentId, viewId }); views.add(viewId); }
    return readCanvasSnapshot(database, documentId);
  }
  function create(input: { readonly projectId: string; readonly parentId: string | null; readonly name: string; readonly content?: string }): string {
    if (input.content?.trim()) throw new CanvasDocumentFailure('projection_read_only', '创建空画布后用 linnya-canvas apply 添加内容；不能把投影当文件覆写');
    let documentId = '';
    database.transaction(() => {
      const node = workspace.createNode({ type: CANVAS_DOCUMENT_TYPE, name: input.name, projectId: input.projectId, parentId: input.parentId });
      documentId = node.id;
      initializeCanvasDocument(database, documentId);
      textSnapshots.refresh(documentId);
    }).immediate();
    return documentId;
  }
  function commit(payload: unknown) {
    const { viewId, historyGroupId, ...request } = CanvasRendererCommitRequestSchema.parse(payload);
    return commitUser(request, viewId, historyGroupId);
  }
  function commitUser(request: CanvasCommitRequest, viewId: string, historyGroupId?: string) {
    readCanvasDocumentIdentity(database, request.documentId);
    views.add(viewId);
    return editing.commit({ request, actor: { source: { kind: 'user', conversationId: null, runId: null }, viewId }, historyGroupId, now: Date.now() });
  }
  function undo(request: CanvasUndoRequest) {
    readCanvasDocumentIdentity(database, request.documentId);
    return editing.undo(request, Date.now());
  }
  function project(documentId: string): string {
    const snapshot = read(documentId);
    return projectCanvasDocument(snapshot, readCanvasProjectionContext(database, snapshot));
  }
  function changes(documentId: string, afterSequence: number) {
    readCanvasDocumentIdentity(database, documentId);
    return readCanvasSynchronization(database, { documentId, afterSequence });
  }
  function protect(input: { documentId: string; viewId: string; elementId: string; fields: readonly string[] }) {
    readCanvasDocumentIdentity(database, input.documentId);
    updateCanvasEditingClaim(database, { ...input, now: Date.now() });
  }
  function close(documentId: string, viewId: string) {
    try { textSnapshots.refresh(documentId); }
    finally { editing.releaseView(viewId); views.delete(viewId); }
  }
  function dispose() {
    textSnapshots.flush();
    for (const view of views) editing.releaseView(view);
    views.clear();
  }
  return { create, read, commit, commitUser, undo, changes, project, protect, close, dispose, refreshTextSnapshot: textSnapshots.refresh, editing, references, pendingAssetIds: (documentId: string) => [...new Set(readCanvasPendingBatches(database, documentId).flatMap(batch => collectCanvasCommandAssetIds(batch.request.operations)))],
  };
}
export type CanvasDocumentRuntime = ReturnType<typeof createCanvasDocumentRuntime>;
