import type Database from 'better-sqlite3';
import express, { Router, type Response } from 'express';
import {
  ProjectConversationDetailRequestSchema,
  ProjectConversationDetailSchema,
  ProjectConversationsMeasureRequestSchema,
  ProjectConversationsMeasureSchema,
  ProjectConversationsRequestSchema,
  ProjectConversationsSchema,
  ProjectConversationsSearchRequestSchema,
  ProjectConversationsSearchSchema,
} from '@app/schemas';
import {
  readProjectConversationDetail,
  readProjectConversations,
  searchProjectConversations,
  type ProjectConversationStorageMeasurer,
} from '../../app-hosts/linnya/application/project-conversations';
import { getLogger } from '../../shared/logger';

const logger = getLogger('ProjectConversationsRouter');

function fail(response: Response, status: number, code: string, error?: unknown): void {
  if (error !== undefined) {
    logger.error('项目对话请求失败', { code, errorName: error instanceof Error ? error.name : typeof error });
  }
  response.status(status).json({ code });
}

/**
 * 项目概览对话页的本地 HTTP 合同。只读对话持久化、账本与对话工作目录；
 * 错误只返回 code，底层路径与系统错误不穿过边界。清理过程文件走存储空间的接口。
 */
export function createProjectConversationsRouter(input: {
  readonly db: Database.Database;
  readonly measurer: ProjectConversationStorageMeasurer;
}): Router {
  const router = Router();
  router.use(express.json({ limit: '64kb', strict: true }));

  router.get('/:projectId', (request, response) => {
    const parsed = ProjectConversationsRequestSchema.safeParse({ project_id: request.params.projectId });
    if (!parsed.success) return fail(response, 400, 'project_conversations.invalid_request');
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.json(ProjectConversationsSchema.parse(readProjectConversations(input.db, parsed.data)));
    } catch (error: unknown) {
      fail(response, 500, 'project_conversations.list_failed', error);
    }
  });

  router.get('/:projectId/search', (request, response) => {
    const parsed = ProjectConversationsSearchRequestSchema.safeParse({
      project_id: request.params.projectId,
      query: typeof request.query.q === 'string' ? request.query.q : '',
    });
    if (!parsed.success) return fail(response, 400, 'project_conversations.invalid_request');
    try {
      response.setHeader('Cache-Control', 'no-store');
      response.json(ProjectConversationsSearchSchema.parse(searchProjectConversations(input.db, parsed.data)));
    } catch (error: unknown) {
      fail(response, 500, 'project_conversations.search_failed', error);
    }
  });

  router.get('/:projectId/conversations/:conversationId', (request, response) => {
    const parsed = ProjectConversationDetailRequestSchema.safeParse({
      project_id: request.params.projectId,
      conversation_id: request.params.conversationId,
    });
    if (!parsed.success) return fail(response, 400, 'project_conversations.invalid_request');
    try {
      const detail = readProjectConversationDetail(input.db, parsed.data);
      if (!detail) return fail(response, 404, 'project_conversations.not_found');
      response.setHeader('Cache-Control', 'no-store');
      response.json(ProjectConversationDetailSchema.parse(detail));
    } catch (error: unknown) {
      fail(response, 500, 'project_conversations.detail_failed', error);
    }
  });

  router.post('/:projectId/storage/measure', async (request, response) => {
    const body: unknown = request.body ?? {};
    const parsed = ProjectConversationsMeasureRequestSchema.safeParse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      project_id: request.params.projectId,
    });
    if (!parsed.success) return fail(response, 400, 'project_conversations.invalid_request');
    try {
      response.json(ProjectConversationsMeasureSchema.parse(await input.measurer.measure(parsed.data)));
    } catch (error: unknown) {
      fail(response, 500, 'project_conversations.measure_failed', error);
    }
  });

  return router;
}
