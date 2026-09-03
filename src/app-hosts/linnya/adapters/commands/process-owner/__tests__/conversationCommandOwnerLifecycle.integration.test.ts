import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  parseCommandExecutionTerminal,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  type CommandExecutionRuntimeStopCause,
  type PreparedCommandExecutionRuntime,
} from '../../../../../../domains/commands';
import {
  deriveConversationWorkDirectoryIdentity,
} from '../../../../../../domains/conversation-files';
import {
  createLocalConversationDirectoryPort,
} from '../../../../../../infra/adapters/conversation-files/local-directory';
import {
  createNodeShellWorkingDirectoryFileSystemPort,
} from '../../../../../../infra/adapters/command-runtime/working-directory';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import {
  CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA,
  SqliteConversationDirectoryCleanupJobPort,
} from '../../../persistence/conversation-files';
import {
  createConversationCleanupActivityPort,
  createConversationLifecycleApplicationScope,
  requestConversationDeletion,
  type ConversationCleanupActivityPort,
} from '../../../../application/conversation-lifecycle';
import { withShellWorkingDirectoryAdmission } from '../../shell-runtime';
import { createLocalCommandExecutionOwner } from '../orchestration/createLocalCommandExecutionOwner';

const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface Fixture {
  readonly root: string;
  readonly db: Database.Database;
  readonly jobs: SqliteConversationDirectoryCleanupJobPort;
  readonly directories: ReturnType<typeof createLocalConversationDirectoryPort>;
  readonly facts: Set<string>;
  readonly scope: ReturnType<typeof createConversationLifecycleApplicationScope>;
  readonly owner: ReturnType<typeof createLocalCommandExecutionOwner>;
  readonly activity: ReturnType<typeof createConversationCleanupActivityPort>;
}

const fixtures: Fixture[] = [];

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createOutputObservation() {
  return createBoundedPipeCommandOutputObservation({
    maxEvents: 1_024,
    maxCharacters: 4_000,
  });
}

async function createFixture(label: string): Promise<Fixture> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-command-owner-${label}-`));
  const db = new Database(path.join(root, 'workspace.sqlite'));
  for (const ddl of CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA) db.exec(ddl);
  const jobs = new SqliteConversationDirectoryCleanupJobPort(db);
  const directories = createLocalConversationDirectoryPort({ storageRoot: root });
  const facts = new Set<string>();
  const scope = createConversationLifecycleApplicationScope({
    cleanupJobs: jobs,
    directories,
    facts: {
      exists: async conversationId => facts.has(conversationId),
      ensure: async ({ conversationId }) => {
        facts.add(conversationId);
      },
    },
  });
  const owner = createLocalCommandExecutionOwner({ generationId: OWNER_GENERATION });
  const activity = createConversationCleanupActivityPort({
    commands: owner,
    stopFlowAndWait: async () => {},
  });
  const fixture = { root, db, jobs, directories, facts, scope, owner, activity };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    if (fixture.db.open) fixture.db.close();
    await fsp.rm(fixture.root, { recursive: true, force: true });
  }
});

function createIdentity(conversationId: string): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: 'lifecycle-agent-run',
    origin_tool_call_id: 'lifecycle-shell-call',
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: OWNER_GENERATION,
    created_at_ms: 1_785_585_700_000,
  });
}

function ownerEndedTerminal(identity: CommandExecutionIdentity): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity,
    settled_at_ms: 1_785_585_701_000,
    outcome: 'execution_ended',
    termination_cause: 'owner_ended',
    process_exit: { status: 'observed', exit_code: 1, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'succeeded' },
    resource_release: { status: 'succeeded' },
  });
}

async function reserveThroughDirectoryAdmission(
  fixture: Fixture,
  identity: CommandExecutionIdentity,
) {
  fixture.facts.add(identity.conversation_id);
  return withShellWorkingDirectoryAdmission({
    request: {
      conversationId: identity.conversation_id,
      platform: 'macos',
      permissionLevel: 'standard',
    },
    conversationAdmission: fixture.scope.workDirectoryAdmission,
    fileSystem: createNodeShellWorkingDirectoryFileSystemPort(),
    admitted: () => fixture.owner.reserve({ identity, mode: 'pipe' }),
  });
}

function deleteConversation(
  fixture: Fixture,
  conversationId: string,
  activity: ConversationCleanupActivityPort = fixture.activity,
): Promise<boolean> {
  return requestConversationDeletion({
    conversationId,
    gate: fixture.scope.gate,
    jobs: fixture.jobs,
    directories: fixture.directories,
    approvals: { deleteForConversation: async () => {} },
    commandCardSettlements: { deleteForConversationAndWait: async () => {} },
    activity,
    facts: {
      exists: async id => fixture.facts.has(id),
      ensure: async ({ conversationId: id }) => {
        fixture.facts.add(id);
      },
    },
    factsDeletion: {
      deleteConversationFacts: async (id) => {
        const deleted = fixture.facts.delete(id);
        return deleted ? 'deleted' : 'not_found';
      },
    },
    createJobUuid: randomUUID,
    now: () => 1_785_585_702_000,
  });
}

describe('conversation lifecycle and command owner', () => {
  it('gate 内 reservation 先可见，删除随后让迟到 claim 永远不能启动', async () => {
    const fixture = await createFixture('delete-before-claim');
    const identity = createIdentity('lifecycle-delete-before-claim');
    const reserved = await reserveThroughDirectoryAdmission(fixture, identity);
    expect(reserved.status).toBe('reserved');
    if (reserved.status !== 'reserved') throw new Error('reservation rejected');
    const directoryPath = fixture.directories.resolvePath(
      deriveConversationWorkDirectoryIdentity(identity.conversation_id),
    );

    await expect(deleteConversation(fixture, identity.conversation_id)).resolves.toBe(true);
    let startCount = 0;
    await expect(fixture.owner.claimAndStart({
      binding: reserved.binding,
      prepareRuntime: () => {
        startCount += 1;
        throw new Error('late start must not run');
      },
    })).resolves.toMatchObject({ status: 'rejected' });
    expect(startCount).toBe(0);
    expect(fixture.owner.readActivitySnapshot()).toMatchObject({
      reservedCount: 0,
      startingCount: 0,
      runningCount: 0,
    });
    await expect(fsp.lstat(directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('claim 先赢时删除等待 starting 的迟到 runtime 被停止并结算', async () => {
    const fixture = await createFixture('start-before-delete');
    const identity = createIdentity('lifecycle-start-before-delete');
    const reserved = await reserveThroughDirectoryAdmission(fixture, identity);
    if (reserved.status !== 'reserved') throw new Error('reservation rejected');
    const directoryPath = fixture.directories.resolvePath(
      deriveConversationWorkDirectoryIdentity(identity.conversation_id),
    );
    const startEntered = createDeferred<void>();
    const releaseStart = createDeferred<void>();
    const stopCalled = createDeferred<CommandExecutionRuntimeStopCause>();
    const beginStoppingCalled = createDeferred<void>();
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const runtime: PreparedCommandExecutionRuntime = {
      interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
      outputObservation: createOutputObservation(),
      settledTextOutput: unavailableSettledTextOutput(),
      terminal: terminal.promise,
      async start() {
        startEntered.resolve();
        await releaseStart.promise;
        return { status: 'running', startedAtMs: 200 };
      },
      async stopAndWait(cause) {
        stopCalled.resolve(cause);
        return terminal.promise;
      },
    };

    const starting = fixture.owner.claimAndStart({
      binding: reserved.binding,
      prepareRuntime: () => runtime,
    });
    await startEntered.promise;
    const deletion = deleteConversation(fixture, identity.conversation_id, {
      beginStopping(conversationId) {
        fixture.activity.beginStopping(conversationId);
        beginStoppingCalled.resolve();
      },
      stopAndWait: conversationId => fixture.activity.stopAndWait(conversationId),
      forgetDeletedConversation: conversationId => (
        fixture.activity.forgetDeletedConversation(conversationId)
      ),
    });
    await beginStoppingCalled.promise;
    await expect(stopCalled.promise).resolves.toBe('owner_ended');

    // stop terminal 还没到达时，cleanup job 仍存在，工作目录也不能先删。
    const cleanupConversationId = deriveConversationWorkDirectoryIdentity(
      identity.conversation_id,
    ).conversationId;
    await expect(fixture.jobs.read(cleanupConversationId)).resolves.not.toBeNull();
    await expect(fsp.lstat(directoryPath)).resolves.toBeDefined();
    terminal.resolve(ownerEndedTerminal(identity));
    // terminal 已到达但 start 的后半段尚未结束时，删除 barrier 仍必须保留目录；
    // 否则迟到 start 可能继续访问已经被删除的 cwd。
    await Promise.resolve();
    await expect(fixture.jobs.read(cleanupConversationId)).resolves.not.toBeNull();
    await expect(fsp.lstat(directoryPath)).resolves.toBeDefined();
    releaseStart.resolve();
    await expect(starting).resolves.toMatchObject({ status: 'terminal' });
    await expect(deletion).resolves.toBe(true);
    await expect(fsp.lstat(directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fixture.jobs.read(cleanupConversationId)).resolves.toBeNull();
  });

  it('停止终态未能证明整树清理时保留 cleanup job、工作目录和对话事实', async () => {
    const fixture = await createFixture('tree-cleanup-failed');
    const identity = createIdentity('lifecycle-tree-cleanup-failed');
    const reserved = await reserveThroughDirectoryAdmission(fixture, identity);
    if (reserved.status !== 'reserved') throw new Error('reservation rejected');
    const directoryIdentity = deriveConversationWorkDirectoryIdentity(identity.conversation_id);
    const directoryPath = fixture.directories.resolvePath(directoryIdentity);
    const terminal = createDeferred<CommandExecutionTerminalV1>();

    const started = await fixture.owner.claimAndStart({
      binding: reserved.binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          const failed = parseCommandExecutionTerminal({
            ...ownerEndedTerminal(identity),
            tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
          });
          terminal.resolve(failed);
          return failed;
        },
      }),
    });
    expect(started.status).toBe('running');

    await expect(deleteConversation(fixture, identity.conversation_id)).rejects.toMatchObject({
      name: 'ConversationCleanupUseCaseError',
      failure: {
        stage: 'stop_conversation_activity',
      },
      operationError: {
        name: 'ConversationCleanupActivityStopError',
      },
    });
    await expect(fixture.jobs.read(directoryIdentity.conversationId)).resolves.not.toBeNull();
    await expect(fsp.lstat(directoryPath)).resolves.toBeDefined();
    expect(fixture.facts.has(identity.conversation_id)).toBe(true);
    expect(fixture.owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      stoppingCount: 1,
    });
  });

  it('删除一个对话不会停止另一个对话的 reservation 或 start', async () => {
    const fixture = await createFixture('parallel-conversations');
    const identityA = createIdentity('lifecycle-parallel-a');
    const identityB = createIdentity('lifecycle-parallel-b');
    const [reservedA, reservedB] = await Promise.all([
      reserveThroughDirectoryAdmission(fixture, identityA),
      reserveThroughDirectoryAdmission(fixture, identityB),
    ]);
    if (reservedA.status !== 'reserved' || reservedB.status !== 'reserved') {
      throw new Error('parallel reservation rejected');
    }

    await deleteConversation(fixture, identityA.conversation_id);
    const terminalB = createDeferred<CommandExecutionTerminalV1>();
    const startedB = await fixture.owner.claimAndStart({
      binding: reservedB.binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createOutputObservation(),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminalB.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        stopAndWait: async () => terminalB.promise,
      }),
    });
    expect(startedB.status).toBe('running');
    expect(fixture.owner.readActivitySnapshot().runningCount).toBe(1);

    terminalB.resolve(parseCommandExecutionTerminal({
      ...ownerEndedTerminal(identityB),
      termination_cause: 'natural_exit',
      tree_cleanup: { status: 'not_required' },
    }));
    if (startedB.status !== 'running') throw new Error('conversation B did not start');
    await startedB.terminal;
    expect(fixture.owner.readActivitySnapshot().runningCount).toBe(0);
  });
});
