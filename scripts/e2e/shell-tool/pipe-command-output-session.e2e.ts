import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CommandExecutionIdentitySchema,
  CommandOutputSequenceSchema,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionIdentity,
} from '@app/schemas/commands';
import {
  CommandArtifactInstanceIdSchema,
  type CommandOutputArtifactOwner,
} from '../../../src/domains/commands';
import { createPipeCommandOutputSession } from '../../../src/app-hosts/linnya/adapters/commands/output';
import {
  createBoundedPipeCommandOutputObservation,
  createFileCommandOutputArtifactPort,
  deriveCommandOutputArtifactRelativePaths,
} from '../../../src/infra/adapters/command-runtime/output';
import {
  TOOL_OUTPUT_BODY_FILE_NAME,
  ToolOutputBlobSourceSchema,
} from '../../../src/tools/tool_output/definitions/toolOutputBlob';
import { createToolOutputTextBlobWriter } from '../../../src/tools/tool_output/orchestration/createToolOutputTextBlobWriter';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-host-output-中文-'));
let succeeded = false;

function createOwner(suffix: string): CommandOutputArtifactOwner {
  const identity = CommandExecutionIdentitySchema.parse({
    conversation_id: `conversation-host-output-${suffix}`,
    agent_run_id: `agent-run-host-output-${suffix}`,
    origin_tool_call_id: `tool-call-host-output-${suffix}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: 100,
  });
  return {
    identity,
    instance_id: CommandArtifactInstanceIdSchema.parse('default'),
  };
}

function started(identity: CommandExecutionIdentity) {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_started',
    identity,
    started_at_ms: 200,
  });
  assert.equal(event.kind, 'command_runner_started');
  if (event.kind !== 'command_runner_started') throw new Error('started fixture mismatch');
  return event;
}

function output(
  identity: CommandExecutionIdentity,
  channel: 'stdout' | 'stderr',
  sequence: number,
  bytes: Uint8Array,
) {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_output',
    identity,
    channel,
    sequence: CommandOutputSequenceSchema.parse(sequence),
    bytes,
  });
  assert.equal(event.kind, 'command_runner_output');
  if (event.kind !== 'command_runner_output') throw new Error('output fixture mismatch');
  return event;
}

function terminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly stdoutSequence: number;
  readonly stdoutBytes: number;
  readonly stderrSequence: number;
  readonly stderrBytes: number;
}) {
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
      output_drain: { status: 'complete' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'succeeded' },
    }),
    output_sources: {
      mode: 'pipe',
      stdout: {
        source_completion: 'complete',
        next_sequence: input.stdoutSequence,
        observed_bytes: input.stdoutBytes,
      },
      stderr: {
        source_completion: 'complete',
        next_sequence: input.stderrSequence,
        observed_bytes: input.stderrBytes,
      },
    },
  });
  assert.equal(event.kind, 'command_runner_terminal');
  if (event.kind !== 'command_runner_terminal') throw new Error('terminal fixture mismatch');
  return event;
}

function prelaunchTerminal(identity: CommandExecutionIdentity) {
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
  assert.equal(event.kind, 'command_runner_terminal');
  if (event.kind !== 'command_runner_terminal') throw new Error('prelaunch fixture mismatch');
  return event;
}

function executionDirectory(owner: CommandOutputArtifactOwner): string {
  return path.join(
    root,
    ...deriveCommandOutputArtifactRelativePaths(owner, 'pipe').directorySegments,
  );
}

function createSession(owner: CommandOutputArtifactOwner, port: ReturnType<
  typeof createFileCommandOutputArtifactPort
>) {
  return createPipeCommandOutputSession({
    owner,
    artifactPort: port,
    text: {
      encoding: 'utf-8',
      observation: createBoundedPipeCommandOutputObservation({
        maxEvents: 1_024,
        maxCharacters: 40_000,
      }),
      currentLogicalLineLimits: { maxCharactersPerCurrentLine: 20_000 },
      agentTextProjectionLimits: {
        maxCharactersPerStream: 20_000,
        maxLinesPerStream: 1_200,
      },
      openWriter: async channel => createToolOutputTextBlobWriter({
        blobsDirectory: path.join(
          root,
          'tool-output',
          owner.identity.command_execution_id,
          channel,
        ),
        source: ToolOutputBlobSourceSchema.parse({
          kind: 'tool_output_text',
          conversation_id: owner.identity.conversation_id,
          instance_id: owner.instance_id,
          tool_name: `shell.${channel}`,
          tool_call_id: owner.identity.origin_tool_call_id,
        }),
      }),
    },
  });
}

try {
  const port = createFileCommandOutputArtifactPort({ storageRoot: root });

  const normalOwner = createOwner('normal');
  const normal = await createSession(normalOwner, port);
  const stdout = Uint8Array.from([0, 0xe4, 0xb8, 0xad, 0xff]);
  const stderr = Uint8Array.from([0x65, 0x72, 0x72, 0, 0x80]);
  assert.equal(normal.acceptStarted(started(normalOwner.identity)).status, 'accepted');
  assert.equal(normal.acceptOutput(output(normalOwner.identity, 'stdout', 0, stdout)).status, 'accepted');
  assert.equal(normal.acceptOutput(output(normalOwner.identity, 'stderr', 0, stderr)).status, 'accepted');
  const normalSettlement = await normal.settleRunnerTerminal({
    event: terminal({
      identity: normalOwner.identity,
      stdoutSequence: 1,
      stdoutBytes: stdout.byteLength,
      stderrSequence: 1,
      stderrBytes: stderr.byteLength,
    }),
    sealedAtMs: 350,
  });
  assert.equal(normalSettlement.terminal.outcome, 'execution_ended');
  assert.equal(normalSettlement.artifact.status, 'manifest_persisted');
  assert.equal(normalSettlement.text.streams.stdout.blob.status, 'published');
  assert.equal(normalSettlement.text.streams.stderr.blob.status, 'published');
  if (
    normalSettlement.text.streams.stdout.blob.status !== 'published'
    || normalSettlement.text.streams.stderr.blob.status !== 'published'
  ) {
    throw new Error('normal text streams were not published');
  }
  assert.equal(
    await fsp.readFile(path.join(
      path.dirname(normalSettlement.text.streams.stdout.blob.blob.filePath),
      TOOL_OUTPUT_BODY_FILE_NAME,
    ), 'utf16le'),
    '\\x00中�',
  );
  assert.equal(
    await fsp.readFile(path.join(
      path.dirname(normalSettlement.text.streams.stderr.blob.blob.filePath),
      TOOL_OUTPUT_BODY_FILE_NAME,
    ), 'utf16le'),
    'err\\x00�',
  );
  assert.deepEqual(
    await fsp.readFile(path.join(executionDirectory(normalOwner), 'stdout.bin')),
    Buffer.from(stdout),
  );
  assert.deepEqual(
    await fsp.readFile(path.join(executionDirectory(normalOwner), 'stderr.bin')),
    Buffer.from(stderr),
  );

  const emptyOwner = createOwner('empty');
  const empty = await createSession(emptyOwner, port);
  empty.acceptStarted(started(emptyOwner.identity));
  const emptySettlement = await empty.settleRunnerTerminal({
    event: terminal({
      identity: emptyOwner.identity,
      stdoutSequence: 0,
      stdoutBytes: 0,
      stderrSequence: 0,
      stderrBytes: 0,
    }),
    sealedAtMs: 350,
  });
  assert.equal(emptySettlement.artifact.status, 'manifest_persisted');
  assert.equal(emptySettlement.text.streams.stdout.blob.status, 'not_created');
  assert.equal(emptySettlement.text.streams.stderr.blob.status, 'not_created');
  assert.equal(
    await fsp.stat(path.join(executionDirectory(emptyOwner), 'manifest.json'))
      .then(() => true),
    true,
  );

  const prelaunchOwner = createOwner('prelaunch');
  const prelaunch = await createSession(prelaunchOwner, port);
  const prelaunchSettlement = await prelaunch.settleRunnerTerminal({
    event: prelaunchTerminal(prelaunchOwner.identity),
    sealedAtMs: 350,
  });
  assert.equal(prelaunchSettlement.artifact.status, 'discarded');
  assert.equal(prelaunchSettlement.text.streams.stdout.sourceCompletion, 'not_started');
  await assert.rejects(fsp.stat(executionDirectory(prelaunchOwner)), { code: 'ENOENT' });

  const mismatchOwner = createOwner('mismatch');
  const mismatch = await createSession(mismatchOwner, port);
  mismatch.acceptStarted(started(mismatchOwner.identity));
  mismatch.acceptOutput(output(mismatchOwner.identity, 'stdout', 0, Uint8Array.from([1])));
  assert.equal(
    mismatch.acceptOutput(output(
      mismatchOwner.identity,
      'stdout',
      2,
      Uint8Array.from([2]),
    )).status,
    'protocol_failure',
  );
  const mismatchSettlement = await mismatch.settleRunnerTerminal({
    event: terminal({
      identity: mismatchOwner.identity,
      stdoutSequence: 2,
      stdoutBytes: 2,
      stderrSequence: 0,
      stderrBytes: 0,
    }),
    sealedAtMs: 350,
  });
  assert.equal(mismatchSettlement.terminal.outcome, 'runtime_failure');
  assert.equal(
    mismatchSettlement.terminal.outcome === 'runtime_failure'
      && mismatchSettlement.terminal.failure.code,
    'runtime_lost',
  );
  assert.equal(mismatchSettlement.artifact.status, 'manifest_persisted');

  const preForkOwner = createOwner('prefork');
  const preFork = await createSession(preForkOwner, port);
  const preForkSettlement = await preFork.settleBeforeSourceStart({
    settledAtMs: 400,
    failureCode: 'runtime_unavailable',
  });
  assert.equal(preForkSettlement.artifact.status, 'discarded');
  assert.equal(preForkSettlement.terminal.process_exit.status, 'not_started');

  succeeded = true;
  process.stdout.write(`${JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    scenarios: 5,
    status: 'passed',
  })}\n`);
} finally {
  if (succeeded) await fsp.rm(root, { recursive: true, force: true });
  else process.stderr.write(`preserved failed host output E2E root: ${root}\n`);
}
