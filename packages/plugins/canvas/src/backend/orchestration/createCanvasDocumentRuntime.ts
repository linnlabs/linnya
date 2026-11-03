import { createWorkspaceService, publishWorkspaceDocumentUpdated, Logger } from '@plugin/backend/workspaceRuntime';
import { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import {
  CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE, CANVAS_CHANGED_CHANNEL, CANVAS_GROUPS_CHANGED_CHANNEL, CanvasRendererCommitRequestSchema,
  type CanvasSnapshot, type CanvasUndoRequest, type CanvasCommitRequest, CANVAS_HISTORY_BUDGET_CHANNEL, CANVAS_RESTORED_CHANNEL,
} from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { initializeCanvasDocument, readCanvasSnapshot, canvasSourceKey, readCanvasSynchronization, updateCanvasEditingClaim } from '../features/canvasCommit';
import { createCanvasHistoryRuntime } from './history/createCanvasHistoryRuntime';
import { createCanvasVersionHistoryRuntime } from '../features/canvasVersionHistory';
import { createCanvasVersionHistoryPorts } from '../adapters/createCanvasVersionHistoryPorts';
import { createCanvasVersionActions } from './createCanvasVersionActions';
import { readCanvasDocumentIdentity, CanvasDocumentFailure } from '../features/canvasDocument';
import { findCanvasAgentGroup } from '../features/agentChanges';
import { createCanvasTextSnapshots } from './createCanvasTextSnapshots';
import { createCanvasDocumentCommitParticipants } from '../adapters/createCanvasDocumentCommitParticipants';
import { readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasDocument } from '../features/canvasProjection';

export function createCanvasDocumentRuntime(database: CanvasDatabase, references = createDocumentReferenceMarkdownRuntime(database)) {
  const logger = new Logger('Canvas');
  const workspace = createWorkspaceService(database);
  const textSnapshots = createCanvasTextSnapshots(database);
  const views = new Map<string, string>();
  let active = true;
  const assertActive = () => { if (!active) throw new CanvasDocumentFailure('runtime_closed', '画布运行态已停用，请重新打开后重试'); };
  const versionPorts = createCanvasVersionHistoryPorts({ database, retainedElements: documentId => editing.retainedElements(documentId),
    budgetChanged: status => broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_HISTORY_BUDGET_CHANNEL, status) });
  const versions = createCanvasVersionHistoryRuntime({ database, ports: versionPorts.ports });
  const admission = createCanvasDocumentCommitParticipants(database, references);
  const editing: ReturnType<typeof createCanvasHistoryRuntime> = createCanvasHistoryRuntime({ database,
    pendingApproval: admission.pendingApproval,
    groupsChanged(documentId) { versions.requestMaintenance(documentId); broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_GROUPS_CHANGED_CHANNEL, { documentId }); },
    ports: {
    participants: admission.participants,
    history(input) {
      const beforeGroup = input.context.actor.source.kind === 'agent' && !findCanvasAgentGroup(database, input.context.documentId, canvasSourceKey(input.context.actor));
      return versions.recordCommit(input, { beforeGroup });
    },
    publish(plan, context) {
      const node = readCanvasDocumentIdentity(database, context.documentId);
      textSnapshots.schedule(context.documentId);
      broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, { documentId: context.documentId, sequence: plan.state.sequence });
      publishWorkspaceDocumentUpdated({ documentId: context.documentId, projectId: node.projectId, nodeType: CANVAS_DOCUMENT_TYPE,
        mutationKind: 'incremental', versionNumber: plan.state.sequence });
    },
    publicationFailed(error) { logger.error('Canvas 已提交，后续通知失败；客户端须按序号补拉', { error }); },
  } });

  const history = createCanvasVersionActions({ database, versions, editing, hasView: (documentId, viewId) => active && views.get(viewId) === documentId,
    restored(event) { try { broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_RESTORED_CHANNEL, event); } catch (error) { logger.error('Canvas版本已恢复，恢复通知失败', { error, documentId: event.documentId }); } } });
  function read(documentId: string, projectId?: string, viewId?: string): CanvasSnapshot {
    assertActive(); readCanvasDocumentIdentity(database, documentId, projectId);
    if (viewId) { editing.registerView({ documentId, viewId }); views.set(viewId, documentId); }
    return readCanvasSnapshot(database, documentId);
  }
  function create(input: { readonly projectId: string; readonly parentId: string | null; readonly name: string; readonly content?: string }): string {
    assertActive();
    if (input.content?.trim()) throw new CanvasDocumentFailure('projection_read_only', '创建空画布后用 linnya-canvas apply 添加内容；不能把投影当文件覆写');
    let documentId = '';
    database.transaction(() => {
      const node = workspace.createNode({ type: CANVAS_DOCUMENT_TYPE, name: input.name, projectId: input.projectId, parentId: input.parentId });
      documentId = node.id;
      initializeCanvasDocument(database, documentId); versions.initialize(documentId);
      textSnapshots.refresh(documentId);
    }).immediate();
    return documentId;
  }
  function commit(payload: unknown) {
    const { viewId, historyGroupId, ...request } = CanvasRendererCommitRequestSchema.parse(payload);
    return commitUser(request, viewId, historyGroupId);
  }
  function commitUser(request: CanvasCommitRequest, viewId: string, historyGroupId?: string) {
    assertActive(); readCanvasDocumentIdentity(database, request.documentId);
    if (!views.has(viewId)) views.set(viewId, request.documentId);
    return editing.commit({ request, actor: { source: { kind: 'user', conversationId: null, runId: null }, viewId }, historyGroupId, now: Date.now() });
  }
  function undo(request: CanvasUndoRequest) {
    assertActive(); readCanvasDocumentIdentity(database, request.documentId);
    return editing.undo(request, Date.now());
  }
  function project(documentId: string): string {
    const snapshot = read(documentId);
    return projectCanvasDocument(snapshot, readCanvasProjectionContext(database, snapshot));
  }
  function changes(documentId: string, afterSequence: number) {
    assertActive(); readCanvasDocumentIdentity(database, documentId);
    return readCanvasSynchronization(database, { documentId, afterSequence });
  }
  function protect(input: { documentId: string; viewId: string; elementId: string; fields: readonly string[] }) {
    assertActive(); readCanvasDocumentIdentity(database, input.documentId);
    updateCanvasEditingClaim(database, { ...input, now: Date.now() });
  }
  function close(documentId: string, viewId: string) {
    try { textSnapshots.refresh(documentId); versions.close(documentId); }
    finally { if (views.get(viewId) === documentId) { editing.releaseView(viewId); views.delete(viewId); } }
  }
  function dispose() {
    if (!active) return; active = false;
    textSnapshots.flush();
    for (const [viewId, documentId] of views) { versions.close(documentId); editing.releaseView(viewId); }
    views.clear(); versions.dispose();
  }
  return { create, read, commit, commitUser, undo, changes, project, protect, close, dispose, refreshTextSnapshot: textSnapshots.refresh, editing, references, versions, history, pendingAssetIds: versionPorts.pendingAssetIds,
  };
}
export type CanvasDocumentRuntime = ReturnType<typeof createCanvasDocumentRuntime>;
