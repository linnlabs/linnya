import { z } from 'zod';
import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { readPurposeModelId } from '@plugin/renderer/modelConfiguration';
import type { RendererPluginUploadProgress } from '@plugin/renderer/pluginMultipartUpload';
import {
  KnowledgeBaseSchema, KnowledgeBaseSummarySchema, KnowledgeDocumentSummarySchema,
  KnowledgeIndexTaskStatusSchema, KnowledgeGraphProgressSchema, KnowledgeTaskStatusViewSchema,
  KnowledgeSearchResponseSchema, KnowledgeUploadResponseSchema, KnowledgeContinueFailedPagesResultSchema,
  KnowledgeSavedContentSchema, KnowledgeProjectSummarySchema,
} from '../../shared';
import type { KnowledgeSettingsUpdate, KnowledgeUploadModels, KnowledgeSearchRequest } from '../definitions/knowledgeRequests';
import { resolveCurrentKnowledgeBaseMessage } from '../functions/resolveCurrentKnowledgeBaseMessage';
import { invokeKnowledgeRequest, uploadKnowledgeMultipart } from './knowledgeRequestSession';

/** 只有插件声明的 IPC 与 Host 登记的 multipart；响应以同一业务 owner 的 schema 解码。 */
export const knowledgeBaseService = {
  async rebuildIndex(kbId: string, modelId: string) {
    return KnowledgeIndexTaskStatusSchema.parse(await invokeKnowledgeRequest('rebuild-index', { kbId, modelId }));
  },
  async getIndexRebuildStatus(kbId: string) {
    return KnowledgeIndexTaskStatusSchema.nullable().parse(await invokeKnowledgeRequest('index-rebuild-status', { kbId }));
  },
  async getKbGraphProgress(kbId: string) {
    return KnowledgeGraphProgressSchema.nullable().parse(await invokeKnowledgeRequest('graph-progress', { kbId }));
  },
  onKbGraphProgressUpdated(callback: (payload: unknown) => void) {
    return onRendererPluginPush('knowledge', 'graph-progress-updated', payload => callback(KnowledgeGraphProgressSchema.parse(payload)));
  },
  async getAllKnowledgeBases() {
    const list = z.array(KnowledgeBaseSummarySchema).parse(await invokeKnowledgeRequest('list', {}));
    return { knowledge_bases: list, total: list.length, timestamp: new Date().toISOString() };
  },
  async createKnowledgeBase(input: { name: string; description?: string }) {
    const knowledgeBase = KnowledgeBaseSchema.parse(await invokeKnowledgeRequest('create', input));
    return {
      knowledge_base: knowledgeBase,
      message: resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.create.success'),
      timestamp: new Date().toISOString(),
    };
  },
  async getKnowledgeBase(kbId: string) {
    return KnowledgeBaseSchema.nullable().parse(await invokeKnowledgeRequest('get', { kbId }));
  },
  async deleteKnowledgeBase(kbId: string): Promise<void> {
    await invokeKnowledgeRequest('delete', { kbId });
  },
  async getDocuments(kbId: string, signal?: AbortSignal) {
    const documents = z.array(KnowledgeDocumentSummarySchema).parse(await invokeKnowledgeRequest('list-documents', { kbId }, signal));
    return { documents, total: documents.length, kb_id: kbId, timestamp: new Date().toISOString() };
  },
  async uploadDocument(
    kbId: string, file: File, modelConfig: KnowledgeUploadModels,
    onProgress?: (progress: RendererPluginUploadProgress) => void, signal?: AbortSignal,
  ) {
    const form = new FormData();
    form.append('kbId', kbId);
    form.append('file', file);
    for (const [key, value] of Object.entries(modelConfig)) {
      if (typeof value === 'string' && value) form.append(key, value);
      if (typeof value === 'boolean') form.append(key, String(value));
    }
    return KnowledgeUploadResponseSchema.parse(await uploadKnowledgeMultipart(form, onProgress, signal));
  },
  async deleteDocument(kbId: string, docId: string): Promise<void> {
    await invokeKnowledgeRequest('delete-document', { kbId, docId });
  },
  async continueFailedPdfPages(kbId: string, docId: string, modelConfig: { pdfOcrModelId?: string | null; embeddingModelId?: string | null } = {}) {
    const result = KnowledgeContinueFailedPagesResultSchema.parse(await invokeKnowledgeRequest('continue-failed-pages', { kbId, docId, modelConfig }));
    return { ...result, success: true, timestamp: new Date().toISOString() };
  },
  async getTasksStatus(docIds: string[]) {
    if (!docIds.length) return {};
    const statuses = z.record(z.string(), KnowledgeTaskStatusViewSchema).parse(await invokeKnowledgeRequest('task-status', { docIds }));
    return Object.fromEntries(Object.entries(statuses).map(([id, value]) => [id, {
      ...value, updated_at: value.updatedAt, timestamp: value.updatedAt,
    }]));
  },
  async updateKbSettings(kbId: string, settings: KnowledgeSettingsUpdate) {
    return KnowledgeBaseSchema.parse(await invokeKnowledgeRequest('update-settings', { kbId, settings }));
  },
  async cancelTask(taskId: string): Promise<void> {
    await invokeKnowledgeRequest('cancel-task', { taskId });
  },
  async searchInKnowledgeBase(kbId: string, request: KnowledgeSearchRequest) {
    const payload = {
      ...request,
      query: request.query.trim(), topK: request.topK ?? 5, useReranking: request.useReranking ?? true,
      embeddingModelId: request.embeddingModelId ?? readPurposeModelId('embedding'),
      rerankModelId: request.rerankModelId ?? readPurposeModelId('rerank'),
    };
    return KnowledgeSearchResponseSchema.parse(await invokeKnowledgeRequest('search', { kbId, request: payload }));
  },
  async listProjects(signal?: AbortSignal) {
    return z.array(KnowledgeProjectSummarySchema).parse(await invokeKnowledgeRequest('list-projects', {}, signal));
  },
  async readSavedContent(kbId: string, documentId: string, signal: AbortSignal) {
    return KnowledgeSavedContentSchema.parse(await invokeKnowledgeRequest('read-saved-content', { kbId, documentId }, signal));
  },
};
