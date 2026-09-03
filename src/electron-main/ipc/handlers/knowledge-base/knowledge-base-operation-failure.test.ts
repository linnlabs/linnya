import { describe, expect, it } from 'vitest';
import {
  KnowledgeBaseDefaultDeleteBlockedError,
  KnowledgeBaseNameRequiredError,
  KnowledgeBaseNotFoundError,
} from '../../../../features/knowledge-base/definitions/knowledgeBaseErrors';
import { createKnowledgeBaseOperationFailure } from './knowledge-base-operation-failure';

describe('createKnowledgeBaseOperationFailure', () => {
  it('maps name validation to the knowledge base create message', () => {
    const result = createKnowledgeBaseOperationFailure(
      new KnowledgeBaseNameRequiredError(),
      'knowledgeBase.service.error.createIpcFailed',
    );

    expect(result.error).toBe('Knowledge base name is required');
    expect(result.userMessage).toMatchObject({
      key: 'knowledgeBase.create.error.nameRequired',
      diagnostic: 'Knowledge base name is required',
    });
  });

  it('maps not found and default delete errors to stable message keys', () => {
    expect(createKnowledgeBaseOperationFailure(
      new KnowledgeBaseNotFoundError('kb-1'),
      'knowledgeBase.service.error.deleteIpcFailed',
    ).userMessage?.key).toBe('knowledgeBase.common.notFound');

    expect(createKnowledgeBaseOperationFailure(
      new KnowledgeBaseDefaultDeleteBlockedError(),
      'knowledgeBase.service.error.deleteIpcFailed',
    ).userMessage?.key).toBe('knowledgeBase.settings.error.defaultDeleteBlocked');
  });

  it('uses the operation fallback key for unknown errors', () => {
    const result = createKnowledgeBaseOperationFailure(
      new Error('qdrant unavailable'),
      'knowledgeBase.service.error.getAllIpcFailed',
    );

    expect(result.error).toBe('qdrant unavailable');
    expect(result.userMessage?.key).toBe('knowledgeBase.service.error.getAllIpcFailed');
  });
});
