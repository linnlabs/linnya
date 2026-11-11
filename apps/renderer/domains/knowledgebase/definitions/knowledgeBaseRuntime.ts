import type { z } from 'zod';
import type { KnowledgeBaseListSummarySchema } from '@app/schemas';
import type { KnowledgeBaseCommands } from './knowledgeBaseCommands';
import type { KnowledgeBaseUploadMessage, KnowledgeBaseUploadStatus } from './knowledgeBaseUpload';

/** 目录展示沿用公开知识库摘要；索引出身、数量与时间来自管理接口。 */
export type KnowledgeBaseCatalogItem = z.infer<typeof KnowledgeBaseListSummarySchema> & {
  documentCount?: number;
  enableGraphIndexing?: boolean;
  createdAt?: string;
  updatedAt?: string;
  embeddingModelId?: string | null;
  rerankModelId?: string | null;
  pdfOcrModelId?: string | null;
  imageVisionModelId?: string | null;
  visionModelId?: string | null;
};

export interface KnowledgeBaseUploadTask {
  id: string;
  kbId: string;
  file: File;
  filename: string;
  size: number;
  status: KnowledgeBaseUploadStatus;
  realProgress: number;
  displayProgress: number;
  seed: number;
  message?: KnowledgeBaseUploadMessage | null;
  error?: KnowledgeBaseUploadMessage | null;
  docId: string | null;
  backendTaskId?: string | null;
  stage?: string;
  stage_progress?: number;
  _lastUpdateTs?: number;
}

export interface KnowledgeBaseParsingSettings {
  forceVisionMode: boolean;
}

export interface KnowledgeBaseRuntime extends KnowledgeBaseCommands {
  readonly knowledgeBases: readonly KnowledgeBaseCatalogItem[];
  readonly documents: readonly unknown[];
  readonly uploadTasks: ReadonlyMap<string, Readonly<KnowledgeBaseUploadTask>>;
  readonly uploadTasksComputed: readonly unknown[];
  readonly currentKbId: string | null;
  readonly currentKb: KnowledgeBaseCatalogItem | null | undefined;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly parsingSettings: Readonly<KnowledgeBaseParsingSettings>;
  readonly pendingUpdatesByTaskId: ReadonlyMap<string, unknown>;
  readonly pendingUpdatesByDocId: ReadonlyMap<string, unknown>;
  fetchKnowledgeBases(): Promise<void>;
  fetchDocuments(kbId: string): Promise<void>;
  setCurrentKnowledgeBase(kbId: string | null): void;
  deleteDocument(kbId: string, documentId: string): Promise<void>;
  continueFailedPdfPages(kbId: string, documentId: string): Promise<unknown>;
  updateKbModelSettings(kbId: string, settings: Readonly<Partial<Pick<KnowledgeBaseCatalogItem, 'name' | 'description' | 'tags' | 'enableGraphIndexing' | 'embeddingModelId' | 'rerankModelId' | 'pdfOcrModelId' | 'imageVisionModelId' | 'visionModelId'>>>): Promise<void>;
  deleteKnowledgeBase(kbId: string): Promise<void>;
  addFilesToQueue(kbId: string, files: File[], options?: { onDuplicateFilesSkipped?(count: number): void }): void;
  cancelUploadTask(taskId: string): Promise<void>;
  retryUploadTask(taskId: string): Promise<void>;
  deleteUploadTask(taskId: string): void;
  scheduleNext(): void;
  cleanupIpcListener(): void;
  updateParsingSettings(settings: Partial<KnowledgeBaseParsingSettings>): void;
  getKnowledgeBaseById(id: string): KnowledgeBaseCatalogItem | null;
  getDocumentById(id: string): unknown;
  getKbNameById(id: string): string;
  getPollingStatus(): { isActive: boolean; mode: 'fallback' | 'calibration' | null; interval: number | null };
}
