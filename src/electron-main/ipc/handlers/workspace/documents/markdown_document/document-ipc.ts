/**
 * @file src/electron-main/ipc/handlers/documents/markdown_document/document-ipc.ts
 * @description 文档读写 IPC 通道处理器（按 node.type 路由）与 MarkdownDocument 专属操作。
 */

import { MarkdownDocumentService } from 'src/domains/markdown';
import { PendingRevisionApplyService } from 'src/domains/markdown';
import type { BackendRuntimeOwner } from '../../../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import { WorkspaceService } from '../../../../../services/workspace/workspace';
import { Logger } from '../../../../../../shared/logger';
import { createWorkspaceMutationPublisher } from '../../../../../../features/workspace/orchestration/workspaceMutationPublisherRegistry';
import { createWorkspaceDocumentUpdatedEvent } from '../../../../../../features/workspace/functions/createWorkspaceDocumentMutationEvent';
import { readWorkspaceEditorDocument } from '../../../../../../features/workspace/document-editor/orchestration/readWorkspaceEditorDocument';
import { writeWorkspaceEditorDocument } from '../../../../../../features/workspace/document-editor/orchestration/writeWorkspaceEditorDocument';
import { createWorkspaceDocumentEditorProviderResolver } from '../../../../../../app-hosts/linnya/adapters/document-editor/createWorkspaceDocumentEditorProviderResolver';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../../../app-hosts/linnya/adapters/backend-renderer-requests';

const logger = new Logger('DocumentIPC');

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

  logger.info('✅ [IPC-LIFECYCLE] REGISTER | MarkdownDocument IPC handlers registered.');
}
