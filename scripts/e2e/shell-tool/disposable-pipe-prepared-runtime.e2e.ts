import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  PipeCommandLaunchSnapshotV1Schema,
  ProcessOutputCursorSchema,
  parseCommandRunnerEvent,
  parseProcessControlRequest,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionIdentity,
  type ProcessOutputCursor,
} from '@app/schemas/commands';
import {
  CommandArtifactInstanceIdSchema,
  isProcessCancellationRequest,
  type CommandOutputArtifactOwner,
  type CommandRunnerProcessPort,
} from '../../../src/domains/commands';
import { createLocalCommandExecutionOwner } from '../../../src/app-hosts/linnya/adapters/commands/process-owner';
import { createDisposablePipeCommandPreparedRuntime } from '../../../src/app-hosts/linnya/adapters/commands/runner-runtime';
import {
  createFileCommandOutputArtifactPort,
  deriveCommandOutputArtifactRelativePaths,
} from '../../../src/infra/adapters/command-runtime/output';
import { createNodeCommandRunnerProcessPort } from '../../../src/infra/adapters/command-runtime/runner';
import { ToolOutputBlobSourceSchema } from '../../../src/tools/tool_output/definitions/toolOutputBlob';
import { createToolOutputTextBlobWriter } from '../../../src/tools/tool_output/orchestration/createToolOutputTextBlobWriter';
import { resolveCommandRunnerTestPlatformRuntime } from './functions/resolveCommandRunnerTestPlatformRuntime';

const repositoryRoot = process.env.LINNYA_COMMAND_TEST_CWD
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runnerPath = process.env.LINNYA_COMMAND_RUNNER_PATH
  ?? path.join(repositoryRoot, 'dist/main/commands/commandRunnerProcess.cjs');
const fixturePath = process.env.LINNYA_COMMAND_FIXTURE_PATH
  ?? path.join(
    repositoryRoot,
    'scripts/e2e/shell-tool/fixtures/commands/ordinary-pipe-fixture.cjs',
  );
const OWNER_GENERATION = CommandOwnerGenerationIdSchema.parse(
  'command_owner_318f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
);
const RUN_DEADLINE_MS = 15_000;
const localProcessPlatformRuntime = resolveCommandRunnerTestPlatformRuntime();

function quoteShellArgument(value: string): string {
  if (process.platform === 'win32') return `'${value.replaceAll("'", "''")}'`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function environmentEntries(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}

function createIdentity(scenario: string): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `prepared-e2e-${scenario}-${randomUUID()}`,
    agent_run_id: `prepared-e2e-run-${randomUUID()}`,
    origin_tool_call_id: `prepared-e2e-call-${randomUUID()}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: OWNER_GENERATION,
    created_at_ms: Date.now(),
  });
}

function createLaunch(identity: CommandExecutionIdentity, scenario: string) {
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  } as const;
  const platform = process.platform === 'win32' ? 'windows' : 'macos';
  const revision = `prepared-e2e-${process.platform}-${process.version}`;
  const shell = process.platform === 'win32'
    ? {
        platform,
        shell_semantics_id: 'powershell-5.1',
        shell_version: '5.1',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'powershell-utf8-v1',
        executable_path: `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
        argv_prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      }
    : {
        platform,
        shell_semantics_id: 'zsh',
        shell_version: '5.9',
        snapshot_revision: revision,
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        argv_prefix: ['-f', '-c'],
      };
  const command = process.platform === 'win32'
    ? `& ${quoteShellArgument(process.execPath)} ${quoteShellArgument(fixturePath)} ${quoteShellArgument(scenario)}; exit $LASTEXITCODE`
    : `${quoteShellArgument(process.execPath)} ${quoteShellArgument(fixturePath)} ${quoteShellArgument(scenario)}`;
  return PipeCommandLaunchSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'pipe_command_launch_snapshot',
    conversation_root: repositoryRoot,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command,
      cwd: repositoryRoot,
      permission,
    },
    permission,
    mode: 'pipe',
    shell,
    environment: { revision, entries: environmentEntries() },
    stdin: 'closed',
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 10_000,
  });
}

function artifactOwner(identity: CommandExecutionIdentity): CommandOutputArtifactOwner {
  return {
    identity,
    instance_id: CommandArtifactInstanceIdSchema.parse('default'),
  };
}

function processRequest(input: {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly cursor: ProcessOutputCursor;
  readonly action: 'poll' | 'wait';
  readonly conversationId?: string;
}) {
  return parseProcessControlRequest({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: input.binding.process_handle,
    scope: {
      conversation_id: input.conversationId ?? input.binding.identity.conversation_id,
      agent_run_id: input.binding.identity.agent_run_id,
      control_tool_call_id: `prepared-e2e-process-${randomUUID()}`,
      owner_generation_id: input.binding.identity.owner_generation_id,
    },
    action: input.action === 'poll'
      ? { type: 'poll', cursor: input.cursor }
      : { type: 'wait', cursor: input.cursor, wait_timeout_ms: 2_000 },
  });
}

function cancelRequest(binding: CommandExecutionOwnerBindingV1) {
  const request = parseProcessControlRequest({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: binding.process_handle,
    scope: {
      conversation_id: binding.identity.conversation_id,
      agent_run_id: binding.identity.agent_run_id,
      control_tool_call_id: `prepared-e2e-cancel-${randomUUID()}`,
      owner_generation_id: binding.identity.owner_generation_id,
    },
    action: { type: 'cancel' },
  });
  if (!isProcessCancellationRequest(request)) {
    throw new Error('cancel request parser returned another action');
  }
  return request;
}

function createTextOutputInput(storageRoot: string, identity: CommandExecutionIdentity) {
  return {
    currentLogicalLineLimits: { maxCharactersPerCurrentLine: 20_000 },
    agentTextProjectionLimits: {
      maxCharactersPerStream: 20_000,
      maxLinesPerStream: 1_200,
    },
    openWriter: async (channel: 'stdout' | 'stderr') => createToolOutputTextBlobWriter({
      blobsDirectory: path.join(
        storageRoot,
        'tool-output',
        identity.command_execution_id,
        channel,
      ),
      source: ToolOutputBlobSourceSchema.parse({
        kind: 'tool_output_text',
        conversation_id: identity.conversation_id,
        instance_id: 'default',
        tool_name: `shell.${channel}`,
        tool_call_id: identity.origin_tool_call_id,
      }),
    }),
  };
}

function executionDirectory(root: string, owner: CommandOutputArtifactOwner): string {
  return path.join(
    root,
    ...deriveCommandOutputArtifactRelativePaths(owner, 'pipe').directorySegments,
  );
}

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${RUN_DEADLINE_MS}ms`)), RUN_DEADLINE_MS);
    void promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createRealRunnerPort(): CommandRunnerProcessPort {
  // helper 只需要绝对 Node/runner 路径；Agent Shell 的完整环境由 launch 单独交付。
  return createNodeCommandRunnerProcessPort({
    runnerPath,
    nodeExecutablePath: process.execPath,
    // SRT 0.0.67 会用 PATH 验证固定的 /bin/zsh；这是 utility 自身依赖，
    // 与随后交给 Agent 命令的冻结 environment 是两条独立通道。
    helperEnvironment: process.platform === 'darwin'
      ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
      : {},
    platformRuntime: localProcessPlatformRuntime,
  });
}

async function runOwnerHandoffScenario(storageRoot: string): Promise<void> {
  const identity = createIdentity('owner-handoff');
  const outputOwner = artifactOwner(identity);
  const owner = createLocalCommandExecutionOwner({
    generationId: OWNER_GENERATION,
    createProcessHandle: () => CommandProcessHandleSchema.parse(
      `command_process_${randomUUID()}`,
    ),
  });
  const reservation = owner.reserve({ identity, mode: 'pipe' });
  assert.equal(reservation.status, 'reserved');
  if (reservation.status !== 'reserved') throw new Error('owner reservation was rejected');
  const started = await withDeadline(owner.claimAndStart({
    binding: reservation.binding,
    prepareRuntime: () => createDisposablePipeCommandPreparedRuntime({
      launch: createLaunch(identity, 'binary-nonzero'),
      artifactOwner: outputOwner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: createRealRunnerPort(),
      text: createTextOutputInput(storageRoot, identity),
    }),
  }), 'owner claim and start');
  const terminal = started.status === 'running'
    ? await withDeadline(started.terminal, 'owner runtime terminal')
    : started.status === 'terminal'
      ? started.terminal
      : (() => { throw new Error(`owner rejected start: ${started.code}`); })();

  if (terminal.outcome !== 'execution_ended') {
    throw new Error(`owner handoff returned an unexpected terminal: ${JSON.stringify(terminal)}`);
  }
  assert.deepEqual(terminal.process_exit, { status: 'observed', exit_code: 7, signal: null });
  assert.equal(owner.readActivitySnapshot().runningCount, 0);
  const directory = executionDirectory(storageRoot, outputOwner);
  assert.deepEqual(
    await fsp.readFile(path.join(directory, 'stdout.bin')),
    Buffer.from([0x00, 0xe4, 0xb8, 0xad, 0xff, 0x0a]),
  );
  assert.deepEqual(
    await fsp.readFile(path.join(directory, 'stderr.bin')),
    Buffer.from([0x65, 0x72, 0x72, 0x00, 0x80, 0x0a]),
  );
  await fsp.access(path.join(directory, 'manifest.json'));
}

async function runOwnerProcessObservationScenario(storageRoot: string): Promise<void> {
  const identity = createIdentity('owner-process-observation');
  const outputOwner = artifactOwner(identity);
  const owner = createLocalCommandExecutionOwner({ generationId: OWNER_GENERATION });
  const reservation = owner.reserve({ identity, mode: 'pipe' });
  assert.equal(reservation.status, 'reserved');
  if (reservation.status !== 'reserved') throw new Error('owner reservation was rejected');
  const started = await withDeadline(owner.claimAndStart({
    binding: reservation.binding,
    prepareRuntime: () => createDisposablePipeCommandPreparedRuntime({
      launch: createLaunch(identity, 'poll-stream'),
      artifactOwner: outputOwner,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: createRealRunnerPort(),
      text: createTextOutputInput(storageRoot, identity),
    }),
  }), 'owner process observation start');
  assert.equal(started.status, 'running');
  if (started.status !== 'running') throw new Error('poll-stream ended before handle handoff');

  const cursorZero = ProcessOutputCursorSchema.parse(0);
  assert.deepEqual(await owner.queryOutput(processRequest({
    binding: reservation.binding,
    cursor: cursorZero,
    action: 'poll',
  })), { status: 'rejected', code: 'unknown_handle' });
  assert.equal(owner.publishHandle(reservation.binding).status, 'published');

  let cursor = cursorZero;
  let stdout = '';
  let stderr = '';
  let terminalResult: Extract<
    Awaited<ReturnType<typeof owner.queryOutput>>,
    { readonly status: 'terminal' }
  > | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await withDeadline(owner.queryOutput(processRequest({
      binding: reservation.binding,
      cursor,
      action: 'wait',
    })), `owner process observation wait ${attempt}`);
    assert.notEqual(result.status, 'rejected');
    if (result.status === 'rejected') throw new Error(`process query rejected: ${result.code}`);
    stdout += result.observation.stdout;
    stderr += result.observation.stderr;
    cursor = result.observation.nextCursor;
    if (result.status === 'terminal') {
      terminalResult = result;
      break;
    }
  }
  assert.ok(terminalResult, 'poll-stream did not publish a terminal result');
  assert.equal(stdout, 'poll-first-中文\npoll-final\n');
  assert.equal(stderr, 'poll-second-stderr\n');
  assert.deepEqual(terminalResult.terminal.process_exit, {
    status: 'observed',
    exit_code: 0,
    signal: null,
  });

  const replay = await owner.queryOutput(processRequest({
    binding: reservation.binding,
    cursor: cursorZero,
    action: 'poll',
  }));
  assert.equal(replay.status, 'terminal');
  if (replay.status !== 'terminal') throw new Error('terminal replay was not stable');
  assert.equal(replay.observation.stdout, 'poll-first-中文\npoll-final\n');
  assert.equal(replay.observation.stderr, 'poll-second-stderr\n');
  assert.deepEqual(replay.terminal, terminalResult.terminal);
  assert.deepEqual(await owner.queryOutput(processRequest({
    binding: reservation.binding,
    cursor: cursorZero,
    action: 'poll',
    conversationId: 'other-owner-process-conversation',
  })), { status: 'rejected', code: 'unknown_handle' });

  const directory = executionDirectory(storageRoot, outputOwner);
  assert.deepEqual(
    await fsp.readFile(path.join(directory, 'stdout.bin')),
    Buffer.from('poll-first-中文\npoll-final\n', 'utf8'),
  );
  assert.deepEqual(
    await fsp.readFile(path.join(directory, 'stderr.bin')),
    Buffer.from('poll-second-stderr\n', 'utf8'),
  );
  await owner.endAndWait();
  assert.deepEqual(await owner.queryOutput(processRequest({
    binding: reservation.binding,
    cursor: cursorZero,
    action: 'poll',
  })), { status: 'rejected', code: 'owner_ended' });
}

async function runCancellationScenario(storageRoot: string): Promise<void> {
  const identity = createIdentity('cancel');
  const owner = createLocalCommandExecutionOwner({ generationId: OWNER_GENERATION });
  const reservation = owner.reserve({ identity, mode: 'pipe' });
  assert.equal(reservation.status, 'reserved');
  if (reservation.status !== 'reserved') throw new Error('cancel reservation was rejected');
  const started = await withDeadline(owner.claimAndStart({
    binding: reservation.binding,
    prepareRuntime: () => createDisposablePipeCommandPreparedRuntime({
      launch: createLaunch(identity, 'hang'),
      artifactOwner: artifactOwner(identity),
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: createRealRunnerPort(),
      text: createTextOutputInput(storageRoot, identity),
    }),
  }), 'cancel scenario owner start');
  assert.equal(started.status, 'running');
  if (started.status !== 'running') throw new Error('cancel scenario ended before handle handoff');
  assert.equal(owner.publishHandle(reservation.binding).status, 'published');

  const result = await withDeadline(owner.cancelAndWait(
    cancelRequest(reservation.binding),
  ), 'cancel scenario owner stop');
  assert.equal(result.status, 'terminal');
  if (result.status !== 'terminal') throw new Error(`cancel scenario rejected: ${result.code}`);
  const terminal = result.terminal;
  assert.equal(terminal.outcome, 'execution_ended');
  if (terminal.outcome !== 'execution_ended') throw new Error('cancel scenario lost termination cause');
  assert.equal(terminal.termination_cause, 'user_cancelled');
  assert.equal(result.processHandle, reservation.binding.process_handle);
  // 平台 owner 已分别证明整树归零和资源释放，host 才能从 stopping 迁入可重放终态。
  assert.deepEqual(terminal.tree_cleanup, { status: 'succeeded' });
  assert.deepEqual(terminal.resource_release, { status: 'succeeded' });
  assert.deepEqual(owner.readActivitySnapshot(), {
    generationId: OWNER_GENERATION,
    lifecycle: 'active',
    reservedCount: 0,
    startingCount: 0,
    runningCount: 0,
    stoppingCount: 0,
    pendingHandleDecisionCount: 0,
    terminalReplayCount: 1,
  });
}

async function runRuntimeLossScenario(storageRoot: string): Promise<void> {
  const identity = createIdentity('runtime-loss');
  const realPort = createRealRunnerPort();
  let disconnected = false;
  const disconnectAfterStart: CommandRunnerProcessPort = {
    fork(handlers) {
      let control = realPort.fork({
        ...handlers,
        onMessage(message) {
          handlers.onMessage(message);
          const event = parseCommandRunnerEvent(message);
          if (!disconnected && event.kind === 'command_runner_started') {
            disconnected = true;
            setImmediate(() => control.disconnect());
          }
        },
      });
      return control;
    },
  };
  const runtime = createDisposablePipeCommandPreparedRuntime({
    launch: createLaunch(identity, 'hang'),
    artifactOwner: artifactOwner(identity),
    artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
    runnerProcess: disconnectAfterStart,
    text: createTextOutputInput(storageRoot, identity),
  });
  const started = await withDeadline(runtime.start(), 'runtime-loss scenario start');
  assert.equal(started.status, 'running');
  const terminal = await withDeadline(runtime.terminal, 'runtime-loss scenario terminal');
  assert.equal(terminal.outcome, 'runtime_failure');
  if (terminal.outcome !== 'runtime_failure') throw new Error('runtime loss was not preserved');
  assert.equal(terminal.failure.code, 'runtime_lost');
  assert.equal(disconnected, true);
}

const storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-prepared-runtime-e2e-中文-'));
let succeeded = false;
try {
  await runOwnerHandoffScenario(storageRoot);
  await runOwnerProcessObservationScenario(storageRoot);
  await runCancellationScenario(storageRoot);
  await runRuntimeLossScenario(storageRoot);
  succeeded = true;
  process.stdout.write(`${JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    scenarios: 4,
    status: 'passed',
  })}\n`);
} finally {
  if (succeeded) await fsp.rm(storageRoot, { recursive: true, force: true });
  else process.stderr.write(`preserved failed prepared runtime E2E root: ${storageRoot}\n`);
}
