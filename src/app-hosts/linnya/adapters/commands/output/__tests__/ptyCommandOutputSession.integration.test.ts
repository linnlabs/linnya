import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CommandExecutionIdentitySchema,
  CommandOutputSequenceSchema,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionIdentity,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CommandArtifactInstanceIdSchema,
  type CommandOutputArtifactOwner,
  type CommandOutputArtifactPort,
} from '../../../../../../domains/commands';
import {
  createFileCommandOutputArtifactPort,
  deriveCommandOutputArtifactRelativePaths,
} from '../../../../../../infra/adapters/command-runtime/output';
import {
  createBoundedPtyCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import { createPtyCommandOutputSession } from '../orchestration/createPtyCommandOutputSession';
import { preparePtyCommandOutput } from '../orchestration/preparePtyCommandOutput';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

function createIdentity(): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `pty-output-${randomUUID()}`,
    agent_run_id: `pty-run-${randomUUID()}`,
    origin_tool_call_id: `pty-call-${randomUUID()}`,
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
  if (event.kind !== 'command_runner_started') throw new Error('invalid start fixture');
  return event;
}

function output(input: {
  readonly identity: CommandExecutionIdentity;
  readonly sequence: number;
  readonly bytes: Uint8Array;
}): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_pty_output' }> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_pty_output',
    identity: input.identity,
    channel: 'terminal',
    sequence: CommandOutputSequenceSchema.parse(input.sequence),
    bytes: input.bytes,
  });
  if (event.kind !== 'command_runner_pty_output') throw new Error('invalid PTY output fixture');
  return event;
}

function terminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly nextSequence: number;
  readonly observedBytes: number;
  readonly sourceCompletion?: 'complete' | 'interrupted';
}): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_terminal' }> {
  const sourceCompletion = input.sourceCompletion ?? 'complete';
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_terminal',
    terminal: parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity: input.identity,
      settled_at_ms: 300,
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      process_exit: { status: 'observed', exit_code: 0, signal: null },
      output_drain: sourceCompletion === 'complete'
        ? { status: 'complete' }
        : { status: 'failed', code: 'output_drain_failed', reason: 'runtime_lost' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'succeeded' },
    }),
    output_sources: {
      mode: 'pty',
      terminal: sourceCompletion === 'complete'
        ? {
            source_completion: 'complete',
            next_sequence: input.nextSequence,
            observed_bytes: input.observedBytes,
          }
        : {
            source_completion: 'interrupted',
            interruption_reason: 'runtime_lost',
            next_sequence: input.nextSequence,
            observed_bytes: input.observedBytes,
          },
    },
  });
  if (event.kind !== 'command_runner_terminal') throw new Error('invalid terminal fixture');
  return event;
}

function createMemoryWriter(appended: string[]): ToolOutputTextBlobWriter {
  return {
    async append(text) {
      appended.push(text);
    },
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

async function createStorageRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-pty-output-host-'));
  temporaryRoots.push(root);
  return root;
}

function artifactFile(storageRoot: string, owner: CommandOutputArtifactOwner): string {
  const relative = deriveCommandOutputArtifactRelativePaths(owner, 'pty');
  return path.join(storageRoot, ...relative.directorySegments, 'terminal.bin');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function createSession(input: {
  readonly owner: CommandOutputArtifactOwner;
  readonly artifactPort: CommandOutputArtifactPort;
  readonly appended?: string[];
  readonly textLimits?: { readonly maxPendingEvents: number; readonly maxPendingBytes: number };
}) {
  return createPtyCommandOutputSession({
    owner: input.owner,
    artifactPort: input.artifactPort,
    retentionMs: 1_000,
    text: {
      projection: {
        columns: 20,
        rows: 4,
        scrollbackLines: 8,
        agentTextProjectionLimits: {
          maxCharactersPerStream: 2_000,
          maxLinesPerStream: 200,
        },
      },
      observation: createBoundedPtyCommandOutputObservation({
        maxSnapshots: 8,
        maxCharactersPerSnapshot: 2_000,
        maxLinesPerSnapshot: 200,
      }),
      openWriter: async () => createMemoryWriter(input.appended ?? []),
      ...(input.textLimits ? { limits: input.textLimits } : {}),
    },
  });
}

describe('PTY command output host session', () => {
  it('prepared output 在 open 前不创建 artifact，open 后只允许唯一 session', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const prepared = preparePtyCommandOutput({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      projection: {
        columns: 20,
        rows: 4,
        scrollbackLines: 8,
        agentTextProjectionLimits: {
          maxCharactersPerStream: 2_000,
          maxLinesPerStream: 200,
        },
      },
      observationLimits: {
        maxSnapshots: 8,
        maxCharactersPerSnapshot: 2_000,
        maxLinesPerSnapshot: 200,
      },
      openWriter: async () => createMemoryWriter([]),
    });

    await expect(fsp.stat(path.dirname(artifactFile(storageRoot, owner))))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const sink = await prepared.open();
    await expect(prepared.open()).rejects.toThrow('only open once');
    expect(sink.acceptStarted(started(owner.identity))).toBe(true);
    const settlement = await sink.settleRunnerTerminal({
      event: terminal({ identity: owner.identity, nextSequence: 0, observedBytes: 0 }),
      sealedAtMs: 350,
    });
    expect(settlement.artifact.status).toBe('manifest_persisted');
  });

  it('同一 transcript 先保存 raw artifact，再形成屏幕、Agent 文本和 ToolOutput 正文', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const appended: string[] = [];
    const session = await createSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      appended,
    });
    const transcript = Buffer.from('\x1b[32mhello\x1b[0m\r\nworld');

    expect(session.acceptStarted(started(owner.identity))).toEqual({ status: 'accepted' });
    expect(session.acceptOutput(output({
      identity: owner.identity,
      sequence: 0,
      bytes: transcript,
    }))).toEqual({ status: 'accepted' });
    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        nextSequence: 1,
        observedBytes: transcript.byteLength,
      }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
    });
    expect(settlement.artifact.status).toBe('manifest_persisted');
    if (settlement.artifact.status !== 'manifest_persisted') return;
    expect(settlement.artifact.manifest).toMatchObject({
      mode: 'pty',
      terminal: {
        status: 'complete',
        observed_bytes: transcript.byteLength,
        sha256: sha256(transcript),
      },
    });
    await expect(fsp.readFile(artifactFile(storageRoot, owner))).resolves.toEqual(transcript);
    expect(settlement.text.projection).toMatchObject({
      status: 'complete',
      stableText: 'hello\nworld',
      agentPreview: { terminal: { text: 'hello\nworld' } },
    });
    expect(appended).toEqual(['hello\nworld']);
  });

  it('raw artifact 不可用时仍保留自然终态和稳定屏幕', async () => {
    const owner = createOwner();
    const artifactPort: CommandOutputArtifactPort = {
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
    const session = await createSession({ owner, artifactPort });
    const bytes = Buffer.from('visible');
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({ identity: owner.identity, sequence: 0, bytes }));

    const settlement = await session.settleRunnerTerminal({
      event: terminal({
        identity: owner.identity,
        nextSequence: 1,
        observedBytes: bytes.byteLength,
      }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal.outcome).toBe('execution_ended');
    expect(settlement.artifact).toMatchObject({
      status: 'unavailable',
      failure: { code: 'permission_denied' },
    });
    expect(settlement.text.projection).toMatchObject({ stableText: 'visible' });
  });

  it('projection 队列过载不停止 transcript artifact，也不改变自然退出', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      textLimits: { maxPendingEvents: 1, maxPendingBytes: 1 },
    });
    const chunks = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];
    session.acceptStarted(started(owner.identity));
    chunks.forEach((bytes, sequence) => {
      session.acceptOutput(output({ identity: owner.identity, sequence, bytes }));
    });

    const settlement = await session.settleRunnerTerminal({
      event: terminal({ identity: owner.identity, nextSequence: 3, observedBytes: 3 }),
      sealedAtMs: 350,
    });

    expect(settlement.terminal.outcome).toBe('execution_ended');
    expect(settlement.artifact.status).toBe('manifest_persisted');
    if (settlement.artifact.status !== 'manifest_persisted') return;
    if (settlement.artifact.manifest.mode !== 'pty') {
      throw new Error('PTY output session published a non-PTY artifact');
    }
    expect(settlement.artifact.manifest.terminal).toMatchObject({
      status: 'complete',
      observed_bytes: 3,
      persisted_bytes: 3,
    });
    await expect(fsp.readFile(artifactFile(storageRoot, owner))).resolves.toEqual(
      Buffer.concat(chunks),
    );
    expect(settlement.text.projection.status).toBe('incomplete');
  });

  it('sequence/terminal 对账失败会把来源标为 interrupted 并 fail closed', async () => {
    const storageRoot = await createStorageRoot();
    const owner = createOwner();
    const session = await createSession({
      owner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    });
    session.acceptStarted(started(owner.identity));
    session.acceptOutput(output({
      identity: owner.identity,
      sequence: 0,
      bytes: Buffer.from('evidence'),
    }));

    const settlement = await session.settleRunnerTerminal({
      event: terminal({ identity: owner.identity, nextSequence: 2, observedBytes: 8 }),
      sealedAtMs: 350,
    });

    expect(settlement.protocolFailure).toEqual({ code: 'terminal_source_mismatch' });
    expect(settlement.terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
    expect(settlement.artifact.status).toBe('manifest_persisted');
    if (settlement.artifact.status !== 'manifest_persisted') return;
    if (settlement.artifact.manifest.mode !== 'pty') {
      throw new Error('PTY output session published a non-PTY artifact');
    }
    expect(settlement.artifact.manifest.terminal.status).toBe('incomplete');
  });
});
