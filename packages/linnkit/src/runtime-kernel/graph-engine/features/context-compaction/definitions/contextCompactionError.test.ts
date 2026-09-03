import { describe, expect, it } from 'vitest';
import {
  CONTEXT_COMPACTION_FAILED_ERROR_CODE,
  CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
} from '../../../../../contracts';
import { createRuntimeErrorEvent } from '../../../../execution/runtimeErrorEventFactory';
import { ContextCompactionError } from './contextCompactionError';

describe('ContextCompactionError execution settlement contract', () => {
  it.each([
    CONTEXT_COMPACTION_FAILED_ERROR_CODE,
    CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
  ])('把 %s 原样结算为不可重试的 Runtime error fact', errorCode => {
    const event = createRuntimeErrorEvent({
      id: 'error-context-compaction',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      error: new ContextCompactionError(
        errorCode,
        'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
        '没有可替换的完整历史区段。',
      ),
    });

    expect(event).toMatchObject({
      type: 'error',
      error_code: errorCode,
      retryable: false,
    });
  });
});
