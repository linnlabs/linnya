import { describe, expect, it } from 'vitest';
import {
  createKnowledgeBaseUploadMessage,
  resolveUploadTaskErrorText,
  resolveUploadTaskStatusText,
} from './knowledgeBaseUploadPresentation';
import type { KnowledgeBaseMessageResolver } from '../definitions/knowledgeBaseMessages';

const resolveForTest: KnowledgeBaseMessageResolver = (key) => `translated:${key}`;

describe('resolveUploadTaskStatusText', () => {
  it('localizes known local task messages from the upload store', () => {
    expect(resolveUploadTaskStatusText(
      { status: 'pending', message: '等待中' },
      resolveForTest,
    )).toBe('translated:knowledgeBase.upload.status.waiting');
  });

  it('falls back by status instead of exposing backend-provided dynamic messages', () => {
    expect(resolveUploadTaskStatusText(
      { status: 'processing', message: '数据存储完成: 12 个向量' },
      resolveForTest,
    )).toBe('translated:knowledgeBase.upload.status.processing');
  });

  it('falls back by status when the task has no message', () => {
    expect(resolveUploadTaskStatusText(
      { status: 'duplicate', message: '' },
      resolveForTest,
    )).toBe('translated:knowledgeBase.upload.status.duplicate');
  });

  it('resolves structured task status messages', () => {
    expect(resolveUploadTaskStatusText(
      {
        status: 'pending',
        message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.waitingRetry'),
      },
      resolveForTest,
    )).toBe('translated:knowledgeBase.upload.status.waitingRetry');
  });

  it('resolves structured and legacy task error messages', () => {
    expect(resolveUploadTaskErrorText(
      createKnowledgeBaseUploadMessage('knowledgeBase.upload.error.canceledByUser'),
      resolveForTest,
    )).toBe('translated:knowledgeBase.upload.error.canceledByUser');

    expect(resolveUploadTaskErrorText('用户取消', resolveForTest)).toBe(
      'translated:knowledgeBase.upload.error.canceledByUser',
    );

    expect(resolveUploadTaskErrorText('上传失败', resolveForTest)).toBe(
      'translated:knowledgeBase.upload.error.failed',
    );
  });

  it('keeps backend business errors visible to the user', () => {
    const error = 'PDF "large.pdf" 共 101 页，当前 OCR 模型 PaddleOCR-VL-1.6 单次最多解析 100 页。';

    expect(resolveUploadTaskErrorText(error, resolveForTest)).toBe(error);
  });
});
