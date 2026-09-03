/**
 * @file knowledge-base-ipc.ts
 * @description 知识库基础能力（CRUD/查询）的 IPC 处理器
 *
 * 背景说明：
 * - 渲染进程侧的 preload 已暴露 `get-all-kbs/create-kb/delete-kb/get-documents-in-kb/search-kb` 等通道；
 * - 但主进程此前仅实现了 `project-kb-links:*`，导致“创建知识库”只能走 HTTP，
 *   与“项目↔知识库关联”（IPC+workspace.sqlite）形成两条数据链路，进而引发创建后关联不生效/需二次关联的问题。
 *
 * 设计原则：
 * - 只做薄薄的 IPC 转发，不引入额外业务逻辑（高内聚低耦合）。
 * - 错误必须返回给前端（不可静默），由 UI 决定如何呈现。
 */

import type { KnowledgeBaseService } from '../../../../features/knowledge-base/application/knowledgeBaseService';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import type { Document } from '../../../../features/knowledge-base/domain/document';
import type { KnowledgeBase } from '../../../../features/knowledge-base/domain/knowledgeBase';
import { BetterSqliteKnowledgeGraphRepository } from '../../../../features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { GraphProgressService } from '../../../../features/knowledge-base/graph/application/graphProgressService';
import type { DatabaseService } from '../../../services/database';
import { ServiceRegistry } from '../../../../core/di/ServiceRegistry';
import type { KnowledgeGraphQueueOrchestrator } from '../../../../features/knowledge-base/graph/application/knowledgeGraphQueueOrchestrator';
import type { BackendRuntimeOwner } from '../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import {
  KnowledgeBaseIdRequiredError,
  KnowledgeBaseInvalidRequestError,
} from '../../../../features/knowledge-base/definitions/knowledgeBaseErrors';
import { createKnowledgeBaseOperationFailure } from './knowledge-base-operation-failure';

function readAliasedSetting(
  settings: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): unknown {
  if (Object.prototype.hasOwnProperty.call(settings, camelKey)) {
    return settings[camelKey];
  }
  if (Object.prototype.hasOwnProperty.call(settings, snakeKey)) {
    return settings[snakeKey];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 注册知识库基础操作的 IPC 处理器
 */
export function registerKnowledgeBaseHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  const getKbService = (): KnowledgeBaseService => {
    const service = runtimeOwner.getServices().knowledgeBaseService;
    if (!service) {
      throw new Error('KnowledgeBaseService 未初始化');
    }
    return service;
  };

  const getDatabaseService = (): DatabaseService => {
    const service = runtimeOwner.getServices().databaseService;
    if (!service) {
      throw new Error('DatabaseService 未初始化');
    }
    return service;
  };

  // 图谱进度服务（M4）：只用于“读取 + 节流推送”，不侵入 KB 业务服务
  const graphProgressService = new GraphProgressService(
    new BetterSqliteKnowledgeGraphRepository(getDatabaseService())
  );

  const getKnowledgeGraphQueueOrchestrator = (): KnowledgeGraphQueueOrchestrator | null => {
    return ServiceRegistry
      .getInstance()
      .getSync<KnowledgeGraphQueueOrchestrator>('knowledgeGraphQueueOrchestrator') ?? null;
  };

  /**
   * 获取所有知识库列表
   * 通道：get-all-kbs
   */
  ipcMain.handle('get-all-kbs', async () => {
    try {
      const kbService = getKbService();
      const knowledgeBases = await kbService.getAllKnowledgeBases();
      return { success: true, data: knowledgeBases };
    } catch (error) {
      console.error('[IPC] get-all-kbs 失败:', error);
      return createKnowledgeBaseOperationFailure(error, 'knowledgeBase.service.error.getAllIpcFailed');
    }
  });

  /**
   * 创建知识库
   * 通道：create-kb
   */
  ipcMain.handle(
    'create-kb',
    async (_event, args: unknown) => {
      try {
        const kbService = getKbService();

        // 参数校验：严格收窄，不使用 any
        if (!isRecord(args)) {
          throw new KnowledgeBaseInvalidRequestError('create');
        }
        const name = typeof args.name === 'string' ? args.name : '';
        const description =
          typeof args.description === 'string' ? args.description : undefined;

        const kb = await kbService.createKnowledgeBase(name, description);
        return { success: true, data: kb };
      } catch (error) {
        console.error('[IPC] create-kb 失败:', error);
        return createKnowledgeBaseOperationFailure(error, 'knowledgeBase.create.error.createFailed');
      }
    }
  );

  /**
   * 删除知识库
   * 通道：delete-kb
   */
  ipcMain.handle('delete-kb', async (_event, kbId: unknown) => {
    try {
      const kbService = getKbService();
      if (typeof kbId !== 'string' || kbId.trim().length === 0) {
        throw new KnowledgeBaseIdRequiredError('delete');
      }
      await kbService.deleteKnowledgeBase(kbId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] delete-kb 失败:', error);
      return createKnowledgeBaseOperationFailure(error, 'knowledgeBase.service.error.deleteIpcFailed');
    }
  });

  /**
   * 获取知识库下的文档列表
   * 通道：get-documents-in-kb
   */
  ipcMain.handle('get-documents-in-kb', async (_event, kbId: unknown) => {
    try {
      const kbService = getKbService();
      if (typeof kbId !== 'string' || kbId.trim().length === 0) {
        throw new KnowledgeBaseIdRequiredError('get-documents');
      }
      const documents: Document[] = await kbService.getDocumentsInKnowledgeBase(kbId);
      return { success: true, data: documents };
    } catch (error) {
      console.error('[IPC] get-documents-in-kb 失败:', error);
      return createKnowledgeBaseOperationFailure(error, 'knowledgeBase.service.error.getDocumentsIpcFailed');
    }
  });

  /**
   * 更新知识库设置（基础信息 / 模型配置 / 标签）
   * 通道：update-kb-settings
   *
   * 说明：
   * - 渲染进程历史上通过 HTTP 调用时使用 snake_case（embedding_model_id/...）；
   * - 应用层 service 使用 camelCase（embeddingModelId/...）；
   * - 此处做明确的字段映射，保证 IPC 与 HTTP 行为一致，避免两套 payload 语义分裂。
   */
  ipcMain.handle('update-kb-settings', async (_event, args: unknown) => {
    try {
      const kbService = getKbService();

      if (!isRecord(args)) {
        throw new KnowledgeBaseInvalidRequestError('update');
      }

      const kbId = typeof args.kbId === 'string' ? args.kbId : '';
      if (kbId.trim().length === 0) {
        throw new KnowledgeBaseIdRequiredError('update');
      }

      if (!isRecord(args.settings)) {
        throw new KnowledgeBaseInvalidRequestError('update');
      }

      const settings = args.settings;

      const payload: {
        name?: string;
        description?: string | null;
        embeddingModelId?: string | null;
        rerankModelId?: string | null;
        pdfOcrModelId?: string | null;
        imageVisionModelId?: string | null;
        visionModelId?: string | null;
        tags?: string[];
        enableGraphIndexing?: boolean;
      } = {};

      // --- 基础信息 ---
      if (typeof settings.name === 'string') {
        payload.name = settings.name;
      }
      if (settings.description === null || typeof settings.description === 'string') {
        payload.description = settings.description;
      }

      // --- 模型配置（兼容 snake_case / camelCase）---
      const embeddingModelIdRaw = readAliasedSetting(settings, 'embeddingModelId', 'embedding_model_id');
      if (embeddingModelIdRaw === null || typeof embeddingModelIdRaw === 'string') {
        payload.embeddingModelId = embeddingModelIdRaw;
      }
      const rerankModelIdRaw = readAliasedSetting(settings, 'rerankModelId', 'rerank_model_id');
      if (rerankModelIdRaw === null || typeof rerankModelIdRaw === 'string') {
        payload.rerankModelId = rerankModelIdRaw;
      }
      const pdfOcrModelIdRaw = readAliasedSetting(settings, 'pdfOcrModelId', 'pdf_ocr_model_id');
      if (pdfOcrModelIdRaw === null || typeof pdfOcrModelIdRaw === 'string') {
        payload.pdfOcrModelId = pdfOcrModelIdRaw;
      }
      const imageVisionModelIdRaw = readAliasedSetting(settings, 'imageVisionModelId', 'image_vision_model_id');
      if (imageVisionModelIdRaw === null || typeof imageVisionModelIdRaw === 'string') {
        payload.imageVisionModelId = imageVisionModelIdRaw;
      }
      const visionModelIdRaw = readAliasedSetting(settings, 'visionModelId', 'vision_model_id');
      if (visionModelIdRaw === null || typeof visionModelIdRaw === 'string') {
        payload.visionModelId = visionModelIdRaw;
      }

      // --- 标签 ---
      if (Array.isArray(settings.tags)) {
        payload.tags = settings.tags.filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0
        );
      }

      // --- 图谱构建开关（兼容 snake_case / camelCase）---
      const enableGraphIndexingRaw = readAliasedSetting(settings, 'enableGraphIndexing', 'enable_graph_indexing');
      if (typeof enableGraphIndexingRaw === 'boolean') {
        payload.enableGraphIndexing = enableGraphIndexingRaw;
      }

      const updatedKb: KnowledgeBase = await kbService.updateKnowledgeBaseSettings(kbId, payload);

      // 关闭图谱构建时：取消队列中尚未开始的图谱任务（不影响已建立的图谱数据）
      if (payload.enableGraphIndexing === false) {
        try {
          const orchestrator = getKnowledgeGraphQueueOrchestrator();
          if (orchestrator) {
            await orchestrator.cancelPendingGraphTasksByKb(kbId);
          }
        } catch (e) {
          console.warn('[IPC] update-kb-settings: 取消 pending 图谱任务失败（不影响设置更新）', e);
        }
      }

      return { success: true, data: updatedKb };
    } catch (error) {
      console.error('[IPC] update-kb-settings 失败:', error);
      return createKnowledgeBaseOperationFailure(error, 'knowledgeBase.service.error.updateSettingsIpcFailed');
    }
  });

  /**
   * 获取 KB 级图谱构建进度（M4）
   * 通道：get-kb-graph-progress
   */
  ipcMain.handle('get-kb-graph-progress', async (_event, kbId: unknown) => {
    try {
      if (typeof kbId !== 'string' || kbId.trim().length === 0) {
        throw new KnowledgeBaseIdRequiredError('graph-progress');
      }
      const data = await graphProgressService.getKbProgress(kbId);
      return { success: true, data };
    } catch (error) {
      console.error('[IPC] get-kb-graph-progress 失败:', error);
      return createKnowledgeBaseOperationFailure(error, 'knowledgeBase.graph.error.progressLoadFailed');
    }
  });
}
