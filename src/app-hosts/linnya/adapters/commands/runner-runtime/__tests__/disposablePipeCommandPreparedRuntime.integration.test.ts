import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  PipeCommandLaunchSnapshotV1Schema,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionIdentity,
  type CommandRunnerEventV1,
  type CommandRunnerRequestV1,
} from '@app/schemas/commands';
import {
  CommandArtifactInstanceIdSchema,
  type CommandOutputArtifactOwner,
  type CommandRunnerProcessControl,
  type CommandRunnerProcessHandlers,
  type CommandRunnerProcessPort,
} from '../../../../../../domains/commands';
import {
  createFileCommandOutputArtifactPort,
  deriveCommandOutputArtifactRelativePaths,
} from '../../../../../../infra/adapters/command-runtime/output';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import {
  createDisposablePipeCommandPreparedRuntime as createProductionDisposablePipeCommandPreparedRuntime,
} from '../orchestration/createDisposablePipeCommandPreparedRuntime';

type PreparedRuntimeTestInput = Omit<
  Parameters<typeof createProductionDisposablePipeCommandPreparedRuntime>[0],
  'text'
>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface FakeRunnerProcess extends CommandRunnerProcessControl {
  readonly sent: CommandRunnerRequestV1[];
  readonly disconnectCount: number;
  readonly killCount: number;
  readonly disconnected: Promise<void>;
  emit(event: unknown): void;
  diagnose(bytes: Uint8Array): void;
  fail(error: unknown): void;
  disconnectFromRunner(): void;
  close(): void;
}

const storageRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(storageRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
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

function createDisposablePipeCommandPreparedRuntime(input: PreparedRuntimeTestInput) {
  return createProductionDisposablePipeCommandPreparedRuntime({
    ...input,
    text: {
      currentLogicalLineLimits: { maxCharactersPerCurrentLine: 1_000 },
      agentTextProjectionLimits: {
        maxCharactersPerStream: 2_000,
        maxLinesPerStream: 200,
      },
      openWriter: async () => createMemoryTextWriter(),
    },
  });
}

async function createStorageRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-prepared-runtime-'));
  storageRoots.push(root);
  return root;
}

function createIdentity(): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `prepared-conversation-${randomUUID()}`,
    agent_run_id: `prepared-run-${randomUUID()}`,
    origin_tool_call_id: `prepared-call-${randomUUID()}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: 100,
  });
}

function createFixture() {
  const identity = createIdentity();
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  } as const;
  const launch = PipeCommandLaunchSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'pipe_command_launch_snapshot',
    conversation_root: process.cwd(),
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'printf prepared',
      cwd: process.cwd(),
      permission,
    },
    permission,
    mode: 'pipe',
    shell: {
      platform: 'macos',
      shell_semantics_id: 'zsh',
      shell_version: '5.9',
      snapshot_revision: 'prepared-runtime-test',
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'plain-v1',
      executable_path: '/bin/zsh',
      argv_prefix: ['-f', '-c'],
    },
    environment: { revision: 'prepared-runtime-test', entries: {} },
    stdin: 'closed',
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 10_000,
  });
  const artifactOwner: CommandOutputArtifactOwner = {
    identity,
    instance_id: CommandArtifactInstanceIdSchema.parse('default'),
  };
  return { identity, launch, artifactOwner };
}

function createFakeRunnerProcessPort(input: {
  readonly startSend?: Deferred<void>;
  readonly forkError?: Error;
} = {}): {
  readonly port: CommandRunnerProcessPort;
  readonly forked: Promise<FakeRunnerProcess>;
  readProcess(): FakeRunnerProcess | undefined;
} {
  let processInstance: FakeRunnerProcess | undefined;
  const forked = deferred<FakeRunnerProcess>();
  return {
    port: {
      fork(handlers: CommandRunnerProcessHandlers) {
        if (input.forkError) throw input.forkError;
        let disconnectCount = 0;
        let killCount = 0;
        const disconnected = deferred<void>();
        const sent: CommandRunnerRequestV1[] = [];
        processInstance = {
          sent,
          disconnected: disconnected.promise,
          get disconnectCount() {
            return disconnectCount;
          },
          get killCount() {
            return killCount;
          },
          send(request) {
            sent.push(request);
            if (request.kind === 'command_runner_start' && input.startSend) {
              return input.startSend.promise;
            }
            return Promise.resolve();
          },
          disconnect() {
            disconnectCount += 1;
            disconnected.resolve();
          },
          kill() {
            killCount += 1;
          },
          emit(event) {
            handlers.onMessage(event);
          },
          diagnose(bytes) {
            handlers.onDiagnostic(bytes);
          },
          fail(error) {
            handlers.onError(error);
          },
          disconnectFromRunner() {
            handlers.onDisconnect();
          },
          close() {
            handlers.onClose();
          },
        };
        forked.resolve(processInstance);
        return processInstance;
      },
    },
    forked: forked.promise,
    readProcess: () => processInstance,
  };
}

function started(identity: CommandExecutionIdentity) {
  return parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_started',
    identity,
    started_at_ms: 200,
  });
}

function output(identity: CommandExecutionIdentity, bytes: readonly number[]) {
  return parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_output',
    identity,
    channel: 'stdout',
    sequence: 0,
    bytes: Uint8Array.from(bytes),
  });
}

function terminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly stdoutBytes?: number;
}): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_terminal' }> {
  const stdoutBytes = input.stdoutBytes ?? 0;
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
        next_sequence: stdoutBytes > 0 ? 1 : 0,
        observed_bytes: stdoutBytes,
      },
      stderr: {
        source_completion: 'complete',
        next_sequence: 0,
        observed_bytes: 0,
      },
    },
  });
  if (event.kind !== 'command_runner_terminal') {
    throw new Error('terminal fixture produced a non-terminal event');
  }
  return event;
}

function executionDirectory(root: string, owner: CommandOutputArtifactOwner): string {
  return path.join(
    root,
    ...deriveCommandOutputArtifactRelativePaths(owner, 'pipe').directorySegments,
  );
}

async function nextTurn(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe('disposable pipe command prepared runtime', () => {
  it('prepare 阶段冻结完整 start request，后续 launch 引用变化不能推迟到 fork 后校验', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 350,
    });

    Object.defineProperty(fixture.launch.shell, 'shell_semantics_id', {
      value: 'invalid-after-prepare',
    });
    const startResult = runtime.start();
    const processInstance = await runner.forked;
    expect(processInstance.sent[0]).toMatchObject({
      kind: 'command_runner_start',
      launch: { shell: { shell_semantics_id: 'zsh' } },
    });

    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.emit(terminal({ identity: fixture.identity }));
    processInstance.close();
    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
    });
  });

  it('prepare 不创建资源，fork 前 owner stop 只丢弃空 artifact', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    let openCount = 0;
    const realArtifactPort = createFileCommandOutputArtifactPort({ storageRoot });
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: {
        async open(request) {
          openCount += 1;
          return realArtifactPort.open(request);
        },
      },
      runnerProcess: runner.port,
      now: () => 400,
    });

    expect(openCount).toBe(0);
    expect(runner.readProcess()).toBeUndefined();
    const stopping = runtime.stopAndWait('owner_ended');
    const startedResult = await runtime.start();
    await expect(stopping).resolves.toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'owner_ended',
      process_exit: { status: 'not_started' },
    });
    expect(startedResult.status).toBe('terminal');
    expect(openCount).toBe(1);
    expect(runner.readProcess()).toBeUndefined();
    await expect(fsp.stat(executionDirectory(storageRoot, fixture.artifactOwner)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('start delivery 确认后才发送 stop，并等 helper close 与 artifact 封存', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const startSend = deferred<void>();
    const runner = createFakeRunnerProcessPort({ startSend });
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 500,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    const stopping = runtime.stopAndWait('user_cancelled');
    expect(processInstance.sent.map(request => request.kind)).toEqual(['command_runner_start']);

    startSend.resolve();
    await nextTurn();
    expect(processInstance.sent.map(request => request.kind)).toEqual([
      'command_runner_start',
      'command_runner_stop',
    ]);
    expect(processInstance.sent[1]).toMatchObject({ cause: 'user_cancelled' });

    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.emit(output(fixture.identity, [1, 2, 3]));
    processInstance.emit(terminal({ identity: fixture.identity, stdoutBytes: 3 }));
    let terminalResolved = false;
    void runtime.terminal.then(() => {
      terminalResolved = true;
    });
    await nextTurn();
    expect(terminalResolved).toBe(false);

    processInstance.close();
    await expect(stopping).resolves.toMatchObject({
      outcome: 'execution_ended',
      process_exit: { status: 'observed', exit_code: 0 },
    });
    await expect(runtime.outputSettlement).resolves.toMatchObject({
      terminal: { outcome: 'execution_ended' },
      artifact: { status: 'manifest_persisted' },
    });
    await expect(runtime.settledTextOutput).resolves.toMatchObject({ mode: 'pipe' });
    await expect(fsp.readFile(
      path.join(executionDirectory(storageRoot, fixture.artifactOwner), 'stdout.bin'),
    )).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('helper close 无 terminal 时封存合法前缀并形成唯一 runtime_lost', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 600,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    processInstance.emit(output(fixture.identity, [9, 8]));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      resource_release: { status: 'succeeded' },
    });
    await expect(fsp.readFile(
      path.join(executionDirectory(storageRoot, fixture.artifactOwner), 'stdout.bin'),
    )).resolves.toEqual(Buffer.from([9, 8]));
  });

  it('helper terminal 后拒绝 close 会有界失败并阻断资源释放', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 700,
      closeDeadlineMs: 20,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.emit(terminal({ identity: fixture.identity }));

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
    expect(processInstance.disconnectCount).toBe(1);
    expect(processInstance.killCount).toBe(1);
  });

  it('helper terminal 与 close 之间的迟到 stop 只等待收口，不改写真实终态', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 750,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.emit(terminal({ identity: fixture.identity }));
    const stopping = runtime.stopAndWait('owner_ended');

    expect(processInstance.sent.map(request => request.kind)).toEqual(['command_runner_start']);
    processInstance.disconnectFromRunner();
    processInstance.close();
    await expect(stopping).resolves.toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
    });
  });

  it('fork 同步失败发生在 start request 前，因此丢弃 artifact 并报告 runtime unavailable', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: createFakeRunnerProcessPort({
        forkError: new Error('fork unavailable'),
      }).port,
      now: () => 800,
    });

    await expect(runtime.start()).resolves.toMatchObject({
      status: 'terminal',
      terminal: {
        outcome: 'runtime_failure',
        failure: { code: 'runtime_unavailable' },
        process_exit: { status: 'not_started' },
      },
    });
    await expect(fsp.stat(executionDirectory(storageRoot, fixture.artifactOwner)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('无效 runner 消息先断开 helper，close 后统一形成 runtime_lost', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 900,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit({ kind: 'not-a-runner-event' });
    expect(processInstance.disconnectCount).toBe(1);
    processInstance.close();

    await expect(startResult).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'runtime_lost' } },
    });
    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
  });

  it('pipe runtime 收到合法 PTY 输出时也按分路协议失败收口', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 910,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });

    processInstance.emit(parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_pty_output',
      identity: fixture.identity,
      channel: 'terminal',
      sequence: 0,
      bytes: Uint8Array.from([1, 2, 3]),
    }));
    expect(processInstance.disconnectCount).toBe(1);
    processInstance.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
  });

  it('start request 发送失败会收口 helper 并形成 runtime_lost', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const startSend = deferred<void>();
    const runner = createFakeRunnerProcessPort({ startSend });
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 925,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    startSend.reject(new Error('IPC send failed'));
    await processInstance.disconnected;
    processInstance.close();

    await expect(startResult).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'runtime_lost' } },
    });
  });

  it('start handshake 到期会停止无响应 helper，而不是无限等待', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 950,
      startHandshakeDeadlineMs: 20,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    await processInstance.disconnected;
    processInstance.close();

    await expect(startResult).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'runtime_lost' } },
    });
  });

  it('pipe helper 在 started 后沉默时先强杀，再等待 close 期限确认资源失败', async () => {
    vi.useFakeTimers();
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 960,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });

    let terminalSettled = false;
    void runtime.terminal.then(() => { terminalSettled = true; });
    await vi.advanceTimersByTimeAsync(22_999);
    expect(processInstance.killCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(processInstance.disconnectCount).toBe(1);
    expect(processInstance.killCount).toBe(1);
    expect(terminalSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(terminalSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
    await expect(runtime.outputSettlement).resolves.toMatchObject({
      terminal: { failure: { code: 'runtime_lost' } },
    });
    // close 期限只确认释放失败，不能再次终止同一个 Utility。
    expect(processInstance.disconnectCount).toBe(1);
    expect(processInstance.killCount).toBe(1);
  });

  it('慢握手后的可信 terminal 取消最终沉默期限并保留真实终因', async () => {
    vi.useFakeTimers();
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 962,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    await vi.advanceTimersByTimeAsync(9_500);
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });

    // 旧实现从 fork 起算最终期限，terminal 后会在 close 期限之前误杀 Utility。
    await vi.advanceTimersByTimeAsync(10_000);
    processInstance.emit(terminal({ identity: fixture.identity }));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(processInstance.killCount).toBe(0);
    processInstance.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      resource_release: { status: 'succeeded' },
    });
    expect(processInstance.disconnectCount).toBe(0);
    expect(processInstance.killCount).toBe(0);
  });

  it('helper error 会有界收口，不穿透 EventEmitter', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 965,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    expect(() => processInstance.fail(new Error('helper failed'))).not.toThrow();
    await processInstance.disconnected;
    processInstance.close();

    await expect(startResult).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'runtime_lost' } },
    });
  });

  it('output handler 同步异常会在 EventEmitter 边界内收口', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const realArtifactPort = createFileCommandOutputArtifactPort({ storageRoot });
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: {
        async open(request) {
          const opened = await realArtifactPort.open(request);
          if (opened.status !== 'opened') return opened;
          const { writer } = opened;
          return {
            status: 'opened',
            writer: {
              owner: writer.owner,
              mode: writer.mode,
              append() {
                throw new Error('injected synchronous output handler failure');
              },
              discardBeforeSourceStart: () => writer.discardBeforeSourceStart(),
              finalize: requestFinalize => writer.finalize(requestFinalize),
            },
          };
        },
      },
      runnerProcess: runner.port,
      now: () => 975,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    expect(() => processInstance.emit(output(fixture.identity, [1]))).not.toThrow();
    await processInstance.disconnected;
    processInstance.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
  });

  it('诊断 sink 首次抛错后熔断，但不改变命令终态', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    let diagnosticCalls = 0;
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 990,
      onDiagnostic() {
        diagnosticCalls += 1;
        throw new Error('diagnostic sink unavailable');
      },
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    expect(() => processInstance.diagnose(Uint8Array.from([1]))).not.toThrow();
    expect(() => processInstance.diagnose(Uint8Array.from([2]))).not.toThrow();
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.emit(terminal({ identity: fixture.identity }));
    processInstance.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
    });
    expect(diagnosticCalls).toBe(1);
  });

  it('IPC disconnect 是独立失败事实，不等待不存在的 terminal', async () => {
    const storageRoot = await createStorageRoot();
    const fixture = createFixture();
    const runner = createFakeRunnerProcessPort();
    const runtime = createDisposablePipeCommandPreparedRuntime({
      ...fixture,
      artifactPort: createFileCommandOutputArtifactPort({ storageRoot }),
      runnerProcess: runner.port,
      now: () => 1_000,
    });

    const startResult = runtime.start();
    const processInstance = await runner.forked;
    processInstance.emit(started(fixture.identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    processInstance.disconnectFromRunner();
    processInstance.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
  });
});
