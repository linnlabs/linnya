import { Router, type Response } from 'express';
import {
  StorageSpaceConversationIdSchema,
  StorageSpaceOverviewResponseSchema,
  type StorageSpaceErrorCode,
  type StorageSpaceOverviewResponse,
} from '@app/schemas';

import type {
  StorageSpaceOverview,
  StorageSpaceUseCasePort,
} from '../../app-hosts/linnya/application/storage-space';
import { getLogger } from '../../shared/logger';

const logger = getLogger('StorageSpaceRouter');

function projectOverviewResponse(
  overview: StorageSpaceOverview,
): StorageSpaceOverviewResponse {
  return StorageSpaceOverviewResponseSchema.parse({
    measured_at_ms: overview.measuredAtMs,
    total_byte_size: overview.total.byteSize,
    categories: overview.categories.map(category => ({
      kind: category.kind,
      byte_size: category.byteSize,
    })),
    conversations: overview.conversations.map(conversation => ({
      conversation_id: conversation.conversationId,
      title: conversation.title,
      project_id: conversation.projectId,
      work_files_state: conversation.workFilesState,
      byte_size: conversation.byteSize,
      file_count: conversation.fileCount,
    })),
  });
}

function sendStorageError(
  response: Response,
  status: number,
  code: StorageSpaceErrorCode,
): void {
  response.status(status).json({ code });
}

/**
 * HTTP 层只转换稳定合同，不拥有目录、数据库或清理能力。错误响应有意只返回 code，
 * 避免底层路径、系统错误和清理阶段穿过本地 HTTP 边界进入 renderer。
 */
export function createStorageSpaceRouter(useCase: StorageSpaceUseCasePort): Router {
  const router = Router();

  router.get('/overview', async (_request, response) => {
    try {
      const overview = await useCase.readOverview();
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json(projectOverviewResponse(overview));
    } catch (error: unknown) {
      logger.error('读取存储空间概览失败', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      sendStorageError(response, 500, 'storage_space.overview_failed');
    }
  });

  router.delete('/conversations/:conversationId/work-directory', async (request, response) => {
    const parsedIdentity = StorageSpaceConversationIdSchema.safeParse(
      request.params.conversationId,
    );
    if (!parsedIdentity.success) {
      sendStorageError(response, 400, 'storage_space.invalid_conversation_id');
      return;
    }

    try {
      const result = await useCase.clearConversationWorkDirectory(parsedIdentity.data);
      switch (result) {
        case 'cleared':
          response.status(204).send();
          return;
        case 'not_found':
          sendStorageError(response, 404, 'storage_space.conversation_not_found');
          return;
        case 'deletion_in_progress':
          sendStorageError(response, 409, 'storage_space.conversation_deletion_in_progress');
          return;
      }
    } catch (error: unknown) {
      logger.error('清理对话工作目录失败', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      sendStorageError(response, 500, 'storage_space.work_directory_clear_failed');
    }
  });

  return router;
}
