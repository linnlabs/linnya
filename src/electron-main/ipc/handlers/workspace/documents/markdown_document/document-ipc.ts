/**
 * @file src/electron-main/ipc/handlers/documents/markdown_document/document-ipc.ts
 * @description 文档读写 IPC 通道处理器（按 node.type 路由）+ MarkdownDocument 专属操作（批注等）
 */

import { MarkdownDocumentService } from 'src/domains/markdown';
import { PendingRevisionApplyService } from 'src/domains/markdown';
import type { BackendRuntimeOwner } from '../../../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import { WorkspaceService } from '../../../../../services/workspace/workspace';
import { Logger } from '../../../../../../shared/logger';
import { isUsingNewDatabase } from '../../../../../config/feature-flags';
import { createWorkspaceMutationPublisher } from '../../../../../../features/workspace/orchestration/workspaceMutationPublisherRegistry';
import { createWorkspaceDocumentUpdatedEvent } from '../../../../../../features/workspace/functions/createWorkspaceDocumentMutationEvent';
import { readWorkspaceEditorDocument } from '../../../../../../features/workspace/document-editor/orchestration/readWorkspaceEditorDocument';
import { writeWorkspaceEditorDocument } from '../../../../../../features/workspace/document-editor/orchestration/writeWorkspaceEditorDocument';
import { createWorkspaceDocumentEditorProviderResolver } from '../../../../../../app-hosts/linnya/adapters/document-editor/createWorkspaceDocumentEditorProviderResolver';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../../../app-hosts/linnya/adapters/backend-renderer-requests';

const logger = new Logger('DocumentIPC');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAnnotationPosition(
  value: unknown,
): value is Readonly<{ top: number; left: number }> {
  return isRecord(value)
    && typeof value.top === 'number'
    && typeof value.left === 'number';
}

export function registerMarkdownDocumentHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  logger.info('🔌 [IPC-LIFECYCLE] REGISTER | Registering Document IPC handlers (with type routing)...');

  const services = runtimeOwner.getServices();
  const databaseService = services.databaseService;
  const workspaceMutationPublisher = createWorkspaceMutationPublisher();

  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | ❌ DatabaseService not available!');
    throw new Error('DatabaseService not available for Document handlers');
  }

  // ============================================================================
  // 文档 Editor 操作由 Workspace feature 确认节点，Host provider 负责文档类型分派。
  // ============================================================================

  /**
   * 读取文档内容。
   * 这里只保留 IPC admission 和结果封装，不解释 Markdown 或插件内部格式。
   */
  ipcMain.handle('workspace:read-document', async (event, { documentId }) => {
    try {
      if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
      const db = databaseService.getDb();

      const workspaceService = new WorkspaceService(db);
      const result = await readWorkspaceEditorDocument({
        documentId,
        workspaceService,
        resolveProvider: createWorkspaceDocumentEditorProviderResolver({
          db,
          mutationPublisher: workspaceMutationPublisher,
        }),
      });

      return {
        success: true,
        data: result,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:read-document] Error:', error);
      return { success: false, error: message };
    }
  });

  /**
   * 保存文档内容。
   * 路由逻辑同 read-document。
   */
  ipcMain.handle('workspace:save-document', async (event, { documentId, content }) => {
    try {
      if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
      const db = databaseService.getDb();

      const workspaceService = new WorkspaceService(db);
      const result = await writeWorkspaceEditorDocument({
        documentId,
        content,
        workspaceService,
        resolveProvider: createWorkspaceDocumentEditorProviderResolver({
          db,
          mutationPublisher: workspaceMutationPublisher,
        }),
      });
      logger.info(`[workspace:save-document] editor content saved: nodeId=${documentId}, version=${result.versionNumber ?? 'n/a'}`);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:save-document] Error:', error);
      return { success: false, error: message };
    }
  });

  // ============================================================================
  // Pending Revisions（AI 修订意图）操作
  // ============================================================================

  /**
   * 清理指定块的 pending revision
   */
  ipcMain.handle(
    'workspace:clear-pending-revision',
    async (event, { documentId, blockId }: { documentId: string; blockId: string }) => {
      try {
        if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
        const db = databaseService.getDb();
        const documentService = new MarkdownDocumentService(db);
        const deletedCount = documentService.clearPendingRevision(documentId, blockId);
        return { success: true, data: { deletedCount } };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:clear-pending-revision] Error:', error);
        return { success: false, error: message };
      }
    }
  );

  /**
   * 清理文档下所有 pending revisions
   *
   * 场景：用户接受/拒绝全部修订后调用
   */
  ipcMain.handle(
    'workspace:clear-all-pending-revisions',
    async (event, { documentId }: { documentId: string }) => {
      try {
        if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
        const db = databaseService.getDb();
        const documentService = new MarkdownDocumentService(db);
        const deletedCount = documentService.clearAllPendingRevisions(documentId);
        return { success: true, data: { deletedCount } };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:clear-all-pending-revisions] Error:', error);
        return { success: false, error: message };
      }
    }
  );

  /**
   * 文档级一次性接受/拒绝所有 pending revisions。
   *
   * 中文说明：
   * - 旧路径由前端逐块 dispatch ProseMirror transaction，超大 pending 文档会出现明显卡顿；
   * - 新路径在主进程 docJson 层完成合并，前端只需要一次 setContent；
   * - 仅允许 platform Markdown document 使用，避免把任意插件文档当成 Tiptap JSON 改写。
   */
  ipcMain.handle(
    'workspace:apply-all-pending-revisions',
    async (
      event,
      { documentId, mode }: { documentId: string; mode: 'accept' | 'reject' }
    ) => {
      try {
        if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
        if (mode !== 'accept' && mode !== 'reject') {
          return { success: false, error: `Invalid apply mode: ${mode}` };
        }

        const db = databaseService.getDb();
        const workspaceService = new WorkspaceService(db);
        const node = workspaceService.getNode(documentId);
        if (!node) {
          return { success: false, error: `Document not found: ${documentId}` };
        }
        if (node.type !== 'document') {
          return { success: false, error: `Apply pending revisions only supports document nodes: ${documentId}` };
        }

        const documentService = new MarkdownDocumentService(db);
        const applyService = new PendingRevisionApplyService(documentService);
        const result = await applyService.applyAllPendingForDocument({ documentId, mode });
        if (result.status === 'ok') {
          const latestVersion = documentService.getLatestVersion(documentId);
          workspaceMutationPublisher.publish(createWorkspaceDocumentUpdatedEvent({
            node,
            mutationKind: mode === 'accept' && result.appliedCount > 0 ? 'version' : 'pending',
            ...(mode === 'accept' && result.appliedCount > 0 && latestVersion
              ? { versionNumber: latestVersion.version_number }
              : {}),
            source: 'user',
          }));
        }
        return { success: true, data: result };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:apply-all-pending-revisions] Error:', error);
        return { success: false, error: message };
      }
    }
  );

  /**
   * 块级接受/拒绝单条 pending revision。
   *
   * 中文说明：
   * - 前端块级 Accept/Reject 已经在当前编辑器中完成局部 PM 事务；
   * - 这里在后端 docJson 层同步应用同一个 pending，并在同一个 SQLite 事务里清理 pending；
   * - 成功后前端无需再保存整篇 10000 块文档，点击延迟主要剩一次 IPC。
   */
  ipcMain.handle(
    'workspace:apply-pending-revision',
    async (
      event,
      { documentId, blockId, mode }: { documentId: string; blockId: string; mode: 'accept' | 'reject' }
    ) => {
      try {
        if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
        if (mode !== 'accept' && mode !== 'reject') {
          return { success: false, error: `Invalid apply mode: ${mode}` };
        }

        const db = databaseService.getDb();
        const workspaceService = new WorkspaceService(db);
        const node = workspaceService.getNode(documentId);
        if (!node) {
          return { success: false, error: `Document not found: ${documentId}` };
        }
        if (node.type !== 'document') {
          return { success: false, error: `Apply pending revision only supports document nodes: ${documentId}` };
        }

        const documentService = new MarkdownDocumentService(db);
        const applyService = new PendingRevisionApplyService(documentService);
        const result = await applyService.applyPendingForBlock({ documentId, blockId, mode });
        if (result.status === 'ok') {
          const latestVersion = documentService.getLatestVersion(documentId);
          workspaceMutationPublisher.publish(createWorkspaceDocumentUpdatedEvent({
            node,
            mutationKind: mode === 'accept' && result.appliedCount > 0 ? 'version' : 'pending',
            ...(mode === 'accept' && result.appliedCount > 0 && latestVersion
              ? { versionNumber: latestVersion.version_number }
              : {}),
            source: 'user',
          }));
        }
        return { success: true, data: result };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:apply-pending-revision] Error:', error);
        return { success: false, error: message };
      }
    }
  );

  /**
   * 写入/覆盖指定块的 pending revision（前端通用写入通道）
   *
   * 后端语义：同一 (documentId, blockId) 只保留一条最新记录（upsert）。
   * assertBlockExists 会校验 blockId 在 content_json 中存在。
   */
  ipcMain.handle(
    'workspace:set-pending-revision',
    async (
      event,
      { documentId, blockId, newMarkdown, source, meta }: {
        documentId: string;
        blockId: string;
        newMarkdown: string;
        source?: 'ai' | 'user' | 'tool';
        meta?: Record<string, unknown>;
      }
    ) => {
      try {
        if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
        const db = databaseService.getDb();
        const documentService = new MarkdownDocumentService(db);
        const revision = documentService.setPendingRevision(
          documentId,
          blockId,
          newMarkdown,
          source ?? 'user',
          meta
        );
        return {
          success: true,
          data: {
            id: revision.id,
            blockId: revision.target_block_id,
            newMarkdown: revision.new_markdown,
            source: revision.source,
            operation: revision.operation ?? null,
            metaJson: revision.meta_json,
            createdAt: revision.created_at,
            updatedAt: revision.updated_at,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:set-pending-revision] Error:', error);
        return { success: false, error: message };
      }
    }
  );

  /**
   * 批量写入 pending revisions（同一文档下多个块）
   *
   * 场景：测试工具批量注入、undo/redo 批量恢复等。
   * 返回成功写入的条数。
   */
  ipcMain.handle(
    'workspace:set-pending-revisions-batch',
    async (
      event,
      { documentId, revisions }: {
        documentId: string;
        revisions: Array<{
          blockId: string;
          newMarkdown: string;
          source?: 'ai' | 'user' | 'tool';
          meta?: Record<string, unknown>;
        }>;
      }
    ) => {
      try {
        if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
        const db = databaseService.getDb();
        const documentService = new MarkdownDocumentService(db);

        let writtenCount = 0;
        const errors: string[] = [];

        for (const rev of revisions) {
          try {
            documentService.setPendingRevision(
              documentId,
              rev.blockId,
              rev.newMarkdown,
              rev.source ?? 'user',
              rev.meta
            );
            writtenCount++;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${rev.blockId}: ${msg}`);
          }
        }

        return {
          success: true,
          data: { writtenCount, totalRequested: revisions.length, errors },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:set-pending-revisions-batch] Error:', error);
        return { success: false, error: message };
      }
    }
  );

  // ============================================================================
  // 批注操作
  // ============================================================================
  ipcMain.handle('workspace:list-annotations', async (event, { documentId }) => {
    try {
      if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
      const db = databaseService.getDb();
      const documentService = new MarkdownDocumentService(db);
      const rawAnnotations = documentService.getAnnotations(documentId);
      const annotations = rawAnnotations.map(anno => {
        const content: unknown = JSON.parse(anno.content_json);

        /**
         * ✅ 批注 position 字段兜底（根因修复：历史数据缺字段导致前端布局崩溃）
         *
         * 背景：
         * - 前端批注面板布局（PanelOverlapDetector 等）默认假设 annotation.position.top/left 为 number
         * - 早期写入的 annotations.content_json 可能没有 position 字段（包括 Review 工具早期版本）
         * - 如果直接透传给前端，会触发 `Cannot read properties of undefined (reading 'top')`
         *
         * 处理原则：
         * - IPC 边界返回的数据必须满足前端契约（position 存在且为 {top,left:number}）
         * - 不在这里做“防御性吞错”，而是把历史数据与当前契约对齐
         */
        const normalized: Record<string, unknown> = isRecord(content) ? { ...content } : {};

        const positionRaw = normalized.position;
        // 缺失或非法时统一修复；合法位置保持原值。
        normalized.position = isAnnotationPosition(positionRaw)
          ? positionRaw
          : { top: 0, left: 0 };
        return {
          id: anno.id,
          blockId: anno.target_block_id,
          ...normalized,
          createdAt: new Date(anno.created_at).toISOString(),
        };
      });
      return { success: true, data: { annotations } };
    } catch (error: unknown) {
      logger.error('[workspace:list-annotations] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('workspace:create-annotation', async (
    event,
    annotation: {
      id: string;
      documentId: string;
      blockId: string;
      createdAt: string;
      [key: string]: unknown;
    },
  ) => {
    try {
      if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
      const db = databaseService.getDb();
      const documentService = new MarkdownDocumentService(db);
      const { id, documentId, blockId, ...content } = annotation;
      const created = documentService.createAnnotation({
        id,
        documentNodeId: documentId,
        targetBlockId: blockId,
        contentJson: JSON.stringify(content),
        createdAt: annotation.createdAt,
      });
      return { success: true, data: { annotationId: created.id } };
    } catch (error: unknown) {
      logger.error('[workspace:create-annotation] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('workspace:update-annotation', async (event, { annotationId, updates }) => {
    try {
      if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
      const db = databaseService.getDb();
      const documentService = new MarkdownDocumentService(db);
      documentService.updateAnnotation(annotationId, updates);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:update-annotation] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('workspace:delete-annotation', async (event, { annotationId }) => {
    try {
      if (!isUsingNewDatabase()) return { success: false, error: 'New database not enabled' };
      const db = databaseService.getDb();
      const documentService = new MarkdownDocumentService(db);
      documentService.deleteAnnotation(annotationId);
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:delete-annotation] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  logger.info('✅ [IPC-LIFECYCLE] REGISTER | MarkdownDocument IPC handlers registered.');
}
