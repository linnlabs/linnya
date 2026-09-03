import { describe, expect, it } from 'vitest';

import {
  advanceConversationDirectoryCleanupFailure,
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
  resolveConversationDirectoryCleanupJobBegin,
  type ConversationDirectoryCleanupJob,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryDeletionPort,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCommandApprovalDeletionPort,
} from '../../../../../domains/commands';
import type {
  ConversationCleanupActivityPort,
} from '../definitions/conversationCleanupActivityPort';
import type {
  ConversationFactsDeletionPort,
} from '../definitions/conversationFactsDeletionPort';
import type {
  ConversationFactsPort,
} from '../definitions/conversationFactsPort';
import { createConversationCleanupUseCase } from '../orchestration/createConversationCleanupUseCase';
import { createConversationLifecycleGate } from '../orchestration/createConversationLifecycleGate';

interface UseCaseHarness {
  readonly events: string[];
  readonly facts: ConversationFactsPort;
  readonly factsDeletion: ConversationFactsDeletionPort;
  readonly jobs: ConversationDirectoryCleanupJobPort;
  readonly directories: ConversationDirectoryDeletionPort;
  readonly approvals: ConversationCommandApprovalDeletionPort;
  readonly activity: ConversationCleanupActivityPort;
  hasFacts(): boolean;
  readJob(): ConversationDirectoryCleanupJob | null;
}

function createUseCaseHarness(input: {
  readonly factsExist: boolean;
  readonly pendingJob?: ConversationDirectoryCleanupJob;
}): UseCaseHarness {
  const events: string[] = [];
  let factsExist = input.factsExist;
  let currentJob = input.pendingJob ?? null;

  const jobs: ConversationDirectoryCleanupJobPort = {
    async begin(requested) {
      const result = resolveConversationDirectoryCleanupJobBegin({
        existing: currentJob,
        requested,
      });
      currentJob = result.job;
      events.push('job_begin');
      return result;
    },
    async read() {
      return currentJob;
    },
    async list() {
      return currentJob ? [currentJob] : [];
    },
    async recordFailure(request) {
      const failed = advanceConversationDirectoryCleanupFailure({
        existing: currentJob,
        scope: request,
        failure: request.failure,
      });
      currentJob = failed;
      return failed;
    },
    async complete(scope) {
      if (
        !currentJob
        || currentJob.jobId !== scope.jobId
        || currentJob.conversationId !== scope.conversationId
        || currentJob.operation !== scope.operation
      ) {
        return false;
      }
      events.push('job_complete');
      currentJob = null;
      return true;
    },
  };
  const facts: ConversationFactsPort = {
    async exists() {
      return factsExist;
    },
    async ensure() {
      factsExist = true;
    },
  };
  const factsDeletion: ConversationFactsDeletionPort = {
    async deleteConversationFacts() {
      events.push('facts_delete');
      if (!factsExist) return 'not_found';
      factsExist = false;
      return 'deleted';
    },
  };
  const directories: ConversationDirectoryDeletionPort = {
    async deleteWorkDirectory() {
      events.push('directory_delete');
    },
    async deleteIdentityMetadata() {
      events.push('metadata_delete');
    },
  };
  const approvals: ConversationCommandApprovalDeletionPort = {
    async deleteForConversation() {
      events.push('approvals_delete');
    },
  };
  const activity: ConversationCleanupActivityPort = {
    beginStopping() {
      events.push('activity_begin');
    },
    async stopAndWait() {
      events.push('activity_stop');
    },
    forgetDeletedConversation() {
      events.push('activity_forget');
    },
  };

  return {
    events,
    facts,
    factsDeletion,
    jobs,
    directories,
    approvals,
    activity,
    hasFacts: () => factsExist,
    readJob: () => currentJob,
  };
}

function createUseCase(harness: UseCaseHarness) {
  return createConversationCleanupUseCase({
    gate: createConversationLifecycleGate(),
    jobs: harness.jobs,
    directories: harness.directories,
    approvals: harness.approvals,
    commandCardSettlements: {
      async deleteForConversationAndWait(): Promise<void> {},
    },
    activity: harness.activity,
    facts: harness.facts,
    factsDeletion: harness.factsDeletion,
  });
}

describe('createConversationCleanupUseCase', () => {
  it('精准清理只停止活动并删除工作目录，保留对话事实、批准和 identity', async () => {
    const harness = createUseCaseHarness({ factsExist: true });

    await expect(createUseCase(harness).requestWorkDirectoryClear(
      'conversation-bound-clear',
    )).resolves.toBe('cleared');
    expect(harness.events).toEqual([
      'job_begin',
      'activity_begin',
      'activity_begin',
      'activity_stop',
      'directory_delete',
      'job_complete',
    ]);
    expect(harness.hasFacts()).toBe(true);
    expect(harness.readJob()).toBeNull();

    const missing = createUseCaseHarness({ factsExist: false });
    await expect(createUseCase(missing).requestWorkDirectoryClear(
      'conversation-bound-clear-missing',
    )).resolves.toBe('not_found');
    expect(missing.events).toEqual([]);
  });

  it('精准清理遇到已有整段删除任务时只报告冲突，绝不代执行删除', async () => {
    const harness = createUseCaseHarness({ factsExist: true });
    const identity = deriveConversationWorkDirectoryIdentity('conversation-delete-pending');
    await harness.jobs.begin(createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_10000000-0000-4000-8000-000000000001',
      identity,
      operation: 'delete_conversation',
      requestedAt: 1,
    }));

    await expect(createUseCase(harness).requestWorkDirectoryClear(
      identity.conversationId,
    )).resolves.toBe('deletion_in_progress');
    expect(harness.events).toEqual(['job_begin', 'job_begin']);
    expect(harness.hasFacts()).toBe(true);
    await expect(harness.jobs.read(identity.conversationId)).resolves.toMatchObject({
      operation: 'delete_conversation',
    });
  });

  it('requestDeletion 绑定同一组 ports，并保留首次 not found 语义', async () => {
    const existing = createUseCaseHarness({ factsExist: true });
    const useCase = createUseCase(existing);

    await expect(useCase.requestDeletion('conversation-bound-request')).resolves.toBe(true);
    expect(Object.isFrozen(useCase)).toBe(true);
    expect(existing.events).toEqual([
      'job_begin',
      'activity_begin',
      'activity_begin',
      'activity_stop',
      'directory_delete',
      'approvals_delete',
      'facts_delete',
      'metadata_delete',
      'activity_forget',
      'job_complete',
    ]);
    expect(existing.hasFacts()).toBe(false);
    expect(existing.readJob()).toBeNull();

    const missing = createUseCaseHarness({ factsExist: false });
    await expect(createUseCase(missing).requestDeletion(
      'conversation-bound-missing',
    )).resolves.toBe(false);
    expect(missing.events).toEqual([]);
    expect(missing.readJob()).toBeNull();
  });

  it('recoverPending 使用创建时绑定的 ports 重放持久删除任务', async () => {
    const conversationId = 'conversation-bound-recovery';
    const pendingJob = createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000901',
      identity: deriveConversationWorkDirectoryIdentity(conversationId),
      operation: 'delete_conversation',
      requestedAt: 1_785_499_209_001,
    });
    const harness = createUseCaseHarness({ factsExist: true, pendingJob });

    await expect(createUseCase(harness).recoverPending()).resolves.toEqual({
      listedCount: 1,
      completedCount: 1,
      supersededCount: 0,
      failures: [],
    });
    expect(harness.events).toEqual([
      'activity_begin',
      'activity_begin',
      'activity_stop',
      'directory_delete',
      'approvals_delete',
      'facts_delete',
      'metadata_delete',
      'activity_forget',
      'job_complete',
    ]);
    expect(harness.hasFacts()).toBe(false);
    expect(harness.readJob()).toBeNull();
  });

  it('向 History 投影持久 barrier，并按原操作重试而不升级清理意图', async () => {
    const conversationId = 'conversation-pending-clear-retry';
    const pendingJob = createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000902',
      identity: deriveConversationWorkDirectoryIdentity(conversationId),
      operation: 'clear_work_directory',
      requestedAt: 1_785_499_209_002,
    });
    const harness = createUseCaseHarness({ factsExist: true, pendingJob });
    const useCase = createUseCase(harness);

    await expect(useCase.readPendingConversationIds([
      conversationId,
      'conversation-not-pending',
    ])).resolves.toEqual(new Set([conversationId]));
    await expect(useCase.retryPending(conversationId))
      .resolves.toBe('work_directory_cleared');

    expect(harness.events).toEqual([
      'activity_begin',
      'activity_begin',
      'activity_stop',
      'directory_delete',
      'job_complete',
    ]);
    expect(harness.hasFacts()).toBe(true);
    expect(harness.readJob()).toBeNull();
  });

  it('重试持久删除任务完成全部删除步骤，不开放部分删除后的对话', async () => {
    const conversationId = 'conversation-pending-delete-retry';
    const pendingJob = createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000903',
      identity: deriveConversationWorkDirectoryIdentity(conversationId),
      operation: 'delete_conversation',
      requestedAt: 1_785_499_209_003,
    });
    const harness = createUseCaseHarness({ factsExist: true, pendingJob });

    await expect(createUseCase(harness).retryPending(conversationId))
      .resolves.toBe('conversation_deleted');
    expect(harness.hasFacts()).toBe(false);
    expect(harness.readJob()).toBeNull();
    expect(harness.events).toContain('metadata_delete');
    expect(harness.events).toContain('activity_forget');
  });
});
