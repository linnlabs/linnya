import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandProcessHandleSchema,
  ProcessOutputCursorSchema,
  PtyCommandLaunchSnapshotV1Schema,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandRunnerEventV1,
  type CommandRunnerRequestV1,
} from '@app/schemas/commands';
import type {
  CommandProcessOutputObservationPort,
  CommandRunnerProcessControl,
  CommandRunnerProcessHandlers,
  CommandRunnerProcessPort,
} from '../../../../../../domains/commands';
import { createLocalCommandExecutionOwner } from '../../process-owner';
import {
  type DisposablePtyCommandOutputSink,
  type DisposablePtyCommandPreparedOutput,
} from '../definitions/disposablePtyCommandPreparedRuntime';
import type { PtyCommandOutputSettlement } from '../../output';
import {
  createDisposablePtyCommandPreparedRuntime,
} from '../orchestration/createDisposablePtyCommandPreparedRuntime';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

afterEach(() => vi.useRealTimers());

interface FakeRunner extends CommandRunnerProcessControl {
  readonly sent: CommandRunnerRequestV1[];
  readonly disconnectCount: number;
  readonly killCount: number;
  emit(event: unknown): void;
  diagnose(bytes: Uint8Array): void;
  fail(error: unknown): void;
  disconnectFromRunner(): void;
  close(): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createIdentity(label: string): CommandExecutionIdentity {
  return CommandExecutionIdentitySchema.parse({
    conversation_id: `pty-prepared-conversation-${label}`,
    agent_run_id: `pty-prepared-run-${label}`,
    origin_tool_call_id: `pty-prepared-call-${label}`,
    command_execution_id: `command_execution_${randomUUID()}`,
    owner_generation_id: `command_owner_${randomUUID()}`,
    created_at_ms: 100,
  });
}

function createLaunch(identity: CommandExecutionIdentity) {
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'standard',
    effective_level: 'standard',
    grant_source: 'global_setting',
    internal_data_access: 'denied',
  } as const;
  return PtyCommandLaunchSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'pty_command_launch_snapshot',
    conversation_root: process.cwd(),
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'printf pty-prepared',
      cwd: process.cwd(),
      permission,
    },
    permission,
    mode: 'pty',
    shell: {
      platform: 'macos',
      shell_semantics_id: 'zsh',
      shell_version: '5.9',
      snapshot_revision: 'pty-prepared-test',
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'plain-v1',
      executable_path: '/bin/zsh',
      argv_prefix: ['-f', '-c'],
    },
    environment: { revision: 'pty-prepared-test', entries: {} },
    stdin: 'pty',
    terminal_size: { columns: 80, rows: 24 },
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 10_000,
  });
}

function createTerminal(
  identity: CommandExecutionIdentity,
  output: { readonly nextSequence: number; readonly observedBytes: number } = {
    nextSequence: 0,
    observedBytes: 0,
  },
  terminationCause: 'natural_exit' | 'owner_ended' = 'natural_exit',
): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_terminal' }> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_terminal',
    terminal: parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity,
      settled_at_ms: 300,
      outcome: 'execution_ended',
      termination_cause: terminationCause,
      process_exit: { status: 'observed', exit_code: 0, signal: null },
      output_drain: { status: 'complete' },
      tree_cleanup: terminationCause === 'natural_exit'
        ? { status: 'not_required' }
        : { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    }),
    output_sources: {
      mode: 'pty',
      terminal: {
        source_completion: 'complete',
        next_sequence: output.nextSequence,
        observed_bytes: output.observedBytes,
      },
    },
  });
  if (event.kind !== 'command_runner_terminal') {
    throw new Error('PTY terminal fixture produced another event');
  }
  return event;
}

function createRuntimeLostTerminal(
  identity: CommandExecutionIdentity,
  settledAtMs: number,
  resourceRelease: 'succeeded' | 'failed',
  candidate?: CommandExecutionTerminalV1,
): CommandExecutionTerminalV1 {
  const candidateStarted = candidate && candidate.process_exit.status !== 'not_started';
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity,
    settled_at_ms: settledAtMs,
    outcome: 'runtime_failure',
    failure: { code: 'runtime_lost' },
    process_exit: candidateStarted
      ? candidate?.process_exit
      : { status: 'unavailable', reason: 'runtime_lost' },
    output_drain: { status: 'failed', code: 'output_drain_failed', reason: 'runtime_lost' },
    tree_cleanup: candidateStarted
      ? candidate?.tree_cleanup
      : { status: 'failed', code: 'tree_cleanup_failed' },
    resource_release: resourceRelease === 'succeeded'
      ? { status: 'succeeded' }
      : { status: 'failed', code: 'resource_release_failed' },
  });
}

function createObservation(): CommandProcessOutputObservationPort {
  const cursor = ProcessOutputCursorSchema.parse(0);
  const result = Object.freeze({
    status: 'observed' as const,
    observation: Object.freeze({
      mode: 'pty' as const,
      coverage: 'complete' as const,
      requestedCursor: cursor,
      availableAfterCursor: cursor,
      nextCursor: cursor,
      outputPhase: 'open' as const,
      textProjection: 'available' as const,
    }),
  });
  return Object.freeze({
    read: () => result,
    waitForChange: async () => result,
  });
}

function createOutputSettlement(
  terminal: CommandExecutionTerminalV1,
): PtyCommandOutputSettlement {
  return Object.freeze({
    terminal,
    artifact: Object.freeze({
      status: 'unavailable' as const,
      failure: Object.freeze({
        code: 'io_failure' as const,
        stage: 'append' as const,
        occurred_at_ms: terminal.settled_at_ms,
        last_persisted_offset: 0,
      }),
    }),
    text: Object.freeze({
      sourceCompletion: terminal.process_exit.status === 'not_started'
        ? 'not_started' as const
        : 'interrupted' as const,
      projection: Object.freeze({ status: 'failed' as const }),
      blob: Object.freeze({
        status: 'unavailable' as const,
        failureCode: 'projection_failed' as const,
      }),
      cleanup: 'not_required' as const,
    }),
  });
}

function createOutput(identity: CommandExecutionIdentity, options: {
  readonly rejectRuntimeLossSettlement?: boolean;
} = {}): {
  readonly prepared: DisposablePtyCommandPreparedOutput;
  readonly outputEvents: CommandRunnerEventV1[];
  readonly acceptedResizes: Array<{ readonly columns: number; readonly rows: number }>;
  readonly openCount: () => number;
} {
  let opens = 0;
  const outputEvents: CommandRunnerEventV1[] = [];
  const acceptedResizes: Array<{ readonly columns: number; readonly rows: number }> = [];
  const sink: DisposablePtyCommandOutputSink = {
    acceptStarted(event) {
      outputEvents.push(event);
      return true;
    },
    acceptOutput(event) {
      outputEvents.push(event);
      return true;
    },
    acceptResize(size) {
      acceptedResizes.push(size);
    },
    async settleRunnerTerminal(input) {
      outputEvents.push(input.event);
      return createOutputSettlement(input.event.terminal);
    },
    async settleRuntimeLoss(input) {
      if (options.rejectRuntimeLossSettlement) {
        throw new Error('simulated PTY output settlement failure');
      }
      return createOutputSettlement(createRuntimeLostTerminal(
        identity,
        input.settledAtMs,
        input.resourceRelease,
        input.candidate,
      ));
    },
    async settleBeforeSourceStart(input) {
      return createOutputSettlement(parseCommandExecutionTerminal({
        protocol_version: 1,
        kind: 'command_execution_terminal',
        identity,
        settled_at_ms: input.settledAtMs,
        outcome: 'runtime_failure',
        failure: { code: input.failureCode },
        process_exit: { status: 'not_started' },
        output_drain: { status: 'not_started' },
        tree_cleanup: { status: 'not_required' },
        resource_release: { status: 'not_required' },
      }));
    },
    async settleBeforeSourceStartTermination(input) {
      return createOutputSettlement(parseCommandExecutionTerminal({
        protocol_version: 1,
        kind: 'command_execution_terminal',
        identity,
        settled_at_ms: input.settledAtMs,
        outcome: 'execution_ended',
        termination_cause: input.cause,
        process_exit: { status: 'not_started' },
        output_drain: { status: 'not_started' },
        tree_cleanup: { status: 'not_required' },
        resource_release: { status: 'not_required' },
      }));
    },
  };
  return {
    prepared: {
      observation: createObservation(),
      async open() {
        opens += 1;
        return sink;
      },
    },
    outputEvents,
    acceptedResizes,
    openCount: () => opens,
  };
}

function createRunnerPort(input: {
  readonly interactionAck?: Deferred<void>;
} = {}): {
  readonly port: CommandRunnerProcessPort;
  readonly forked: Promise<FakeRunner>;
  readonly forkCount: () => number;
} {
  let forks = 0;
  const forked = deferred<FakeRunner>();
  return {
    port: {
      fork(handlers: CommandRunnerProcessHandlers) {
        forks += 1;
        let disconnectCount = 0;
        let killCount = 0;
        const sent: CommandRunnerRequestV1[] = [];
        const runner: FakeRunner = {
          sent,
          get disconnectCount() {
            return disconnectCount;
          },
          get killCount() {
            return killCount;
          },
          send(request) {
            sent.push(request);
            if (request.kind === 'command_runner_interaction' && input.interactionAck) {
              return input.interactionAck.promise;
            }
            return Promise.resolve();
          },
          disconnect() {
            disconnectCount += 1;
          },
          kill() {
            killCount += 1;
          },
          emit: event => handlers.onMessage(event),
          diagnose: bytes => handlers.onDiagnostic(bytes),
          fail: error => handlers.onError(error),
          disconnectFromRunner: () => handlers.onDisconnect(),
          close: () => handlers.onClose(),
        };
        forked.resolve(runner);
        return runner;
      },
    },
    forked: forked.promise,
    forkCount: () => forks,
  };
}

function started(identity: CommandExecutionIdentity): CommandRunnerEventV1 {
  return parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_started',
    identity,
    started_at_ms: 200,
  });
}

function interactionResult(input: {
  readonly identity: CommandExecutionIdentity;
  readonly id: number;
  readonly result: { readonly status: 'accepted' } | {
    readonly status: 'rejected';
    readonly code: 'input_budget_exceeded';
  };
}): CommandRunnerEventV1 {
  return parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_interaction_result',
    identity: input.identity,
    interaction_id: input.id,
    result: input.result,
  });
}

async function createRunningFixture(label: string, input: {
  readonly interactionAck?: Deferred<void>;
} = {}) {
  const identity = createIdentity(label);
  const output = createOutput(identity);
  const runnerPort = createRunnerPort(input);
  const runtime = createDisposablePtyCommandPreparedRuntime({
    launch: createLaunch(identity),
    runnerProcess: runnerPort.port,
    output: output.prepared,
    now: () => 400,
    closeDeadlineMs: 100,
  });
  const startResult = runtime.start();
  const runner = await runnerPort.forked;
  runner.emit(started(identity));
  await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
  if (runtime.interaction.kind !== 'pty') throw new Error('PTY fixture has closed input');
  return { identity, output, runnerPort, runtime, runner, interaction: runtime.interaction };
}

async function finishNaturally(input: Awaited<ReturnType<typeof createRunningFixture>>): Promise<void> {
  input.runner.emit(createTerminal(input.identity));
  input.runner.close();
  await expect(input.runtime.terminal).resolves.toMatchObject({
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
  });
}

async function expectPending<T>(promise: Promise<T>): Promise<void> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
}

describe('disposable PTY command prepared runtime', () => {
  it('prepare 同步零资源，start 才 open/fork 并发送 PTY launch 与 terminal 单流', async () => {
    const identity = createIdentity('resources');
    const output = createOutput(identity);
    const runnerPort = createRunnerPort();
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: output.prepared,
      now: () => 400,
    });

    expect(output.openCount()).toBe(0);
    expect(runnerPort.forkCount()).toBe(0);
    const startResult = runtime.start();
    const runner = await runnerPort.forked;
    expect(output.openCount()).toBe(1);
    expect(runner.sent[0]).toMatchObject({
      kind: 'command_runner_start',
      launch: { mode: 'pty', terminal_size: { columns: 80, rows: 24 } },
    });
    runner.emit(started(identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    runner.emit(parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_pty_output',
      identity,
      channel: 'terminal',
      sequence: 0,
      bytes: Uint8Array.from([1, 2, 3]),
    }));
    expect(output.outputEvents.map(event => event.kind)).toEqual([
      'command_runner_started',
      'command_runner_pty_output',
    ]);
    runner.emit(createTerminal(identity, { nextSequence: 1, observedBytes: 3 }));
    runner.close();
    await runtime.terminal;
    await expect(runtime.outputSettlement).resolves.toMatchObject({
      terminal: { outcome: 'execution_ended' },
    });
    await expect(runtime.settledTextOutput).resolves.toMatchObject({ mode: 'pty' });
  });

  it('output open 期间 owner stop 先赢时不再 fork helper', async () => {
    const identity = createIdentity('stop-during-open');
    const output = createOutput(identity);
    const openGate = deferred<void>();
    const runnerPort = createRunnerPort();
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: {
        observation: output.prepared.observation,
        async open() {
          await openGate.promise;
          return output.prepared.open();
        },
      },
      now: () => 405,
    });

    const startResult = runtime.start();
    const stopping = runtime.stopAndWait('owner_ended');
    openGate.resolve();
    await expect(startResult).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'execution_ended', termination_cause: 'owner_ended' },
    });
    await expect(stopping).resolves.toMatchObject({ outcome: 'execution_ended' });
    expect(runnerPort.forkCount()).toBe(0);
  });

  it('start handshake 到期会断开无响应 helper，并在 close 后形成 runtime_lost', async () => {
    const identity = createIdentity('start-handshake-timeout');
    const output = createOutput(identity);
    const runnerPort = createRunnerPort();
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: output.prepared,
      now: () => 410,
      startHandshakeDeadlineMs: 10,
      closeDeadlineMs: 100,
    });

    const startResult = runtime.start();
    const runner = await runnerPort.forked;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(runner.disconnectCount).toBe(1);
    runner.close();

    await expect(startResult).resolves.toMatchObject({
      status: 'terminal',
      terminal: { outcome: 'runtime_failure', failure: { code: 'runtime_lost' } },
    });
  });

  it('started 后沉默的 PTY helper 被强杀时拒绝 pending，并以真实 close 确认释放成功', async () => {
    vi.useFakeTimers();
    const identity = createIdentity('host-final-deadline');
    const output = createOutput(identity);
    const runnerPort = createRunnerPort();
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: output.prepared,
      now: () => 420,
    });

    const startResult = runtime.start();
    const runner = await runnerPort.forked;
    runner.emit(started(identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    if (runtime.interaction.kind !== 'pty') throw new Error('PTY runtime has closed input');
    const writing = runtime.interaction.write('pending');
    const writingRejected = writing.catch(error => error);

    let terminalSettled = false;
    void runtime.terminal.then(() => { terminalSettled = true; });
    await vi.advanceTimersByTimeAsync(22_999);
    expect(terminalSettled).toBe(false);
    expect(runner.killCount).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await expect(writingRejected).resolves.toMatchObject({ code: 'interaction_failed' });
    expect(terminalSettled).toBe(false);
    expect(runner.disconnectCount).toBe(1);
    expect(runner.killCount).toBe(1);

    runner.close();
    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      resource_release: { status: 'succeeded' },
    });
    expect(runner.disconnectCount).toBe(1);
    expect(runner.killCount).toBe(1);
  });

  it('重复 started 会 fail closed，不能重开同一 helper 生命周期', async () => {
    const fixture = await createRunningFixture('duplicate-started');

    fixture.runner.emit(started(fixture.identity));
    expect(fixture.runner.disconnectCount).toBe(1);
    fixture.runner.close();

    await expect(fixture.runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
  });

  it('诊断 sink 首次失败后熔断，但不改变 PTY 的自然终态', async () => {
    const identity = createIdentity('diagnostic-circuit-breaker');
    const output = createOutput(identity);
    const runnerPort = createRunnerPort();
    let diagnosticCalls = 0;
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: output.prepared,
      now: () => 420,
      onDiagnostic() {
        diagnosticCalls += 1;
        throw new Error('diagnostic sink unavailable');
      },
    });

    const startResult = runtime.start();
    const runner = await runnerPort.forked;
    expect(() => runner.diagnose(Uint8Array.from([1]))).not.toThrow();
    expect(() => runner.diagnose(Uint8Array.from([2]))).not.toThrow();
    runner.emit(started(identity));
    await expect(startResult).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    runner.emit(createTerminal(identity));
    runner.close();

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
    });
    expect(diagnosticCalls).toBe(1);
  });

  it('transport ACK 不结算交互，只有 matching result 才结算', async () => {
    const ack = deferred<void>();
    const fixture = await createRunningFixture('ack-result', { interactionAck: ack });
    const writing = fixture.interaction.write('hello');
    const request = fixture.runner.sent.find(item => item.kind === 'command_runner_interaction');
    expect(request).toMatchObject({ interaction_id: 0, action: { type: 'write', input: 'hello' } });

    ack.resolve();
    await expectPending(writing);
    fixture.runner.emit(interactionResult({
      identity: fixture.identity,
      id: 0,
      result: { status: 'accepted' },
    }));
    await expect(writing).resolves.toBeUndefined();
    await finishNaturally(fixture);
  });

  it('多个 pending 使用单调 ID，并按各自 result 独立结算', async () => {
    const fixture = await createRunningFixture('multiple');
    const first = fixture.interaction.write('first');
    const second = fixture.interaction.resize({ columns: 100, rows: 40 });
    const requests = fixture.runner.sent.filter(
      request => request.kind === 'command_runner_interaction',
    );
    expect(requests.map(request => request.interaction_id)).toEqual([0, 1]);

    fixture.runner.emit(interactionResult({
      identity: fixture.identity,
      id: 1,
      result: { status: 'accepted' },
    }));
    await expect(second).resolves.toBeUndefined();
    expect(fixture.output.acceptedResizes).toEqual([{ columns: 100, rows: 40 }]);
    await expectPending(first);
    fixture.runner.emit(interactionResult({
      identity: fixture.identity,
      id: 0,
      result: { status: 'rejected', code: 'input_budget_exceeded' },
    }));
    await expect(first).resolves.toMatchObject({
      status: 'rejected',
      code: 'input_budget_exceeded',
    });
    await finishNaturally(fixture);
  });

  it('terminal 先赢时立即拒绝 pending，迟到 result 触发 fail closed', async () => {
    const fixture = await createRunningFixture('terminal-race');
    const writing = fixture.interaction.submit('answer');
    fixture.runner.emit(createTerminal(fixture.identity));
    await expect(writing).rejects.toMatchObject({ code: 'stdin_closed' });

    fixture.runner.emit(interactionResult({
      identity: fixture.identity,
      id: 0,
      result: { status: 'accepted' },
    }));
    expect(fixture.runner.disconnectCount).toBe(1);
    fixture.runner.close();
    await expect(fixture.runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
    });
  });

  it.each(['error', 'disconnect', 'close'] as const)(
    'runner %s 会真实拒绝全部 pending 并形成 runtime_lost',
    async scenario => {
      const fixture = await createRunningFixture(`runner-loss-${scenario}`);
      const first = fixture.interaction.write('first');
      const second = fixture.interaction.eof();
      if (scenario === 'error') fixture.runner.fail(new Error('runner channel failed'));
      else if (scenario === 'disconnect') fixture.runner.disconnectFromRunner();
      else fixture.runner.close();

      await expect(first).rejects.toMatchObject({ code: 'interaction_failed' });
      await expect(second).rejects.toMatchObject({ code: 'interaction_failed' });
      if (scenario !== 'close') fixture.runner.close();
      await expect(fixture.runtime.terminal).resolves.toMatchObject({
        outcome: 'runtime_failure',
        failure: { code: 'runtime_lost' },
      });
    },
  );

  it.each(['unknown', 'duplicate', 'wrong_identity'] as const)(
    '%s interaction result 不得串入当前 execution',
    async scenario => {
      const fixture = await createRunningFixture(`fail-closed-${scenario}`);
      if (scenario === 'unknown') {
        fixture.runner.emit(interactionResult({
          identity: fixture.identity,
          id: 99,
          result: { status: 'accepted' },
        }));
      } else {
        const writing = fixture.interaction.write('value');
        fixture.runner.emit(interactionResult({
          identity: scenario === 'wrong_identity'
            ? createIdentity('other-generation')
            : fixture.identity,
          id: 0,
          result: { status: 'accepted' },
        }));
        if (scenario === 'duplicate') {
          await expect(writing).resolves.toBeUndefined();
          fixture.runner.emit(interactionResult({
            identity: fixture.identity,
            id: 0,
            result: { status: 'accepted' },
          }));
        } else {
          await expect(writing).rejects.toMatchObject({ code: 'interaction_failed' });
        }
      }

      expect(fixture.runner.disconnectCount).toBe(1);
      fixture.runner.close();
      await expect(fixture.runtime.terminal).resolves.toMatchObject({
        outcome: 'runtime_failure',
        failure: { code: 'runtime_lost' },
      });
    },
  );

  it('owner stop 不等待 runner result，立即结算 pending 并发送唯一 stop', async () => {
    const fixture = await createRunningFixture('owner-stop');
    const writing = fixture.interaction.write('pending');
    const stopping = fixture.runtime.stopAndWait('owner_ended');
    await expect(writing).rejects.toMatchObject({ code: 'stdin_closed' });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(fixture.runner.sent.filter(request => request.kind === 'command_runner_stop'))
      .toHaveLength(1);

    fixture.runner.emit(createTerminal(fixture.identity));
    fixture.runner.close();
    await expect(stopping).resolves.toMatchObject({ outcome: 'execution_ended' });
  });

  it('runner terminal 后未在期限内 close 时标记资源失败并阻止 owner 删除', async () => {
    const identity = createIdentity('close-timeout-owner-barrier');
    const output = createOutput(identity);
    const runnerPort = createRunnerPort();
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: output.prepared,
      now: () => 500,
      closeDeadlineMs: 10,
    });
    const owner = createLocalCommandExecutionOwner({
      generationId: identity.owner_generation_id,
      createProcessHandle: () => CommandProcessHandleSchema.parse(
        `command_process_${randomUUID()}`,
      ),
      now: () => 500,
    });
    const reservation = owner.reserve({ identity, mode: 'pty' });
    if (reservation.status !== 'reserved') throw new Error('PTY reservation rejected');
    const starting = owner.claimAndStart({
      binding: reservation.binding,
      prepareRuntime: () => runtime,
    });
    const runner = await runnerPort.forked;
    runner.emit(started(identity));
    await expect(starting).resolves.toMatchObject({ status: 'running' });

    const deleting = owner.stopConversationAndWait(identity.conversation_id);
    runner.emit(createTerminal(identity, undefined, 'owner_ended'));

    await expect(deleting).rejects.toMatchObject({
      name: 'LocalCommandExecutionOwnerError',
      causes: [{
        message: expect.stringContaining('resource_release_failed'),
      }],
    });
    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
    expect(runner.killCount).toBe(1);
    expect(owner.readActivitySnapshot().stoppingCount).toBe(1);
  });

  it('close deadline 与 output settlement 同时失败时仍保留资源失败事实', async () => {
    const identity = createIdentity('close-timeout-output-failure');
    const output = createOutput(identity, { rejectRuntimeLossSettlement: true });
    const runnerPort = createRunnerPort();
    const runtime = createDisposablePtyCommandPreparedRuntime({
      launch: createLaunch(identity),
      runnerProcess: runnerPort.port,
      output: output.prepared,
      now: () => 600,
      closeDeadlineMs: 10,
    });
    const starting = runtime.start();
    const runner = await runnerPort.forked;
    runner.emit(started(identity));
    await expect(starting).resolves.toEqual({ status: 'running', startedAtMs: 200 });
    runner.emit(createTerminal(identity, undefined, 'owner_ended'));

    await expect(runtime.terminal).resolves.toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
    await expect(runtime.outputSettlement).rejects.toThrow(
      'simulated PTY output settlement failure',
    );
    await expect(runtime.settledTextOutput).resolves.toEqual({
      mode: 'pty',
      terminal: { status: 'unavailable' },
    });
    expect(runner.killCount).toBe(1);
  });
});
