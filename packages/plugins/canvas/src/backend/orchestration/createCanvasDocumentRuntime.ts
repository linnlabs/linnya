import { createCanvasGroupNotifications } from '../features/agentChanges';
import { createWorkspaceService, publishWorkspaceDocumentUpdated, Logger } from '@plugin/backend/workspaceRuntime';
import { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import {
  CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE, CANVAS_CHANGED_CHANNEL, CANVAS_GROUPS_CHANGED_CHANNEL, CanvasRendererCommitRequestSchema,
  type CanvasSnapshot, type CanvasUndoRequest, type CanvasCommitRequest, CANVAS_HISTORY_BUDGET_CHANNEL, CANVAS_RESTORED_CHANNEL,
} from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { initializeCanvasDocument, readCanvasSnapshot, readCanvasSynchronization, replaceCanvasEditingClaims, type CanvasEditingClaim } from '../features/canvasCommit';
import { createCanvasHistoryRuntime } from './history/createCanvasHistoryRuntime';
import { createCanvasVersionHistoryRuntime } from '../features/canvasVersionHistory';
import { createCanvasVersionHistoryPorts } from '../adapters/createCanvasVersionHistoryPorts';
import { createCanvasVersionActions } from './createCanvasVersionActions';
import { readCanvasDocumentIdentity, CanvasDocumentFailure } from '../features/canvasDocument';
import { createCanvasTextSnapshots } from './createCanvasTextSnapshots';
import { createCanvasDocumentCommitParticipants } from '../adapters/createCanvasDocumentCommitParticipants';
import { readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasDocument } from '../features/canvasProjection';
import type { BackendPluginRendererContext } from '@plugin/backend/pluginIpcRuntime';
import { createCanvasViewLifecycle } from '../features/canvasDocument';

export function createCanvasDocumentRuntime(database: CanvasDatabase, references = createDocumentReferenceMarkdownRuntime(database)) {
  const logger = new Logger('Canvas');
  const groupNotifications = createCanvasGroupNotifications({ publish: documentId => broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_GROUPS_CHANGED_CHANNEL, { documentId }),
    failed(error, documentId) { logger.error('Canvas 写入静默通知失败', { documentId, error }); } });
  const workspace = createWorkspaceService(database);
  const textSnapshots = createCanvasTextSnapshots(database);
  const viewClosed = new Set<(documentId: string, viewId: string) => void>();
  const views = createCanvasViewLifecycle({ closed(documentId, viewId, lastView) {
    for (const listener of viewClosed) listener(documentId, viewId);
    editing.releaseView(viewId);
    if (active && lastView) { textSnapshots.refresh(documentId); versions.close(documentId); }
  }, failed(error, documentId) { logger.error('释放 Canvas 视图失败', { documentId, error }); } });
  let active = true;
  const assertActive = () => { if (!active) throw new CanvasDocumentFailure('runtime_closed', '画布运行态已停用，请重新打开后重试'); };
  const versionPorts = createCanvasVersionHistoryPorts({ database, retainedElements: documentId => editing.retainedElements(documentId),
    budgetChanged: status => broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_HISTORY_BUDGET_CHANNEL, status) });
  const versions = createCanvasVersionHistoryRuntime({ database, ports: versionPorts.ports });
  const admission = createCanvasDocumentCommitParticipants(database, references);
  const editing: ReturnType<typeof createCanvasHistoryRuntime> = createCanvasHistoryRuntime({ database,
    pendingApproval(batch) { assertActive(); admission.pendingApproval(batch); },
    groupStarted({ documentId, before, now }) {
      versions.checkpoint({ documentId, reason: 'agent-group', now,
        snapshot: { schemaVersion: 1, documentId, sequence: before.sequence, elements: before.elements.map(row => row.element) } });
    },
    groupsChanged(documentId, reason) {
      if (reason === 'release') versions.requestMaintenance(documentId);
      groupNotifications.changed(documentId, reason);
    },
    ports: {
    // CLI 的正文/图片准入可跨过停用时刻；最终事务统一拒绝旧运行态，不能只检查入口。
    participants: [{ commit() { assertActive(); } }, ...admission.participants],
    history: versions.recordCommit,
    publish(plan, context, publication) {
      const node = readCanvasDocumentIdentity(database, context.documentId);
      textSnapshots.schedule(context.documentId);
      broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, { documentId: context.documentId, sequence: plan.state.sequence,
        committedAt: publication.committedAt, sourceKind: context.actor.source.kind, changedElementCount: new Set(plan.changes.map(change => change.id)).size });
      publishWorkspaceDocumentUpdated({ documentId: context.documentId, projectId: node.projectId, nodeType: CANVAS_DOCUMENT_TYPE,
        mutationKind: 'incremental', versionNumber: plan.state.sequence });
    },
    publicationFailed(error) { logger.error('Canvas 已提交，后续通知失败；客户端须按序号补拉', { error }); },
  } });

  const history = createCanvasVersionActions({ database, versions, editing, hasView: (documentId, viewId) => active && views.has(documentId, viewId),
    restored(event) { try { broadcastRendererPluginMessage(CANVAS_PLUGIN_ID, CANVAS_RESTORED_CHANNEL, event); } catch (error) { logger.error('Canvas版本已恢复，恢复通知失败', { error, documentId: event.documentId }); } } });
  function assertDocument(documentId: string, projectId?: string) {
    assertActive(); return readCanvasDocumentIdentity(database, documentId, projectId);
  }
  function read(documentId: string, projectId?: string, viewId?: string, context?: BackendPluginRendererContext): CanvasSnapshot {
    assertDocument(documentId, projectId);
    if (viewId) { views.register(documentId, viewId, context); editing.registerView({ documentId, viewId }); }
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
    if (!views.has(request.documentId, viewId)) throw new CanvasDocumentFailure('view_closed', '画布视图已关闭，请重新打开后重试');
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
  function protect(input: { documentId: string; viewId: string; claims: readonly CanvasEditingClaim[] }) {
    assertActive(); readCanvasDocumentIdentity(database, input.documentId);
    if (!views.has(input.documentId, input.viewId)) throw new CanvasDocumentFailure('view_closed', '画布视图已关闭，请重新打开后重试');
    replaceCanvasEditingClaims(database, { ...input, now: Date.now() });
  }
  function close(documentId: string, viewId: string) {
    views.close(documentId, viewId);
  }
  function dispose() {
    if (!active) return; active = false;
    groupNotifications.dispose(); textSnapshots.flush();
    views.dispose(); viewClosed.clear(); versions.dispose();
  }
  return { create, read, assertDocument, commit, commitUser, undo, changes, project, protect, close, dispose, onViewClosed(listener: (documentId: string, viewId: string) => void) { viewClosed.add(listener); return () => viewClosed.delete(listener); }, refreshTextSnapshot: textSnapshots.refresh, editing, references, versions, history, pendingAssetIds: versionPorts.pendingAssetIds,
  };
}
export type CanvasDocumentRuntime = ReturnType<typeof createCanvasDocumentRuntime>;
