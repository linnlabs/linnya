import { describe, expect, it } from 'vitest';

import { deriveConversationWorkDirectoryIdentity } from '../../work-directory';
import {
  advanceConversationDirectoryCleanupFailure,
  createConversationDirectoryCleanupJob,
  resolveConversationDirectoryCleanupJobBegin,
} from './resolveConversationDirectoryCleanupJob';

function createJob(
  operation: 'clear_work_directory' | 'delete_conversation',
  sequence = 1,
) {
  return createConversationDirectoryCleanupJob({
    jobId: `conversation_cleanup_00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    identity: deriveConversationWorkDirectoryIdentity('cleanup-domain-conversation'),
    operation,
    requestedAt: 1_785_499_200_000,
  });
}

describe('Conversation directory cleanup job rules', () => {
  it('首次请求建立窄任务，相同请求复用原始生命周期', () => {
    const requested = createJob('clear_work_directory');
    const created = resolveConversationDirectoryCleanupJobBegin({
      existing: null,
      requested,
    });
    const existing = resolveConversationDirectoryCleanupJobBegin({
      existing: created.job,
      requested: createConversationDirectoryCleanupJob({
        jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000002',
        identity: deriveConversationWorkDirectoryIdentity('cleanup-domain-conversation'),
        operation: 'clear_work_directory',
        requestedAt: requested.requestedAt + 5_000,
      }),
    });

    expect(created).toEqual({ status: 'created', job: requested });
    expect(existing).toEqual({ status: 'existing', job: requested });
  });

  it('删除整个对话可以支配仅清理目录，反向请求不能降级', () => {
    const clear = createJob('clear_work_directory');
    const deletion = createJob('delete_conversation', 2);

    const upgraded = resolveConversationDirectoryCleanupJobBegin({
      existing: clear,
      requested: deletion,
    });
    expect(upgraded.status).toBe('upgraded');
    expect(upgraded.job).toEqual({
      ...clear,
      operation: 'delete_conversation',
    });

    expect(resolveConversationDirectoryCleanupJobBegin({
      existing: upgraded.job,
      requested: clear,
    })).toEqual({
      status: 'existing',
      job: upgraded.job,
    });
  });

  it('只有匹配当前 jobId 和 operation 的 worker 可以记录失败', () => {
    const clear = createJob('clear_work_directory');
    const failure = {
      code: 'work_directory_in_use',
      stage: 'delete_work_directory' as const,
    };

    expect(advanceConversationDirectoryCleanupFailure({
      existing: clear,
      scope: {
        jobId: clear.jobId,
        conversationId: clear.conversationId,
        operation: 'clear_work_directory',
      },
      failure,
    })).toEqual({
      ...clear,
      retryCount: 1,
      lastFailure: failure,
    });

    expect(advanceConversationDirectoryCleanupFailure({
      existing: { ...clear, operation: 'delete_conversation' },
      scope: {
        jobId: clear.jobId,
        conversationId: clear.conversationId,
        operation: 'clear_work_directory',
      },
      failure,
    })).toBeNull();

    expect(advanceConversationDirectoryCleanupFailure({
      existing: clear,
      scope: {
        jobId: createJob('clear_work_directory', 2).jobId,
        conversationId: clear.conversationId,
        operation: 'clear_work_directory',
      },
      failure,
    })).toBeNull();
  });
});
