import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CommandExecutionIdentitySchema,
  CommandOutputSequenceSchema,
  ProcessOutputCursorSchema,
  hasSameCommandExecutionIdentity,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionIdentity,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';
import {
  CommandArtifactInstanceIdSchema,
  type CommandOutputArtifactOwner,
  type CommandOutputArtifactPort,
} from '../../../../../../domains/commands';
import {
  createBoundedPipeCommandOutputObservation,
  createFileCommandOutputArtifactPort,
  deriveCommandOutputArtifactRelativePaths,
} from '../../../../../../infra/adapters/command-runtime/output';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPipeCommandOutputSession as createProductionPipeCommandOutputSession,
} from '../orchestration/createPipeCommandOutputSession';

type PipeCommandOutputSessionTestInput = Omit<
  Parameters<typeof createProductionPipeCommandOutputSession>[0],
  'text'
>;

const temporaryRoots: string[] = [];

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createMemoryTextWriter(): ToolOutputTextBlobWriter {
  return {
    async append() {},
    async finalize() {
      return {
        blobId: randomUUID().replace(/-/gu, '').slice(0, 16),
        filePath: `/virtual/${randomUUID()}/manifest.json`,
        stagingCleanup: 'complete',
      };
    },
    async finalizeCommittedPrefix() {
      return { status: 'not_created', reason: 'no_committed_block' };
    },
    async abort() {},
  };
}

function createPipeCommandOutputSession(input: PipeCommandOutputSessionTestInput) {
  return createProductionPipeCommandOutputSession({
    ...input,
    text: {
      encoding: 'utf-8',
      observation: createBoundedPipeCommandOutputObservation({
        maxEvents: 1_024,
        maxCharacters: 4_000,
      }),
      currentLogicalLineLimits: { maxCharactersPerCurrentLine: 1_000 },
      agentTextProjectionLimits: {
        maxCharactersPerStream: 2_000,
        maxLinesPerStream: 200,
      },
      openWriter: async () => createMemoryTextWriter(),
    },
  });
}

function createIdentity(): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `conversation-${randomUUID()}`,
    agent_run_id: `agent-run-${randomUUID()}`,
    origin_tool_call_id: `tool-call-${randomUUID()}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: 100,
  });
}

function createOwner(identity = createIdentity()): CommandOutputArtifactOwner {
  return {
    identity,
    instance_id: CommandArtifactInstanceIdSchema.parse(`instance-${randomUUID()}`),
  };
}

async function createStorageRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-pipe-output-host-'));
  temporaryRoots.push(root);
  return root;
}

function started(identity: CommandExecutionIdentity): Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_started' }
> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_started',
    identity,
    started_at_ms: 200,
  });
  if (event.kind !== 'command_runner_started') throw new Error('invalid started fixture');
  return event;
}

function output(input: {
  readonly identity: CommandExecutionIdentity;
  readonly channel: 'stdout' | 'stderr';
  readonly sequence: number;
  readonly bytes: readonly number[];
}): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_output' }> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_output',
    identity: input.identity,
    channel: input.channel,
    sequence: CommandOutputSequenceSchema.parse(input.sequence),
    bytes: Uint8Array.from(input.bytes),
  });
  if (event.kind !== 'command_runner_output') throw new Error('invalid output fixture');
  return event;
}

function terminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly stdoutSequence?: number;
  readonly stdoutBytes?: number;
  readonly stderrSequence?: number;
  readonly stderrBytes?: number;
  readonly stdoutCompletion?: 'complete' | 'interrupted';
  readonly stderrCompletion?: 'complete' | 'interrupted';
}): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_terminal' }> {
  const stdoutCompletion = input.stdoutCompletion ?? 'complete';
  const stderrCompletion = input.stderrCompletion ?? 'complete';
  const terminalFact = parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: 300,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: stdoutCompletion === 'complete' && stderrCompletion === 'complete'
      ? { status: 'complete' }
      : {
          status: 'failed',
          code: 'output_drain_failed',
          reason: 'runtime_lost',
        },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_terminal',
    terminal: terminalFact,
    output_sources: {
      mode: 'pipe',
      stdout: {
        source_completion: stdoutCompletion,
        next_sequence: input.stdoutSequence ?? 0,
        observed_bytes: input.stdoutBytes ?? 0,
        ...(stdoutCompletion === 'interrupted'
          ? { interruption_reason: 'runtime_lost' }
          : {}),
      },
      stderr: {
        source_completion: stderrCompletion,
        next_sequence: input.stderrSequence ?? 0,
        observed_bytes: input.stderrBytes ?? 0,
        ...(stderrCompletion === 'interrupted'
          ? { interruption_reason: 'runtime_lost' }
          : {}),
      },
    },
  });
  if (event.kind !== 'command_runner_terminal') throw new Error('invalid terminal fixture');
  return event;
}

function prelaunchTerminal(identity: CommandExecutionIdentity): Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_terminal' }
> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_terminal',
    terminal: parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity,
      settled_at_ms: 300,
      outcome: 'runtime_failure',
      failure: { code: 'launch_failed' },
      process_exit: { status: 'not_started' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'not_required' },
    }),
  });
  if (event.kind !== 'command_runner_terminal') throw new Error('invalid prelaunch fixture');
  return event;
}

function executionDirectory(storageRoot: string, owner: CommandOutputArtifactOwner): string {
  const relative = deriveCommandOutputArtifactRelativePaths(owner, 'pipe');
  return path.join(storageRoot, ...relative.directorySegments);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('pipe command output host session', () => {
  it('artifact open 抛错时关闭 observation 并立即清除长期等待 timer', async () => {
    vi.useFakeTimers();
    try {
      const owner = createOwner();
      const observation = createBoundedPipeCommandOutputObservation({
        maxEvents: 16,
        maxCharacters: 1_000,
      });
      const waiting = observation.waitForChange({
        afterCursor: ProcessOutputCursorSchema.parse(0),
        waitTimeoutMs: 2_147_483_647,
      });
      expect(vi.getTimerCount()).toBe(1);

      await expect(createProductionPipeCommandOutputSession({
        owner,
        artifactPort: {
          async open() {
            throw new Error('injected artifact open failure');
          },
        },
        text: {
          encoding: 'utf-8',
          observation,
          currentLogicalLineLimits: { maxCharactersPerCurrentLine: 1_000 },
          agentTextProjectionLimits: {
            maxCharactersPerStream: 2_000,
            maxLinesPerStream: 200,
          },
          openWriter: async () => createMemoryTextWriter(),
        },
      })).rejects.toThrow('injected artifact open failure');

      await expect(waiting).resolves.toMatchObject({
        status: 'observed',
        observation: { outputPhase: 'closed' },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('真实双流只有在 runner sequence/byte 对账和 artifact 封存后才产生终态', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      retentionMs: 1_000,
    });
    const stdout = Uint8Array.from([0, 0xe4, 0xb8, 0xad, 0xff]);
    const stderr = Uint8Array.from([0x65, 0x72, 0x72, 0, 0x80]);

    expect(session.acceptStarted(started(owner.identity))).toEqual({ status: 'accepted' });
    expect(session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stdout',
      sequence: 0,
      bytes: [...stdout],
    }))).toEqual({ status: 'accepted' });
    expect(session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stderr',
      sequence: 0,
      bytes: [...stderr],
    }))).toEqual({ status: 'accepted' });

    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        stdoutSequence: 1,
        stdoutBytes: stdout.byteLength,
        stderrSequence: 1,
        stderrBytes: stderr.byteLength,
      }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal.outcome).toBe('execution_ended');
    expect(settlement.artifact.status).toBe('manifest_persisted');
    if (settlement.artifact.status !== 'manifest_persisted') return;
    expect(settlement.artifact.manifest).toMatchObject({
      mode: 'pipe',
      stdout: { status: 'complete', sha256: sha256(stdout) },
      stderr: { status: 'complete', sha256: sha256(stderr) },
    });
    expect(settlement.artifact.manifest).toMatchObject({ sealed_at_ms: 350 });
    expect(settlement.artifact.manifest.retention_until_ms).toBe(1_350);
    await expect(fsp.readFile(path.join(
      executionDirectory(storageRoot, owner),
      'stdout.bin',
    ))).resolves.toEqual(Buffer.from(stdout));
    await expect(fsp.readFile(path.join(
      executionDirectory(storageRoot, owner),
      'stderr.bin',
    ))).resolves.toEqual(Buffer.from(stderr));
  });

  it('业务进程确定未启动时关闭并丢弃空 artifact，不发布空 manifest', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });

    const settlement = await session.settleRunnerTerminal({
      event: prelaunchTerminal(owner.identity),
      sealedAtMs: 350,
    });

    expect(settlement.terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'launch_failed' },
      process_exit: { status: 'not_started' },
    });
    expect(settlement.artifact).toEqual({ status: 'discarded' });
    await expect(fsp.stat(executionDirectory(storageRoot, owner))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('收到 started 后即使零输出也封存真实空 manifest', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    session.acceptStarted(started(owner.identity));

    const settlement = await session.settleRunnerTerminal({
      event: terminal({ identity: owner.identity }),
      sealedAtMs: 350,
    });

    expect(settlement.artifact.status).toBe('manifest_persisted');
    if (settlement.artifact.status !== 'manifest_persisted') return;
    expect(settlement.artifact.manifest).toMatchObject({
      stdout: { status: 'complete', observed_bytes: 0, persisted_bytes: 0 },
      stderr: { status: 'complete', observed_bytes: 0, persisted_bytes: 0 },
    });
  });

  it('artifact open 失败不阻止 runner 终态，只准确保留全文不可用事实', async () => {
    const owner = createOwner();
    const openFailurePort: CommandOutputArtifactPort = {
      async open() {
        return {
          status: 'unavailable',
          failure: {
            code: 'permission_denied',
            stage: 'open',
            occurred_at_ms: 100,
            last_persisted_offset: 0,
          },
        };
      },
    };
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: openFailurePort,
    });
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stdout',
      sequence: 0,
      bytes: [1, 2, 3],
    }));

    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        stdoutSequence: 1,
        stdoutBytes: 3,
      }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal.outcome).toBe('execution_ended');
    expect(settlement.artifact).toMatchObject({
      status: 'unavailable',
      failure: { code: 'permission_denied', stage: 'open' },
    });
  });

  it('ToolOutput 文本写入失败不改命令终态或 raw artifact，Agent 预览仍可用', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createProductionPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      text: {
        encoding: 'utf-8',
        observation: createBoundedPipeCommandOutputObservation({
          maxEvents: 1_024,
          maxCharacters: 4_000,
        }),
        currentLogicalLineLimits: { maxCharactersPerCurrentLine: 1_000 },
        agentTextProjectionLimits: {
          maxCharactersPerStream: 2_000,
          maxLinesPerStream: 200,
        },
        openWriter: async () => ({
          async append() {
            throw new Error('injected ToolOutput failure');
          },
          async finalize() {
            throw new Error('writer with failed append cannot finalize');
          },
          async finalizeCommittedPrefix() {
            return { status: 'not_created' as const, reason: 'no_committed_block' as const };
          },
          async abort() {},
        }),
      },
    });
    const bytes = Buffer.from('visible despite text store failure\n', 'utf8');
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stdout',
      sequence: 0,
      bytes: [...bytes],
    }));

    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        stdoutSequence: 1,
        stdoutBytes: bytes.byteLength,
      }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal.outcome).toBe('execution_ended');
    expect(settlement.artifact).toMatchObject({
      status: 'manifest_persisted',
      manifest: { stdout: { status: 'complete' } },
    });
    expect(settlement.text.streams.stdout.blob).toEqual({
      status: 'unavailable',
      failureCode: 'writer_append_failed',
    });
    expect(settlement.text.agentPreview.stdout).toMatchObject({
      status: 'complete',
      text: 'visible despite text store failure\n',
    });
    await expect(fsp.readFile(path.join(
      executionDirectory(storageRoot, owner),
      'stdout.bin',
    ))).resolves.toEqual(bytes);
  });

  it('artifact finalize 未完成前不发布 terminal', async () => {
    const owner = createOwner();
    const finalizeEntered = deferred();
    const releaseFinalize = deferred();
    const artifactPort: CommandOutputArtifactPort = {
      async open() {
        return {
          status: 'opened',
          writer: {
            owner,
            mode: 'pipe',
            append() {
              return { status: 'accepted' };
            },
            async discardBeforeSourceStart() {
              return { status: 'discarded' };
            },
            async finalize(request) {
              finalizeEntered.resolve();
              await releaseFinalize.promise;
              return {
                status: 'manifest_persisted',
                manifest: {
                  version: 1,
                  owner,
                  sealed_at_ms: request.sealedAtMs,
                  retention_until_ms: request.retentionUntilMs,
                  mode: 'pipe',
                  stdout: {
                    status: 'complete',
                    source_completion: 'complete',
                    observed_bytes: 0,
                    persisted_bytes: 0,
                    last_persisted_offset: 0,
                    sha256: sha256(new Uint8Array()),
                  },
                  stderr: {
                    status: 'complete',
                    source_completion: 'complete',
                    observed_bytes: 0,
                    persisted_bytes: 0,
                    last_persisted_offset: 0,
                    sha256: sha256(new Uint8Array()),
                  },
                },
              };
            },
          },
        };
      },
    };
    const session = await createPipeCommandOutputSession({ owner, artifactPort });
    session.acceptStarted(started(owner.identity));
    const settlement = session.settleRunnerTerminal({
      event: terminal({ identity: owner.identity }),
      sealedAtMs: 350,
    });
    let published = false;
    void settlement.then(
      () => { published = true; },
      () => { published = true; },
    );

    await finalizeEntered.promise;
    await Promise.resolve();
    expect(published).toBe(false);
    releaseFinalize.resolve();
    await expect(settlement).resolves.toMatchObject({
      terminal: { outcome: 'execution_ended' },
      artifact: { status: 'manifest_persisted' },
    });
  });

  it('乱序 output 立即封住后续 byte，并把终态和 artifact 来源降为 runtime_lost', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stdout',
      sequence: 0,
      bytes: [1],
    }));

    expect(session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stdout',
      sequence: 2,
      bytes: [2],
    }))).toEqual({
      status: 'protocol_failure',
      failure: { code: 'sequence_mismatch', channel: 'stdout' },
    });
    expect(session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stderr',
      sequence: 0,
      bytes: [3],
    }))).toEqual({ status: 'ignored', reason: 'protocol_failed' });

    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        stdoutSequence: 2,
        stdoutBytes: 2,
        stderrSequence: 1,
        stderrBytes: 1,
      }),
      sealedAtMs: 350,
    });

    expect(settlement).toMatchObject({
      terminal: { outcome: 'runtime_failure', failure: { code: 'runtime_lost' } },
      protocolFailure: { code: 'sequence_mismatch', channel: 'stdout' },
      artifact: {
        status: 'manifest_persisted',
        manifest: {
          stdout: { status: 'incomplete', observed_bytes: 1, persisted_bytes: 1 },
          stderr: { status: 'incomplete', observed_bytes: 0, persisted_bytes: 0 },
        },
      },
      text: {
        streams: {
          stdout: { sourceCompletion: 'interrupted' },
          stderr: { sourceCompletion: 'interrupted' },
        },
      },
    });
    await expect(fsp.readFile(path.join(
      executionDirectory(storageRoot, owner),
      'stdout.bin',
    ))).resolves.toEqual(Buffer.from([1]));
  });

  it('terminal 虚报 observed byte 时 fail closed，不能把缺失正文标成完整', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stdout',
      sequence: 0,
      bytes: [1, 2],
    }));

    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        stdoutSequence: 1,
        stdoutBytes: 3,
      }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
    expect(settlement.protocolFailure).toEqual({
      code: 'terminal_source_mismatch',
      channel: 'stdout',
    });
    expect(settlement.artifact).toMatchObject({
      status: 'manifest_persisted',
      manifest: {
        stdout: { status: 'incomplete', observed_bytes: 2, persisted_bytes: 2 },
      },
    });
  });

  it('runner 丢失时保留已收到合法前缀，迟到事件不能生成第二终态', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stderr',
      sequence: 0,
      bytes: [4, 5],
    }));

    const first = session.settleRuntimeLoss({
      settledAtMs: 400,
      resourceRelease: 'succeeded',
    });
    expect(session.acceptOutput(output({
      identity: owner.identity,
      channel: 'stderr',
      sequence: 1,
      bytes: [6],
    }))).toEqual({ status: 'ignored', reason: 'settled' });
    const second = session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        stderrSequence: 1,
        stderrBytes: 2,
      }),
      sealedAtMs: 450,
    });

    expect(second).toBe(first);
    const settlement = await first;
    expect(settlement.terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      process_exit: { status: 'unavailable', reason: 'runtime_lost' },
    });
    expect(settlement.artifact).toMatchObject({
      status: 'manifest_persisted',
      manifest: {
        stderr: { status: 'incomplete', observed_bytes: 2, persisted_bytes: 2 },
      },
    });
  });

  it('fork 前确定失败可以丢弃；收到错误 identity 后不能走这条捷径', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const clean = await createPipeCommandOutputSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    const cleanSettlement = await clean.settleBeforeSourceStart({
      settledAtMs: 500,
      failureCode: 'runtime_unavailable',
    });
    expect(cleanSettlement.artifact).toEqual({ status: 'discarded' });
    expect(cleanSettlement.terminal).toMatchObject({
      failure: { code: 'runtime_unavailable' },
      process_exit: { status: 'not_started' },
    });

    const uncertainOwner = createOwner();
    const uncertain = await createPipeCommandOutputSession({
      owner: uncertainOwner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    const wrongIdentity = createIdentity();
    expect(hasSameCommandExecutionIdentity(wrongIdentity, uncertainOwner.identity)).toBe(false);
    expect(uncertain.acceptStarted(started(wrongIdentity))).toMatchObject({
      status: 'protocol_failure',
      failure: { code: 'identity_mismatch' },
    });
    await expect(uncertain.settleBeforeSourceStart({
      settledAtMs: 500,
      failureCode: 'runtime_unavailable',
    })).rejects.toThrow('cannot settle');
    const uncertainSettlement = await uncertain.settleRuntimeLoss({
      settledAtMs: 500,
      resourceRelease: 'failed',
    });
    expect(uncertainSettlement.terminal.resource_release).toEqual({
      status: 'failed',
      code: 'resource_release_failed',
    });
    expect(uncertainSettlement.artifact).toMatchObject({
      status: 'manifest_persisted',
      manifest: {
        stdout: { status: 'incomplete' },
        stderr: { status: 'incomplete' },
      },
    });
  });
});
