import type { KnowledgeBaseMessageKey, KnowledgeBaseMessageResolver } from './knowledgeBaseMessages';

export type KnowledgeBaseUploadStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'uploading'
  | 'completed'
  | 'duplicate'
  | 'failed'
  | 'error';

export interface KnowledgeBaseUploadTaskLike {
  readonly status: KnowledgeBaseUploadStatus | string;
  readonly message?: KnowledgeBaseUploadMessage | null;
  readonly error?: KnowledgeBaseUploadMessage | null;
}

type KnowledgeBaseUploadMessageParams = Parameters<KnowledgeBaseMessageResolver>[1];

export interface KnowledgeBaseUploadLocalizedMessage {
  readonly key: KnowledgeBaseMessageKey;
  readonly params?: KnowledgeBaseUploadMessageParams;
}

export type KnowledgeBaseUploadMessage = string | KnowledgeBaseUploadLocalizedMessage;

