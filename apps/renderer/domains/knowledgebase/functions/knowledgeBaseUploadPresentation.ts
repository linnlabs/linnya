import type {
  KnowledgeBaseMessageKey,
  KnowledgeBaseMessageResolver,
} from '../definitions/knowledgeBaseMessages';

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

export function createKnowledgeBaseUploadMessage(
  key: KnowledgeBaseMessageKey,
  params?: KnowledgeBaseUploadMessageParams,
): KnowledgeBaseUploadLocalizedMessage {
  return params === undefined ? { key } : { key, params };
}

const LOCAL_STATUS_MESSAGES = {
  '等待中': 'knowledgeBase.upload.status.waiting',
  '等待重试': 'knowledgeBase.upload.status.waitingRetry',
  '上传中': 'knowledgeBase.upload.status.uploading',
  '解析中': 'knowledgeBase.upload.status.parsing',
  '处理中': 'knowledgeBase.upload.status.processing',
  '已完成': 'knowledgeBase.upload.status.completed',
  '重复文件': 'knowledgeBase.upload.status.duplicate',
  '上传失败': 'knowledgeBase.upload.status.failed',
  '已取消': 'knowledgeBase.upload.status.canceled',
} as const;

const LOCAL_ERROR_MESSAGES = {
  '用户取消': 'knowledgeBase.upload.error.canceledByUser',
  '上传失败': 'knowledgeBase.upload.error.failed',
} as const;

const STATUS_FALLBACK_KEYS = {
  pending: 'knowledgeBase.upload.status.waiting',
  queued: 'knowledgeBase.upload.status.waiting',
  processing: 'knowledgeBase.upload.status.processing',
  uploading: 'knowledgeBase.upload.status.uploading',
  completed: 'knowledgeBase.upload.status.completed',
  duplicate: 'knowledgeBase.upload.status.duplicate',
  failed: 'knowledgeBase.upload.status.failed',
  error: 'knowledgeBase.upload.status.failed',
} as const;

function isKnownLocalMessage(value: string): value is keyof typeof LOCAL_STATUS_MESSAGES {
  return Object.prototype.hasOwnProperty.call(LOCAL_STATUS_MESSAGES, value);
}

function isKnownStatus(value: string): value is keyof typeof STATUS_FALLBACK_KEYS {
  return Object.prototype.hasOwnProperty.call(STATUS_FALLBACK_KEYS, value);
}

function isKnownLocalError(value: string): value is keyof typeof LOCAL_ERROR_MESSAGES {
  return Object.prototype.hasOwnProperty.call(LOCAL_ERROR_MESSAGES, value);
}

function isKnowledgeBaseUploadLocalizedMessage(
  value: unknown,
): value is KnowledgeBaseUploadLocalizedMessage {
  if (typeof value !== 'object' || value === null) return false;
  if (!('key' in value) || typeof value.key !== 'string') return false;
  if (!('params' in value)) return true;
  return typeof value.params === 'object' || value.params === undefined;
}

export function resolveUploadTaskStatusText(
  task: KnowledgeBaseUploadTaskLike,
  message: KnowledgeBaseMessageResolver,
): string {
  if (isKnowledgeBaseUploadLocalizedMessage(task.message)) {
    return message(task.message.key, task.message.params);
  }

  if (typeof task.message === 'string') {
    const rawMessage = task.message.trim();
    if (rawMessage) {
      if (isKnownLocalMessage(rawMessage)) {
        return message(LOCAL_STATUS_MESSAGES[rawMessage]);
      }
    }
  }

  return isKnownStatus(task.status)
    ? message(STATUS_FALLBACK_KEYS[task.status])
    : message('knowledgeBase.upload.status.processing');
}

export function resolveUploadTaskErrorText(
  error: KnowledgeBaseUploadMessage | null | undefined,
  message: KnowledgeBaseMessageResolver,
): string {
  if (isKnowledgeBaseUploadLocalizedMessage(error)) {
    return message(error.key, error.params);
  }

  if (typeof error !== 'string') return '';

  const rawError = error.trim();
  if (!rawError) return '';

  return isKnownLocalError(rawError)
    ? message(LOCAL_ERROR_MESSAGES[rawError])
    : rawError;
}
