import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  PipeCommandLaunchSnapshotV1Schema,
  parseProcessControlRequest,
  type CommandExecutionIdentity,
} from '@app/schemas/commands';
import {
  CommandArtifactInstanceIdSchema,
  isProcessCancellationRequest,
  type CommandOutputArtifactOwner,
} from '../../../../src/domains/commands';
import { createLocalCommandExecutionOwner } from '../../../../src/app-hosts/linnya/adapters/commands/process-owner';
import { createDisposablePipeCommandPreparedRuntime } from '../../../../src/app-hosts/linnya/adapters/commands/runner-runtime';
import {
  createDiagnosticLogFileSink,
  createDiagnosticLogWriter,
} from '../../../../src/shared/logging';
import {
  createFileCommandOutputArtifactPort,
} from '../../../../src/infra/adapters/command-runtime/output';
import { createNodeCommandRunnerProcessPort } from '../../../../src/infra/adapters/command-runtime/runner';
import { ToolOutputBlobSourceSchema } from '../../../../src/tools/tool_output/definitions/toolOutputBlob';
import { createToolOutputTextBlobWriter } from '../../../../src/tools/tool_output/orchestration/createToolOutputTextBlobWriter';
import { createIsolatedRunRoot } from '../harness/isolatedRunRoot.mjs';
import {
  assertMacosProductionAgentProcessTreeExited,
  createProductionAgentProcessTreeCommand,
  observeMacosProductionAgentProcessTree,
} from '../harness/productionAgentProcessTree.mjs';
import { resolveCommandRunnerTestPlatformRuntime } from '../functions/resolveCommandRunnerTestPlatformRuntime';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const runnerPath = path.join(
  repositoryRoot,
  'dist/main/commands/commandRunnerProcess.cjs',
);
const TEST_DEADLINE_MS = 20_000;
const SYSTEM_COMMAND_TIMEOUT_MS = 10_000;

if (process.platform !== 'darwin') {
  throw new Error('real disk-full command owner E2E currently requires macOS');
}

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} exceeded ${TEST_DEADLINE_MS}ms`));
    }, TEST_DEADLINE_MS);
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

async function waitFor<T>(label: string, read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + TEST_DEADLINE_MS;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} exceeded ${TEST_DEADLINE_MS}ms`);
}

function stringEnvironment(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}

function createIdentity(ownerGenerationId: string): CommandExecutionIdentity {
  const suffix = randomUUID();
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `pc51-disk-full-${suffix}`,
    agent_run_id: `pc51-run-${suffix}`,
    origin_tool_call_id: `pc51-tool-${suffix}`,
    command_execution_id: `command_execution_${suffix}`,
    owner_generation_id: ownerGenerationId,
    created_at_ms: Date.now(),
  });
}

function createLaunch(input: {
  readonly identity: CommandExecutionIdentity;
  readonly command: string;
  readonly executionRoot: string;
}) {
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity: input.identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  } as const;
  const revision = `pc51-disk-full-${randomUUID()}`;
  return PipeCommandLaunchSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'pipe_command_launch_snapshot',
    conversation_root: input.executionRoot,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity: input.identity,
      command: input.command,
      cwd: input.executionRoot,
      permission,
    },
    permission,
    mode: 'pipe',
    shell: {
      platform: 'macos',
      shell_semantics_id: 'zsh',
      shell_version: '5.9',
      snapshot_revision: revision,
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'plain-v1',
      executable_path: '/bin/zsh',
      argv_prefix: ['-f', '-c'],
    },
    environment: { revision, entries: stringEnvironment() },
    stdin: 'closed',
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 30_000,
  });
}

function createTextOutputInput(
  storageRoot: string,
  identity: CommandExecutionIdentity,
) {
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

function createArtifactOwner(identity: CommandExecutionIdentity): CommandOutputArtifactOwner {
  return {
    identity,
    instance_id: CommandArtifactInstanceIdSchema.parse('default'),
  };
}

function createCancellationRequest(input: {
  readonly identity: CommandExecutionIdentity;
  readonly processHandle: string;
}) {
  const request = parseProcessControlRequest({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: input.processHandle,
    scope: {
      conversation_id: input.identity.conversation_id,
      agent_run_id: input.identity.agent_run_id,
      control_tool_call_id: `pc51-cancel-${randomUUID()}`,
      owner_generation_id: input.identity.owner_generation_id,
    },
    action: { type: 'cancel' },
  });
  if (!isProcessCancellationRequest(request)) {
    throw new Error('PC-51 cancellation parser returned another action');
  }
  return request;
}

async function createAndAttachDiskImage(input: {
  readonly imagePath: string;
  readonly mountPath: string;
}): Promise<string> {
  await fsp.mkdir(input.mountPath, { recursive: true });
  await execFileAsync('hdiutil', [
    'create',
    '-size', '24m',
    '-fs', 'HFS+',
    '-volname', 'LinnyaPC51',
    '-type', 'UDIF',
    '-nospotlight',
    input.imagePath,
  ], { timeout: SYSTEM_COMMAND_TIMEOUT_MS });
  const attached = await execFileAsync('hdiutil', [
    'attach',
    '-nobrowse',
    '-noautoopen',
    '-mountpoint', input.mountPath,
    input.imagePath,
  ], { timeout: SYSTEM_COMMAND_TIMEOUT_MS });
  const device = attached.stdout.match(/^\/dev\/disk[^\s]*/mu)?.[0];
  assert(device, `hdiutil attach did not return a device identity: ${attached.stdout}`);
  return device;
}

async function detachAndVerifyDiskImage(input: {
  readonly device: string;
  readonly imagePath: string;
}): Promise<void> {
  await execFileAsync('hdiutil', ['detach', input.device], {
    timeout: SYSTEM_COMMAND_TIMEOUT_MS,
  });
  const info = await execFileAsync('hdiutil', ['info'], {
    timeout: SYSTEM_COMMAND_TIMEOUT_MS,
  });
  assert(
    !info.stdout.includes(input.imagePath) && !info.stdout.includes(input.device),
    `detached disk image remains visible: device=${input.device} image=${input.imagePath}`,
  );
}

async function fillVolumeUntilEnospc(mountPath: string): Promise<string> {
  const outcome = await new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stderr: string;
  }>((resolve, reject) => {
    const child = spawn('/bin/dd', [
      'if=/dev/zero',
      `of=${path.join(mountPath, 'disk-full-fixture.bin')}`,
      'bs=1048576',
    ], {
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), SYSTEM_COMMAND_TIMEOUT_MS);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-16_384); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
  assert.equal(outcome.signal, null, `dd was killed while filling the test volume: ${outcome.stderr}`);
  assert.notEqual(outcome.code, 0, 'disk filler unexpectedly completed without reaching ENOSPC');
  assert.match(outcome.stderr, /No space left on device/u);
  return outcome.stderr.trim();
}

async function main(): Promise<void> {
  const isolated = await createIsolatedRunRoot();
  const imagePath = path.join(isolated.path, 'pc51-disk-full.dmg');
  const mountPath = path.join(isolated.path, 'mounted-volume');
  const executionRoot = path.join(isolated.path, 'command-work');
  const commandStorageRoot = path.join(isolated.path, 'command-storage');
  let mountedDevice: string | undefined;
  let owner: ReturnType<typeof createLocalCommandExecutionOwner> | undefined;
  let diagnosticWriter: ReturnType<typeof createDiagnosticLogWriter> | undefined;
  let observation: Awaited<ReturnType<typeof observeMacosProductionAgentProcessTree>> | undefined;
  let primaryError: unknown;
  let result: Record<string, unknown> | undefined;
  const cleanupErrors: unknown[] = [];

  try {
    await Promise.all([
      fsp.mkdir(executionRoot, { recursive: true }),
      fsp.mkdir(commandStorageRoot, { recursive: true }),
    ]);
    mountedDevice = await createAndAttachDiskImage({ imagePath, mountPath });

    const ownerGenerationId = CommandOwnerGenerationIdSchema.parse(
      `command_owner_${randomUUID()}`,
    );
    const identity = createIdentity(ownerGenerationId);
    owner = createLocalCommandExecutionOwner({ generationId: ownerGenerationId });
    const reservation = owner.reserve({ identity, mode: 'pipe' });
    assert.equal(reservation.status, 'reserved');
    if (reservation.status !== 'reserved') throw new Error('PC-51 command reservation failed');

    const runToken = randomUUID();
    const evidenceDirectoryName = `pc51-tree-${runToken}`;
    const command = createProductionAgentProcessTreeCommand({
      evidenceDirectoryName,
      runToken,
    });
    const started = await withDeadline(owner.claimAndStart({
      binding: reservation.binding,
      prepareRuntime: () => createDisposablePipeCommandPreparedRuntime({
        launch: createLaunch({ identity, command, executionRoot }),
        artifactOwner: createArtifactOwner(identity),
        artifactPort: createFileCommandOutputArtifactPort({
          storageRoot: commandStorageRoot,
        }),
        runnerProcess: createNodeCommandRunnerProcessPort({
          runnerPath,
          nodeExecutablePath: process.execPath,
          helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
          platformRuntime: resolveCommandRunnerTestPlatformRuntime(),
        }),
        text: createTextOutputInput(commandStorageRoot, identity),
      }),
    }), 'PC-51 command owner start');
    assert.equal(started.status, 'running');
    if (started.status !== 'running') throw new Error('PC-51 command ended before owner handoff');
    assert.equal(owner.publishHandle(reservation.binding).status, 'published');

    observation = await observeMacosProductionAgentProcessTree({
      runRoot: path.join(executionRoot, evidenceDirectoryName),
      runToken,
      timeoutMs: 8_000,
    });

    const writer = createDiagnosticLogWriter({
      sink: createDiagnosticLogFileSink({
        baseFilePath: path.join(mountPath, 'backend-2026-08-03.log'),
      }),
    });
    diagnosticWriter = writer;
    writer.write({
      receivedAt: new Date(),
      level: 'INFO',
      module: 'pc51-real-disk-full',
      message: 'writer-ready-before-disk-full',
    });
    await waitFor('initial diagnostic log write', () => (
      writer.getStatus().writtenEntries === 1 ? true : undefined
    ));

    const diskFillError = await fillVolumeUntilEnospc(mountPath);
    const triggerResults = Array.from({ length: 256 }, (_, index) => writer.write({
      receivedAt: new Date(),
      level: 'ERROR',
      module: 'pc51-real-disk-full',
      message: `real-enospc-trigger-${index}`,
      data: { payload: '磁盘满诊断'.repeat(1_000) },
    }));
    assert(triggerResults.some(value => value.accepted));
    const disabledStatus = await waitFor('diagnostic logger ENOSPC fuse', () => {
      const status = writer.getStatus();
      return status.state === 'sink_disabled' ? status : undefined;
    });
    assert.equal(Reflect.get(disabledStatus.sinkFailure, 'code'), 'ENOSPC');

    const rejectedAfterFuse = Array.from({ length: 100 }, (_, index) => writer.write({
      receivedAt: new Date(),
      level: 'ERROR',
      module: 'pc51-real-disk-full',
      message: `must-not-retry-${index}`,
    }));
    assert(rejectedAfterFuse.every(result => (
      result.accepted === false && result.reason === 'sink_disabled'
    )));

    const cancelStartedAt = performance.now();
    const cancellation = await withDeadline(owner.cancelAndWait(createCancellationRequest({
      identity,
      processHandle: reservation.binding.process_handle,
    })), 'PC-51 command cancellation after ENOSPC');
    const cancelDurationMs = performance.now() - cancelStartedAt;
    assert.equal(cancellation.status, 'terminal');
    if (cancellation.status !== 'terminal') {
      throw new Error(`PC-51 cancellation was rejected: ${cancellation.code}`);
    }
    assert.equal(cancellation.terminal.outcome, 'execution_ended');
    if (cancellation.terminal.outcome !== 'execution_ended') {
      throw new Error('PC-51 cancellation lost its terminal cause');
    }
    assert.equal(cancellation.terminal.termination_cause, 'user_cancelled');
    assert.deepEqual(cancellation.terminal.output_drain, { status: 'complete' });
    assert.deepEqual(cancellation.terminal.tree_cleanup, { status: 'succeeded' });
    assert.deepEqual(cancellation.terminal.resource_release, { status: 'succeeded' });
    const cleanup = await assertMacosProductionAgentProcessTreeExited(observation, {
      timeoutMs: 8_000,
    });

    await withDeadline(owner.endAndWait(), 'PC-51 command owner end');
    const ownerActivityAfterExit = owner.readActivitySnapshot();
    assert.deepEqual(ownerActivityAfterExit, {
      generationId: ownerGenerationId,
      lifecycle: 'ended',
      reservedCount: 0,
      startingCount: 0,
      runningCount: 0,
      stoppingCount: 0,
      pendingHandleDecisionCount: 0,
      terminalReplayCount: 0,
    });
    const loggerShutdown = await writer.shutdown();
    assert.equal(loggerShutdown.complete, true);
    assert.equal(loggerShutdown.status.state, 'sink_disabled');

    result = {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      filesystem: 'HFS+',
      realDiskError: 'ENOSPC',
      diskFillError,
      loggerState: loggerShutdown.status.state,
      sinkFailureCode: Reflect.get(loggerShutdown.status.sinkFailure, 'code'),
      rejectedAfterFuse: rejectedAfterFuse.length,
      acceptedDiskFullTriggers: triggerResults.filter(value => value.accepted).length,
      commandTerminalCause: cancellation.terminal.termination_cause,
      commandCancelDurationMs: Math.round(cancelDurationMs),
      observedProcesses: observation.instances.length,
      exitedProcesses: cleanup.exitedProcessCount,
      ownerActivityAfterExit,
    };
  } catch (error: unknown) {
    primaryError = error;
  } finally {
    if (owner) {
      try {
        await withDeadline(owner.endAndWait(), 'PC-51 command owner cleanup');
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    // App 退出顺序固定为业务 owner 先收口、诊断 writer 最后有界 drain。
    // 即使 sink 永久阻塞，也不能先消耗 logger 预算再开始停止命令树。
    if (diagnosticWriter) {
      try {
        await diagnosticWriter.shutdown();
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (observation) {
      try {
        await assertMacosProductionAgentProcessTreeExited(observation, {
          timeoutMs: 8_000,
          verifyHeartbeatStopped: false,
        });
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (mountedDevice) {
      try {
        await detachAndVerifyDiskImage({ device: mountedDevice, imagePath });
        mountedDevice = undefined;
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    // 卸载失败时保留精确镜像和挂载根，避免递归删除仍挂载的文件系统掩盖设备残留。
    if (!mountedDevice) {
      try {
        await isolated.cleanup();
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
  }
  if (primaryError !== undefined || cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors].filter(error => error !== undefined),
      'PC-51 disk-full command owner validation failed',
    );
  }
  if (!result) throw new Error('PC-51 disk-full validation finished without a result');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main();
