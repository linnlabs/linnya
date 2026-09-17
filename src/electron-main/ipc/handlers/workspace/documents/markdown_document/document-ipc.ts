import { MarkdownRevisionCommitSchema } from '@app/schemas';
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

  ipcMain.handle('workspace:commit-markdown-revision', async (_event, input: unknown) => {
    try {
      const request = MarkdownRevisionCommitSchema.parse(input);
      const db = databaseService.getDb();
      const node = new WorkspaceService(db).getNode(request.documentId);
      if (node?.type !== 'document') throw new Error('Markdown document not found');
      const result = await new PendingRevisionApplyService(new MarkdownDocumentService(db)).commitEditorRevision(request);
      workspaceMutationPublisher.publish(createWorkspaceDocumentUpdatedEvent({
        node, mutationKind: 'version', versionNumber: result.versionNumber, source: 'user',
      }));
      return { success: true, data: result };
    } catch (error: unknown) {
      logger.error('[workspace:commit-markdown-revision] Commit failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ============================================================================
  // Pending Revisions（AI 修订意图）操作
  // ============================================================================

  /**
   * 批量写入 pending revisions（同一文档下多个块）
   *
   * 仅供开发期种子批量注入。生产修订由 Agent 写入或文档会话提交，不能通过此通道恢复撤销标记。
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
