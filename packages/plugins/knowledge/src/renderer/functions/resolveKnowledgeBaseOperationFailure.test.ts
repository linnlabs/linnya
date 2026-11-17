import { describe, expect, it } from 'vitest';
import { resolveKnowledgeBaseOperationFailure } from './resolveKnowledgeBaseOperationFailure';
import type { KnowledgeBaseMessageResolver } from '../definitions/knowledgeBaseMessages';

const knowledgeBaseMessage: KnowledgeBaseMessageResolver = (key) => {
  if (key === 'knowledgeBase.common.notFound') {
    return '这个知识库不存在或已被删除';
  }
  if (key === 'knowledgeBase.service.error.deleteIpcFailed') {
    return '删除知识库失败';
  }
  return key;
};

describe('resolveKnowledgeBaseOperationFailure', () => {
  it('uses a structured knowledge base user-facing message first', () => {
    expect(resolveKnowledgeBaseOperationFailure({
      error: 'Knowledge base not found: kb-1',
      userMessage: {
        key: 'knowledgeBase.common.notFound',
        diagnostic: 'Knowledge base not found: kb-1',
      },
    }, knowledgeBaseMessage, 'knowledgeBase.service.error.deleteIpcFailed')).toBe(
      '这个知识库不存在或已被删除',
    );
  });

  it('falls back when the structured key belongs to another domain', () => {
    expect(resolveKnowledgeBaseOperationFailure({
      error: 'Workspace detail',
      userMessage: {
        key: 'workspace.sidebar.node.notFound',
        fallback: 'Not found',
      },
    }, knowledgeBaseMessage, 'knowledgeBase.service.error.deleteIpcFailed')).toBe('删除知识库失败');
  });
});
