import { describe, expect, it } from 'vitest';
import { resolveKnowledgeBaseMessage } from './resolveKnowledgeBaseMessage';

describe('resolveKnowledgeBaseMessage', () => {
  it('uses knowledge base fallback as the domain message fallback', () => {
    expect(resolveKnowledgeBaseMessage(
      'knowledgeBase.list.title',
      (key, fallback) => `${key}:${fallback}`,
    )).toBe('knowledgeBase.list.title:知识库');
  });

  it('passes interpolation params to the app localization resolver', () => {
    expect(resolveKnowledgeBaseMessage(
      'knowledgeBase.list.meta.count',
      (key, fallback, params) => `${key}:${fallback}:${params?.count ?? ''}`,
      { count: 3 },
    )).toBe('knowledgeBase.list.meta.count:共 {count} 个知识库:3');
  });

  it('resolves store error messages without exposing raw error details', () => {
    expect(resolveKnowledgeBaseMessage(
      'knowledgeBase.store.error.fetchDocumentsFailed',
      (key, fallback, params) => {
        const resolved = params?.errorMessage == null
          ? fallback
          : fallback.replace('{errorMessage}', String(params.errorMessage));
        return `${key}:${resolved}`;
      },
      { errorMessage: 'Network down' },
    )).toBe('knowledgeBase.store.error.fetchDocumentsFailed:获取文档列表失败，请稍后重试。');
  });
});
