import { createWorkspaceService } from '@plugin/backend/workspaceRuntime';
import {
  CANVAS_DOCUMENT_TYPE,
  CanvasRendererCommitRequestSchema,
  type CanvasUndoRequest,
  type CanvasCommitRequest,
} from '../../shared';
import {
  initializeCanvasDocument,
  replaceCanvasEditingClaims,
  type CanvasEditingClaim,
} from '../features/canvasCommit';
import { readCanvasDocumentIdentity, CanvasDocumentFailure } from '../features/canvasDocument';
import type { CanvasDocumentWriteDependencies } from '../definitions/canvasDocumentCommands';
/** 用户文档动作与视图写准入共用正式提交链；Agent提交仍由独立历史入口接纳。 */
export function createCanvasDocumentWrites(options: CanvasDocumentWriteDependencies) {
  const { database, assertActive, views, editing, versions, textSnapshots } = options;
  const workspace = createWorkspaceService(database);
  function create(input: {
    readonly projectId: string;
    readonly parentId: string | null;
    readonly name: string;
    readonly content?: string;
  }): string {
    assertActive();
    if (input.content?.trim())
      throw new CanvasDocumentFailure(
        'projection_read_only',
        '创建空画布后用 linnya-canvas apply 添加内容；不能把投影当文件覆写'
      );
    let documentId = '';
    database
      .transaction(() => {
        const node = workspace.createNode({
          type: CANVAS_DOCUMENT_TYPE,
          name: input.name,
          projectId: input.projectId,
          parentId: input.parentId,
        });
        documentId = node.id;
        initializeCanvasDocument(database, documentId);
        versions.initialize(documentId);
        textSnapshots.refresh(documentId);
      })
      .immediate();
    return documentId;
  }
  function commit(payload: unknown) {
    const { viewId, historyGroupId, ...request } = CanvasRendererCommitRequestSchema.parse(payload);
    return commitUser(request, viewId, historyGroupId);
  }
  function commitUser(request: CanvasCommitRequest, viewId: string, historyGroupId?: string) {
    assertActive();
    readCanvasDocumentIdentity(database, request.documentId);
    if (!views.has(request.documentId, viewId))
      throw new CanvasDocumentFailure('view_closed', '画布视图已关闭，请重新打开后重试');
    return editing.commit({
      request,
      actor: { source: { kind: 'user', conversationId: null, runId: null }, viewId },
      historyGroupId,
      now: Date.now(),
    });
  }
  function undo(request: CanvasUndoRequest) {
    assertActive();
    readCanvasDocumentIdentity(database, request.documentId);
    return editing.undo(request, Date.now());
  }
  function protect(input: {
    documentId: string;
    viewId: string;
    claims: readonly CanvasEditingClaim[];
  }) {
    assertActive();
    readCanvasDocumentIdentity(database, input.documentId);
    if (!views.has(input.documentId, input.viewId))
      throw new CanvasDocumentFailure('view_closed', '画布视图已关闭，请重新打开后重试');
    replaceCanvasEditingClaims(database, { ...input, now: Date.now() });
  }
  return { create, commit, commitUser, undo, protect };
}
