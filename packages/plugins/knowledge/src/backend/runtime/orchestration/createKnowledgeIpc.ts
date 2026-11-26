import { createOperationFailure, createUserFacingMessage } from '@app/schemas';
import {
  createKnowledgeBaseOperationFailure,
  type KnowledgeBaseOperationFallbackKey,
} from '../functions/knowledge-base-operation-failure';
import { z } from 'zod';
import {
  readBackendPluginRendererContext,
  readBackendPluginUploadContext,
} from '@plugin/backend/pluginIpcRuntime';
import type { BackendPluginIpcHandler } from '@plugin/backend/pluginIpcRuntime';
import type { BackendPluginIpcContribution } from '@plugin/backend/pluginContribution';
import type { KnowledgeRuntime } from './createKnowledgeRuntime';
import {
  kbTarget,
  documentTarget,
  settingsRequest,
  searchRequest,
  uploadFields,
} from '../definitions/knowledgeIpcRequests';
import {
  listKnowledgeDocumentsWithSource,
  readSavedKnowledgeContent,
} from '../../document-read/orchestration/readSavedKnowledgeContent';
import { validatePdfOcrUploadPageLimit } from '../../ingestion/functions/pdfOcrUploadPageLimit';
import { KnowledgeVectorStartupError, type KnowledgeVectorStartupFailureKind } from '../../infrastructure/vector-store/errors';
import {
  resolveKnowledgeBaseScopeFromContext,
  assertKbAllowedInScope,
} from '../../tools/scope/projectKnowledgeBaseScope';

/** 上传队列按启动失败类别展示对应的恢复办法。 */
const VECTOR_STARTUP_MESSAGE_KEYS = {
  'runtime-missing': 'knowledgeBase.runtime.error.vectorRuntimeMissing',
  'data-directory-too-long': 'knowledgeBase.runtime.error.vectorDataDirectoryTooLong',
  'startup-failed': 'knowledgeBase.runtime.error.vectorUnavailable',
} as const satisfies Record<KnowledgeVectorStartupFailureKind, string>;

/** IPC 只解析业务输入；实例与取消身份始终由当前 activation 冻结。 */
export function createKnowledgeIpc(
  getRuntime: () => KnowledgeRuntime
): BackendPluginIpcContribution {
  type Operation = (
    runtime: KnowledgeRuntime,
    payload: unknown,
    signal: AbortSignal,
    event: unknown
  ) => unknown;
  const handlers: Record<string, Operation> = {
    list: runtime => runtime.service.getAllKnowledgeBases(),
    create: (runtime, payload) => {
      const input = z
        .object({ name: z.string().trim().min(1), description: z.string().optional() })
        .parse(payload);
      return runtime.service.createKnowledgeBase(input.name, input.description);
    },
    get: async (runtime, payload) =>
      (await runtime.service.getKnowledgeBaseById(kbTarget.parse(payload).kbId)) ?? null,
    delete: async (runtime, payload) => {
      await runtime.service.deleteKnowledgeBase(kbTarget.parse(payload).kbId);
      return null;
    },
    'list-documents': (runtime, payload) =>
      listKnowledgeDocumentsWithSource(runtime.service, runtime.sot, kbTarget.parse(payload).kbId),
    'update-settings': (runtime, payload) => {
      const input = settingsRequest.parse(payload);
      return runtime.service.updateKnowledgeBaseSettings(input.kbId, input.settings);
    },
    'delete-document': async (runtime, payload) => {
      const input = documentTarget.parse(payload);
      const document = await runtime.service.getDocumentById(input.docId);
      if (!document || document.kbId !== input.kbId) throw new Error('文档不属于当前知识库');
      await runtime.service.deleteDocument(input.kbId, input.docId);
      return null;
    },
    'continue-failed-pages': (runtime, payload) => {
      const input = documentTarget
        .extend({
          modelConfig: z
            .object({
              pdfOcrModelId: z.string().nullable().optional(),
              embeddingModelId: z.string().nullable().optional(),
            })
            .optional(),
        })
        .parse(payload);
      return runtime.service.continueFailedPdfPages(input.kbId, input.docId, input.modelConfig);
    },
    'task-status': (runtime, payload) =>
      runtime.service.getTasksStatus(
        z.object({ docIds: z.array(z.string()) }).parse(payload).docIds
      ),
    'cancel-task': async (runtime, payload) => {
      await runtime.service.cancelTask(
        z.object({ taskId: z.string().min(1) }).parse(payload).taskId
      );
      return null;
    },
    search: (runtime, payload) => {
      const input = searchRequest.parse(payload);
      // 全局知识库页面没有项目参数；Editor 引用检索传来的冻结项目必须按相同工具规则校验。
      if (input.projectId !== undefined) {
        const scope = resolveKnowledgeBaseScopeFromContext({
          workspaceProjectId: input.projectId ?? undefined,
        });
        assertKbAllowedInScope(scope, input.kbId);
      }
      return runtime.service.search({ ...input.request, kbId: input.kbId });
    },
    'graph-progress': (runtime, payload) =>
      runtime.progress.getKbProgress(kbTarget.parse(payload).kbId),
    'rebuild-index': (runtime, payload) => {
      const input = kbTarget.extend({ modelId: z.string().min(1) }).parse(payload);
      return runtime.service.rebuildIndex(input.kbId, input.modelId);
    },
    'index-rebuild-status': (runtime, payload) =>
      runtime.service.getIndexRebuildStatus(kbTarget.parse(payload).kbId),
    'list-projects': runtime => runtime.projects.list(),
    'list-project-kb-links': (runtime, payload) =>
      runtime.links.listKnowledgeBasesForProject(
        z.object({ projectId: z.string().min(1) }).parse(payload).projectId
      ),
    'list-kb-project-links': (runtime, payload) =>
      runtime.links.listProjectsForKnowledgeBase(kbTarget.parse(payload).kbId),
    'replace-project-kb-links': async (runtime, payload) => {
      const input = z
        .object({ projectId: z.string().min(1), kbIds: z.array(z.string().min(1)) })
        .parse(payload);
      await runtime.links.replaceKnowledgeBasesForProject(input.projectId, input.kbIds);
      return null;
    },
    'replace-kb-project-links': async (runtime, payload) => {
      const input = kbTarget.extend({ projectIds: z.array(z.string().min(1)) }).parse(payload);
      await runtime.links.replaceProjectsForKnowledgeBase(input.kbId, input.projectIds);
      return null;
    },
    'read-saved-content': (runtime, payload, signal) =>
      readSavedKnowledgeContent(
        runtime.service,
        kbTarget.extend({ documentId: z.string().min(1) }).parse(payload),
        signal
      ),
    'upload-document': async (runtime, payload, _signal, event) => {
      const upload = readBackendPluginUploadContext(event);
      if (!upload) throw new Error('上传必须通过正式文件通道');
      const input = uploadFields.parse(payload);
      upload.signal.throwIfAborted();
      if (input.force_vision_mode === 'true')
        await validatePdfOcrUploadPageLimit({
          kbLookup: runtime.service,
          kbId: input.kbId,
          filePath: upload.file.path,
          filename: upload.file.name,
          requestedPdfOcrModelId: input.pdf_ocr_model_id,
          documentOcr: runtime.inference.documentOcr,
        });
      upload.signal.throwIfAborted();
      const result = await runtime.service.addDocument(
        input.kbId,
        upload.file.path,
        upload.file.name,
        upload.file.size,
        input.embedding_model_id,
        input.pdf_ocr_model_id,
        input.image_vision_model_id ?? input.vision_model_id,
        input.rerank_model_id,
        input.force_vision_mode === 'true',
        input.graph_extraction_model_id
      );
      upload.acceptFile();
      return {
        document: result.document,
        task_id: result.taskId,
        message: '已加入处理队列',
        timestamp: new Date().toISOString(),
      };
    },
  };
  const fallbackKeys: Readonly<Record<string, KnowledgeBaseOperationFallbackKey>> = {
    create: 'knowledgeBase.service.error.createIpcFailed',
    list: 'knowledgeBase.service.error.getAllIpcFailed',
    delete: 'knowledgeBase.service.error.deleteIpcFailed',
    'list-documents': 'knowledgeBase.service.error.getDocumentsIpcFailed',
    'update-settings': 'knowledgeBase.service.error.updateSettingsIpcFailed',
    'graph-progress': 'knowledgeBase.graph.error.progressLoadFailed',
  };
  return {
    channels: Object.keys(handlers),
    register(_services, register) {
      for (const [channel, operation] of Object.entries(handlers)) {
        const handler: BackendPluginIpcHandler = async (event, payload) => {
          try {
            const runtime = getRuntime();
            runtime.assertAccepting();
            const renderer = readBackendPluginRendererContext(event);
            const signal = renderer
              ? AbortSignal.any([renderer.signal, runtime.signal])
              : runtime.signal;
            signal.throwIfAborted();
            const result = await operation(runtime, payload, signal, event);
            signal.throwIfAborted();
            if (['search', 'upload-document', 'rebuild-index', 'continue-failed-pages'].includes(channel)) {
              runtime.startInteractiveMaintenance();
            }
            return { success: true, data: result };
          } catch (error) {
            if (channel === 'upload-document' && error instanceof KnowledgeVectorStartupError) {
              return createOperationFailure(error.message, createUserFacingMessage(VECTOR_STARTUP_MESSAGE_KEYS[error.kind]));
            }
            const fallback = fallbackKeys[channel];
            return fallback
              ? createKnowledgeBaseOperationFailure(error, fallback)
              : createOperationFailure(error instanceof Error ? error.message : String(error));
          }
        };
        register('knowledge', channel, handler);
      }
    },
  };
}
