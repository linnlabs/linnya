import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandApprovalRequestIdSchema,
  CommandConversationApprovalCandidateSchema,
  CommandConversationIdSchema,
} from '@app/schemas/commands';

import {
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
  CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  createConversationDirectoryCleanupJob,
  deriveConversationWorkDirectoryIdentity,
  type ConversationDirectoryCleanupJobPort,
  type ConversationDirectoryDeletionPort,
  type ConversationDirectoryPort,
} from '../../../../../domains/conversation-files';
import type {
  ConversationCommandApprovalDeletionPort,
} from '../../../../../domains/commands';
import { CORE_SCHEMAS } from '../../../../../features/workspace/infrastructure/sqlite/schemas/core.schema';
import { ASSET_LEDGER_SCHEMAS } from '../../../../../domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { createLocalConversationDirectoryPort } from '../../../../../infra/adapters/conversation-files/local-directory';
import {
  createEventStoreConversationFactsDeletionPort,
  createEventStoreConversationFactsPort,
} from '../../../adapters/persistence/conversation-facts';
import {
  CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../adapters/persistence/conversation-files';
import {
  COMMAND_APPROVAL_SCHEMAS,
  SqliteConversationCommandApprovalPort,
} from '../../../adapters/persistence/command-approvals';
import { CONVERSATION_SCHEMAS } from '../../../adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from '../../../adapters/persistence/event-store';
import type { ConversationCleanupActivityPort } from '../definitions/conversationCleanupActivityPort';
import type { ConversationCleanupFailureStage } from '../definitions/conversationCleanupUseCase';
import type { ConversationFactsDeletionPort } from '../definitions/conversationFactsDeletionPort';
import type { ConversationFactsPort } from '../definitions/conversationFactsPort';
import { createConversationLifecycleApplicationScope } from '../orchestration/createConversationLifecycleApplicationScope';
import { requestConversationDeletion } from '../orchestration/deleteConversation';
import { executeConversationDirectoryCleanupJob } from '../orchestration/executeConversationDirectoryCleanupJob';
import { recoverPendingConversationCleanupJobs } from '../orchestration/recoverPendingConversationCleanupJobs';

interface ConversationDeletionFixture {
  readonly root: string;
  readonly db: Database.Database;
  readonly eventStore: SQLiteEventStore;
  readonly jobs: SqliteConversationDirectoryCleanupJobPort;
  readonly approvals: SqliteConversationCommandApprovalPort;
  readonly directories: ConversationDirectoryPort & ConversationDirectoryDeletionPort;
  readonly facts: ConversationFactsPort;
  readonly factsDeletion: ConversationFactsDeletionPort;
}

const testRoots: string[] = [];
const testDatabases: Database.Database[] = [];

async function createFixture(label: string): Promise<ConversationDeletionFixture> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-deletion-${label}-`));
  testRoots.push(root);
  const db = new Database(path.join(root, 'workspace.sqlite'));
  testDatabases.push(db);
  db.pragma('foreign_keys = ON');
  for (const ddl of [
    ...CORE_SCHEMAS,
    ...ASSET_LEDGER_SCHEMAS,
    ...CONVERSATION_SCHEMAS,
    ...CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
    ...COMMAND_APPROVAL_SCHEMAS,
  ]) {
    db.exec(ddl);
  }
  const eventStore = new SQLiteEventStore(db);
  return {
    root,
    db,
    eventStore,
    jobs: new SqliteConversationDirectoryCleanupJobPort(db),
    approvals: new SqliteConversationCommandApprovalPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: root }),
    facts: createEventStoreConversationFactsPort(eventStore),
    factsDeletion: createEventStoreConversationFactsDeletionPort(eventStore),
  };
}

function createUserInput(conversationId: string): RuntimeEvent {
  return {
    id: `message-${conversationId}`,
    type: 'user_input',
    timestamp: 1_785_499_200_000,
    conversation_id: conversationId,
    turn_id: `turn-${conversationId}`,
    version: 1,
    content: `seed ${conversationId}`,
    source: 'user',
  };
}

async function seedConversation(
  fixture: ConversationDeletionFixture,
  conversationId: string,
): Promise<string> {
  await fixture.eventStore.ensureConversation(conversationId, [createUserInput(conversationId)]);
  const directory = await fixture.directories.ensureDirectory(
    deriveConversationWorkDirectoryIdentity(conversationId),
  );
  await fsp.writeFile(path.join(directory.absolutePath, 'work.txt'), 'work', 'utf8');
  return directory.absolutePath;
}

async function seedApproval(
  fixture: ConversationDeletionFixture,
  conversationId: string,
  sequence = 1,
): Promise<void> {
  await fixture.approvals.remember({
    approvalRequestId: CommandApprovalRequestIdSchema.parse(
      `command_approval_00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    ),
    conversationId: CommandConversationIdSchema.parse(conversationId),
    candidate: CommandConversationApprovalCandidateSchema.parse({
      token_prefix: ['git', 'status'],
      matching_context: {
        platform: 'macos',
        shell_semantics_id: 'zsh',
        matcher_revision: 'simple-command-v1',
      },
    }),
    approvedCwd: '/tmp/linnya-conversation-deletion',
    approvedAtMs: 1_785_499_200_000 + sequence,
  });
}

function metadataPaths(root: string, conversationId: string): readonly string[] {
  const identity = deriveConversationWorkDirectoryIdentity(conversationId);
  const metadataRoot = path.join(
    root,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  );
  return [
    path.join(metadataRoot, `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX}`),
    path.join(
      metadataRoot,
      `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX}`,
    ),
  ];
}

async function expectMissing(targetPath: string): Promise<void> {
  await expect(fsp.lstat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
}

function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = (): void => {
    throw new Error('deferred promise was not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({ promise, resolve: resolvePromise });
}

function passiveActivity(): ConversationCleanupActivityPort {
  return Object.freeze({
    beginStopping(): void {},
    async stopAndWait(): Promise<void> {},
    forgetDeletedConversation(): void {},
  });
}

function passiveCommandCardSettlements() {
  return Object.freeze({ async deleteForConversationAndWait(): Promise<void> {} });
}

function createUseCaseScope(fixture: ConversationDeletionFixture) {
  return createConversationLifecycleApplicationScope({
    cleanupJobs: fixture.jobs,
    directories: fixture.directories,
    facts: fixture.facts,
  });
}

afterEach(async () => {
  for (const db of testDatabases.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  await Promise.all(testRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('conversation deletion use case', () => {
  it('按持久任务、活动、目录、批准、事实、metadata 和任务完成的固定顺序删除', async () => {
    const fixture = await createFixture('ordered');
    const conversationId = 'conversation-deletion-ordered';
    const workDirectory = await seedConversation(fixture, conversationId);
    await seedApproval(fixture, conversationId);
    const observed: string[] = [];
    const scope = createUseCaseScope(fixture);

    const jobs: ConversationDirectoryCleanupJobPort = {
      begin: async (job) => {
        const begun = await fixture.jobs.begin(job);
        observed.push('cleanup_job_persisted');
        return begun;
      },
      read: conversation => fixture.jobs.read(conversation),
      list: () => fixture.jobs.list(),
      recordFailure: failure => fixture.jobs.recordFailure(failure),
      complete: async (job) => {
        observed.push('complete_cleanup_job');
        return fixture.jobs.complete(job);
      },
    };
    const directories: ConversationDirectoryDeletionPort = {
      deleteWorkDirectory: async (identity) => {
        observed.push('delete_work_directory');
        await fixture.directories.deleteWorkDirectory(identity);
      },
      deleteIdentityMetadata: async (identity) => {
        observed.push('delete_identity_metadata');
        await fixture.directories.deleteIdentityMetadata(identity);
      },
    };
    const factsDeletion: ConversationFactsDeletionPort = {
      deleteConversationFacts: async (conversation) => {
        observed.push('delete_conversation_facts');
        return fixture.factsDeletion.deleteConversationFacts(conversation);
      },
    };
    const approvals: ConversationCommandApprovalDeletionPort = {
      deleteForConversation: async (conversation) => {
        observed.push('delete_conversation_approvals');
        await fixture.approvals.deleteForConversation(conversation);
      },
    };

    await expect(requestConversationDeletion({
      conversationId,
      gate: scope.gate,
      jobs,
      directories,
      approvals,
      commandCardSettlements: {
        async deleteForConversationAndWait(): Promise<void> {
          observed.push('delete_command_card_settlements');
        },
      },
      activity: {
        beginStopping(): void {
          observed.push('begin_stopping_activity');
        },
        async stopAndWait(): Promise<void> {
          observed.push('stop_conversation_activity');
        },
        forgetDeletedConversation(): void {
          observed.push('forget_deleted_conversation');
        },
      },
      facts: fixture.facts,
      factsDeletion,
      createJobUuid: () => '00000000-0000-4000-8000-000000000101',
      now: () => 1_785_499_200_100,
    })).resolves.toBe(true);

    expect(observed).toEqual([
      'cleanup_job_persisted',
      'begin_stopping_activity',
      'begin_stopping_activity',
      'stop_conversation_activity',
      'delete_work_directory',
      'delete_conversation_approvals',
      'delete_command_card_settlements',
      'delete_conversation_facts',
      'delete_identity_metadata',
      'forget_deleted_conversation',
      'complete_cleanup_job',
    ]);
    await expectMissing(workDirectory);
    for (const markerPath of metadataPaths(fixture.root, conversationId)) {
      await expectMissing(markerPath);
    }
    await expect(fixture.eventStore.getConversationMetadata(conversationId)).resolves.toBeNull();
    await expect(fixture.approvals.listForConversation(
      CommandConversationIdSchema.parse(conversationId),
    )).resolves.toEqual([]);
    await expect(fixture.jobs.read(deriveConversationWorkDirectoryIdentity(
      conversationId,
    ).conversationId)).resolves.toBeNull();
  });

  it('事实不存在且没有 cleanup job 时返回 not found，不建立任务或停止活动', async () => {
    const fixture = await createFixture('not-found');
    const scope = createUseCaseScope(fixture);
    let activityStopCount = 0;

    await expect(requestConversationDeletion({
      conversationId: 'conversation-deletion-missing',
      gate: scope.gate,
      jobs: fixture.jobs,
      directories: fixture.directories,
      approvals: fixture.approvals,
      commandCardSettlements: passiveCommandCardSettlements(),
      activity: {
        beginStopping(): void {},
        async stopAndWait(): Promise<void> {
          activityStopCount += 1;
        },
        forgetDeletedConversation(): void {},
      },
      facts: fixture.facts,
      factsDeletion: fixture.factsDeletion,
      createJobUuid: () => '00000000-0000-4000-8000-000000000102',
      now: () => 1_785_499_200_200,
    })).resolves.toBe(false);

    expect(activityStopCount).toBe(0);
    await expect(fixture.jobs.list()).resolves.toEqual([]);
  });

  it('job 落盘后立即释放 gate，使并发准入直接命中持久 barrier', async () => {
    const fixture = await createFixture('admission-barrier');
    const conversationId = 'conversation-deletion-admission-barrier';
    await seedConversation(fixture, conversationId);
    const scope = createUseCaseScope(fixture);
    const activityStarted = createDeferred();
    const activityRelease = createDeferred();

    const deletion = requestConversationDeletion({
      conversationId,
      gate: scope.gate,
      jobs: fixture.jobs,
      directories: fixture.directories,
      approvals: fixture.approvals,
      commandCardSettlements: passiveCommandCardSettlements(),
      activity: {
        beginStopping(): void {},
        async stopAndWait(): Promise<void> {
          activityStarted.resolve();
          await activityRelease.promise;
        },
        forgetDeletedConversation(): void {},
      },
      facts: fixture.facts,
      factsDeletion: fixture.factsDeletion,
      createJobUuid: () => '00000000-0000-4000-8000-000000000103',
      now: () => 1_785_499_200_300,
    });
    await activityStarted.promise;

    await expect(scope.persistenceAdmission.withAdmission({
      conversationId,
      initialEvents: [],
    }, admission => admission)).rejects.toMatchObject({
      code: 'work_directory_cleanup_in_progress',
      stage: 'check_cleanup_barrier',
    });

    activityRelease.resolve();
    await expect(deletion).resolves.toBe(true);
  });

  it('七个崩溃边界都保留一次失败事实，并可从固定步骤起点幂等恢复', async () => {
    const failureStages: readonly ConversationCleanupFailureStage[] = [
      'stop_conversation_activity',
      'delete_work_directory',
      'delete_conversation_approvals',
      'delete_command_card_settlements',
      'delete_conversation_facts',
      'delete_identity_metadata',
      'complete_cleanup_job',
    ];

    for (const [index, failureStage] of failureStages.entries()) {
      const fixture = await createFixture(`crash-${failureStage}`);
      const conversationId = `conversation-deletion-crash-${failureStage}`;
      const workDirectory = await seedConversation(fixture, conversationId);
      await seedApproval(fixture, conversationId, 100 + index);
      const scope = createUseCaseScope(fixture);
      let failureRemaining = true;
      let forgottenConversationCount = 0;
      const inject = (stage: ConversationCleanupFailureStage): void => {
        if (failureRemaining && failureStage === stage) {
          failureRemaining = false;
          throw new Error(`injected crash before ${stage}`);
        }
      };
      const activity: ConversationCleanupActivityPort = {
        beginStopping(): void {},
        async stopAndWait(): Promise<void> {
          inject('stop_conversation_activity');
        },
        forgetDeletedConversation(): void {
          forgottenConversationCount += 1;
        },
      };
      const directories: ConversationDirectoryDeletionPort = {
        async deleteWorkDirectory(identity): Promise<void> {
          inject('delete_work_directory');
          await fixture.directories.deleteWorkDirectory(identity);
        },
        async deleteIdentityMetadata(identity): Promise<void> {
          inject('delete_identity_metadata');
          await fixture.directories.deleteIdentityMetadata(identity);
        },
      };
      const factsDeletion: ConversationFactsDeletionPort = {
        async deleteConversationFacts(conversation) {
          inject('delete_conversation_facts');
          return fixture.factsDeletion.deleteConversationFacts(conversation);
        },
      };
      const approvals: ConversationCommandApprovalDeletionPort = {
        async deleteForConversation(conversation): Promise<void> {
          inject('delete_conversation_approvals');
          await fixture.approvals.deleteForConversation(conversation);
        },
      };
      const commandCardSettlements = {
        async deleteForConversationAndWait(): Promise<void> {
          inject('delete_command_card_settlements');
        },
      };
      const jobs: ConversationDirectoryCleanupJobPort = {
        begin: job => fixture.jobs.begin(job),
        read: conversation => fixture.jobs.read(conversation),
        list: () => fixture.jobs.list(),
        recordFailure: failure => fixture.jobs.recordFailure(failure),
        async complete(job): Promise<boolean> {
          inject('complete_cleanup_job');
          return fixture.jobs.complete(job);
        },
      };

      await expect(requestConversationDeletion({
        conversationId,
        gate: scope.gate,
        jobs,
        directories,
        approvals,
        commandCardSettlements,
        activity,
        facts: fixture.facts,
        factsDeletion,
        createJobUuid: () => `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
        now: () => 1_785_499_201_000 + index,
      })).rejects.toMatchObject({
        failure: { stage: failureStage },
      });
      expect(forgottenConversationCount).toBe(
        failureStage === 'complete_cleanup_job' ? 1 : 0,
      );

      const identity = deriveConversationWorkDirectoryIdentity(conversationId);
      await expect(fixture.jobs.read(identity.conversationId)).resolves.toMatchObject({
        retryCount: 1,
        lastFailure: { stage: failureStage },
      });
      if (failureStage === 'delete_conversation_approvals') {
        await expect(fixture.approvals.listForConversation(
          CommandConversationIdSchema.parse(conversationId),
        )).resolves.toHaveLength(1);
        await expect(fixture.eventStore.getConversationMetadata(conversationId))
          .resolves.not.toBeNull();
      }

      await expect(recoverPendingConversationCleanupJobs({
        gate: scope.gate,
        jobs: fixture.jobs,
        directories: fixture.directories,
        approvals: fixture.approvals,
        commandCardSettlements: passiveCommandCardSettlements(),
        activity: passiveActivity(),
        facts: fixture.factsDeletion,
      })).resolves.toMatchObject({
        listedCount: 1,
        completedCount: 1,
        supersededCount: 0,
        failures: [],
      });
      await expectMissing(workDirectory);
      for (const markerPath of metadataPaths(fixture.root, conversationId)) {
        await expectMissing(markerPath);
      }
      await expect(fixture.eventStore.getConversationMetadata(conversationId)).resolves.toBeNull();
      await expect(fixture.approvals.listForConversation(
        CommandConversationIdSchema.parse(conversationId),
      )).resolves.toEqual([]);
      await expect(fixture.jobs.read(identity.conversationId)).resolves.toBeNull();
    }
  });

  it('只清理工作目录时保留对话事实和批准记忆', async () => {
    const fixture = await createFixture('clear-work-directory');
    const conversationId = 'conversation-clear-work-directory';
    const workDirectory = await seedConversation(fixture, conversationId);
    await seedApproval(fixture, conversationId, 250);
    const identity = deriveConversationWorkDirectoryIdentity(conversationId);
    const clearJob = createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000250',
      identity,
      operation: 'clear_work_directory',
      requestedAt: 1_785_499_201_250,
    });
    await fixture.jobs.begin(clearJob);

    await expect(executeConversationDirectoryCleanupJob({
      job: clearJob,
      ports: {
        jobs: fixture.jobs,
        directories: fixture.directories,
        approvals: fixture.approvals,
        commandCardSettlements: passiveCommandCardSettlements(),
        facts: fixture.factsDeletion,
        activity: passiveActivity(),
      },
    })).resolves.toBe('completed');

    await expectMissing(workDirectory);
    await expect(fixture.eventStore.getConversationMetadata(conversationId))
      .resolves.not.toBeNull();
    await expect(fixture.approvals.listForConversation(
      CommandConversationIdSchema.parse(conversationId),
    )).resolves.toHaveLength(1);
    await expect(fixture.jobs.read(identity.conversationId)).resolves.toBeNull();
  });

  it('clear 升级为 delete 后，旧 worker 不能完成或改写更强任务', async () => {
    const fixture = await createFixture('upgrade');
    const conversationId = 'conversation-deletion-upgrade';
    await seedConversation(fixture, conversationId);
    const identity = deriveConversationWorkDirectoryIdentity(conversationId);
    const clearJob = createConversationDirectoryCleanupJob({
      jobId: 'conversation_cleanup_00000000-0000-4000-8000-000000000301',
      identity,
      operation: 'clear_work_directory',
      requestedAt: 1_785_499_202_000,
    });
    await fixture.jobs.begin(clearJob);
    const scope = createUseCaseScope(fixture);
    const oldStarted = createDeferred();
    const oldRelease = createDeferred();
    const upgradedStarted = createDeferred();
    const upgradedRelease = createDeferred();

    const oldWorker = executeConversationDirectoryCleanupJob({
      job: clearJob,
      ports: {
        jobs: fixture.jobs,
        directories: fixture.directories,
        approvals: fixture.approvals,
        commandCardSettlements: passiveCommandCardSettlements(),
        facts: fixture.factsDeletion,
        activity: {
          beginStopping(): void {},
          async stopAndWait(): Promise<void> {
            oldStarted.resolve();
            await oldRelease.promise;
          },
          forgetDeletedConversation(): void {},
        },
      },
    });
    await oldStarted.promise;

    const upgradedWorker = requestConversationDeletion({
      conversationId,
      gate: scope.gate,
      jobs: fixture.jobs,
      directories: fixture.directories,
      approvals: fixture.approvals,
      commandCardSettlements: passiveCommandCardSettlements(),
      facts: fixture.facts,
      factsDeletion: fixture.factsDeletion,
      activity: {
        beginStopping(): void {},
        async stopAndWait(): Promise<void> {
          upgradedStarted.resolve();
          await upgradedRelease.promise;
        },
        forgetDeletedConversation(): void {},
      },
      createJobUuid: () => '00000000-0000-4000-8000-000000000302',
      now: () => 1_785_499_202_100,
    });
    await upgradedStarted.promise;
    await expect(fixture.jobs.read(identity.conversationId)).resolves.toMatchObject({
      jobId: clearJob.jobId,
      operation: 'delete_conversation',
    });

    oldRelease.resolve();
    await expect(oldWorker).resolves.toBe('superseded');
    await expect(fixture.jobs.read(identity.conversationId)).resolves.toMatchObject({
      operation: 'delete_conversation',
      retryCount: 0,
    });
    upgradedRelease.resolve();
    await expect(upgradedWorker).resolves.toBe(true);
    await expect(fixture.eventStore.getConversationMetadata(conversationId)).resolves.toBeNull();
    await expect(fixture.jobs.read(identity.conversationId)).resolves.toBeNull();
  });

  it('启动恢复中一个对话失败不会阻塞后续对话完成', async () => {
    const fixture = await createFixture('recovery-isolation');
    const failedConversationId = 'conversation-deletion-recovery-a';
    const completedConversationId = 'conversation-deletion-recovery-b';
    for (const [index, conversationId] of [
      failedConversationId,
      completedConversationId,
    ].entries()) {
      await seedConversation(fixture, conversationId);
      const identity = deriveConversationWorkDirectoryIdentity(conversationId);
      await fixture.jobs.begin(createConversationDirectoryCleanupJob({
        jobId: `conversation_cleanup_00000000-0000-4000-8000-${String(401 + index).padStart(12, '0')}`,
        identity,
        operation: 'delete_conversation',
        requestedAt: 1_785_499_203_000 + index,
      }));
    }
    const scope = createUseCaseScope(fixture);

    const summary = await recoverPendingConversationCleanupJobs({
      gate: scope.gate,
      jobs: fixture.jobs,
      directories: fixture.directories,
      approvals: fixture.approvals,
      commandCardSettlements: passiveCommandCardSettlements(),
      facts: fixture.factsDeletion,
      activity: {
        beginStopping(): void {},
        async stopAndWait(conversationId): Promise<void> {
          if (conversationId === failedConversationId) {
            throw new Error('injected owner shutdown failure');
          }
        },
        forgetDeletedConversation(): void {},
      },
    });

    expect(summary).toMatchObject({
      listedCount: 2,
      completedCount: 1,
      supersededCount: 0,
    });
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({
      job: { conversationId: failedConversationId, retryCount: 0 },
      failure: { stage: 'stop_conversation_activity' },
    });
    const failedIdentity = deriveConversationWorkDirectoryIdentity(failedConversationId);
    const completedIdentity = deriveConversationWorkDirectoryIdentity(completedConversationId);
    await expect(fixture.jobs.read(failedIdentity.conversationId)).resolves.toMatchObject({
      retryCount: 1,
    });
    await expect(fixture.jobs.read(completedIdentity.conversationId)).resolves.toBeNull();
    await expect(fixture.eventStore.getConversationMetadata(failedConversationId))
      .resolves.not.toBeNull();
    await expect(fixture.eventStore.getConversationMetadata(completedConversationId))
      .resolves.toBeNull();
  });
});
