import { PassThrough } from 'node:stream';

import {
  CommandRunnerInteractionIdSchema,
  PtyCommandLaunchSnapshotV1Schema,
  parseCommandRunnerRequest,
  type CommandRunnerEventV1,
  type CommandRunnerRequestV1,
  type ProcessInteractionActionV1,
} from '@app/schemas/commands';
import { describe, expect, it, vi } from 'vitest';

import {
  CommandRunnerOwnedPtyProcessLaunchError,
  type LaunchCommandRunnerOwnedPtyProcess,
} from '../definitions/commandRunnerOwnedPtyProcess';
import type { LaunchCommandRunnerOwnedPipeProcess } from '../definitions/commandRunnerOwnedPipeProcess';
import type { CommandRunnerEventTransport } from '../definitions/commandRunnerOutputTransport';
import type {
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime';
import type { OwnedPtyCommandProcess } from '../definitions/ownedPtyCommandProcess';
import { createDisposablePtyCommandRun } from '../orchestration/createDisposablePtyCommandRun';
import {
  rejectUnavailableCommandRunnerPtyLaunch,
  runCommandRunnerProcess,
} from '../orchestration/runCommandRunnerProcess';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface FakePtyOwner {
  readonly process: OwnedPtyCommandProcess;
  readonly terminal: PassThrough;
  readonly rootExit: Deferred<OwnedProcessRootExit>;
  readonly treeEmpty: Deferred<OwnedProcessTreeStopResult>;
  readonly backendFailure: Deferred<Error>;
  readonly releaseResult: Deferred<OwnedProcessResourceReleaseResult>;
  readonly actions: readonly ProcessInteractionActionV1[];
  readonly stopCount: number;
  readonly releaseCount: number;
  setInteract(operation: (action: ProcessInteractionActionV1) => Promise<void>): void;
  setRelease(operation: () => void): void;
}

interface EventRecorder {
  readonly transport: CommandRunnerEventTransport;
  readonly delivered: readonly CommandRunnerEventV1[];
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

function createStartRequest(hardTimeoutMs = 60_000): Extract<
  CommandRunnerRequestV1,
  { readonly kind: 'command_runner_start' }
> {
  const identity = {
    conversation_id: 'pty-lifecycle-conversation',
    agent_run_id: 'pty-lifecycle-agent-run',
    origin_tool_call_id: 'pty-lifecycle-tool-call',
    command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000201',
    owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000202',
    created_at_ms: 100,
  };
  const permission = {
    protocol_version: 1 as const,
    kind: 'command_permission_snapshot' as const,
    identity,
    base_level: 'standard' as const,
    effective_level: 'standard' as const,
    grant_source: 'global_setting' as const,
    internal_data_access: 'denied' as const,
  };
  const request = parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: PtyCommandLaunchSnapshotV1Schema.parse({
      protocol_version: 1,
      kind: 'pty_command_launch_snapshot',
      conversation_root: process.cwd(),
      proposal: {
        protocol_version: 1,
        kind: 'shell_command_proposal',
        identity,
        command: 'printf pty-lifecycle',
        cwd: process.cwd(),
        permission,
      },
      permission,
      mode: 'pty',
      shell: {
        platform: 'macos',
        shell_semantics_id: 'zsh',
        shell_version: '5.9',
        snapshot_revision: 'pty-lifecycle-test',
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        argv_prefix: ['-f', '-c'],
      },
      environment: { revision: 'pty-lifecycle-test', entries: {} },
      stdin: 'pty',
      terminal_size: { columns: 80, rows: 24 },
      lifecycle_policy: 'terminate_with_run',
      hard_timeout_ms: hardTimeoutMs,
    }),
  });
  if (request.kind !== 'command_runner_start') throw new Error('invalid PTY start fixture');
  return request;
}

const START_REQUEST = createStartRequest();

function createFakeOwner(): FakePtyOwner {
  const terminal = new PassThrough();
  const rootExit = deferred<OwnedProcessRootExit>();
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();
  const backendFailure = deferred<Error>();
  const releaseResult = deferred<OwnedProcessResourceReleaseResult>();
  const actions: ProcessInteractionActionV1[] = [];
  let stopCount = 0;
  let releaseCount = 0;
  let interaction: (action: ProcessInteractionActionV1) => Promise<void> = async () => {};
  let releaseOperation: (() => void) | undefined;
  return {
    terminal,
    rootExit,
    treeEmpty,
    backendFailure,
    releaseResult,
    actions,
    get stopCount() { return stopCount; },
    get releaseCount() { return releaseCount; },
    setInteract(operation) { interaction = operation; },
    setRelease(operation) { releaseOperation = operation; },
    process: {
      terminal,
      rootExit: rootExit.promise,
      treeEmpty: treeEmpty.promise,
      backendFailure: backendFailure.promise,
      async interact(action) {
        actions.push(action);
        await interaction(action);
      },
      stopAndWaitForTreeEmpty() {
        stopCount += 1;
        return treeEmpty.promise;
      },
      release() {
        releaseCount += 1;
        releaseOperation?.();
        return releaseResult.promise;
      },
    },
  };
}

function createRecorder(): EventRecorder {
  const delivered: CommandRunnerEventV1[] = [];
  return {
    delivered,
    transport: {
      offerOutput(event) {
        delivered.push(event);
        return { status: 'accepted' };
      },
      async sendControl(event) { delivered.push(event); },
    },
  };
}

function createRun(input: {
  readonly owner?: FakePtyOwner;
  readonly launch?: LaunchCommandRunnerOwnedPtyProcess;
  readonly events?: EventRecorder;
  readonly maxInputBytes?: number;
  readonly deadlineMs?: number;
}) {
  const owner = input.owner ?? createFakeOwner();
  const events = input.events ?? createRecorder();
  const run = createDisposablePtyCommandRun({
    request: START_REQUEST,
    events: events.transport,
    launchOwnedProcess: input.launch ?? (async () => owner.process),
    maxInputBytes: input.maxInputBytes,
    postTreeSettlementDeadlineMs: input.deadlineMs ?? 20,
    now: () => 200,
  });
  return { owner, events, run };
}

function interactionId(value: number) {
  return CommandRunnerInteractionIdSchema.parse(value);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('condition was not observed');
}

async function waitForStarted(events: EventRecorder): Promise<void> {
  await waitFor(() => events.delivered.some(event => event.kind === 'command_runner_started'));
}

function finish(owner: FakePtyOwner, exitCode = 0): void {
  owner.rootExit.resolve({ exitCode, signal: null });
  owner.treeEmpty.resolve({ status: 'succeeded' });
  owner.terminal.end();
  owner.releaseResult.resolve({ status: 'succeeded' });
}

function terminal(events: EventRecorder) {
  const event = events.delivered.find(candidate => candidate.kind === 'command_runner_terminal');
  if (!event || event.kind !== 'command_runner_terminal') throw new Error('terminal missing');
  return event;
}

describe('disposable PTY command owned lifecycle', () => {
  it('自然退出后保留 terminal 单流、tree 和 release 的完整事实', async () => {
    const { owner, events, run } = createRun({});
    const running = run.start();
    await waitForStarted(events);
    owner.terminal.write('hello PTY');
    finish(owner, 7);
    await running;

    expect(Buffer.from(events.delivered
      .filter(event => event.kind === 'command_runner_pty_output')
      .flatMap(event => [...event.bytes])).toString()).toBe('hello PTY');
    expect(terminal(events)).toMatchObject({
      terminal: {
        outcome: 'execution_ended',
        termination_cause: 'natural_exit',
        process_exit: { status: 'observed', exit_code: 7 },
        output_drain: { status: 'complete' },
        tree_cleanup: { status: 'succeeded' },
        resource_release: { status: 'succeeded' },
      },
      output_sources: { mode: 'pty', terminal: { source_completion: 'complete' } },
    });
    expect(events.delivered[events.delivered.length - 1]?.kind).toBe('command_runner_terminal');
  });

  it('输出 transport 过载时保留截断事实，但不制造第二条输出通道', async () => {
    const delivered: CommandRunnerEventV1[] = [];
    const events: EventRecorder = {
      delivered,
      transport: {
        offerOutput() { return { status: 'overloaded' }; },
        async sendControl(event) { delivered.push(event); },
      },
    };
    const { owner, run } = createRun({ events });
    const running = run.start();
    await waitForStarted(events);
    owner.terminal.write('not-delivered');
    finish(owner);
    await running;

    expect(events.delivered.some(event => event.kind === 'command_runner_pty_output')).toBe(false);
    expect(terminal(events)).toMatchObject({
      terminal: {
        output_drain: {
          status: 'failed',
          reason: 'runner_output_queue_overloaded',
        },
      },
      output_sources: {
        mode: 'pty',
        terminal: {
          source_completion: 'interrupted',
          interruption_reason: 'runner_output_queue_overloaded',
        },
      },
    });
  });

  it('按 UTF-8 byte 接受精确预算，超限动作不调用 backend', async () => {
    const { owner, events, run } = createRun({ maxInputBytes: 8 });
    const running = run.start();
    await waitForStarted(events);

    await run.interact(interactionId(0), { type: 'write', input: '😀' });
    await run.interact(interactionId(1), { type: 'submit', input: 'abcd' });
    await run.interact(interactionId(2), { type: 'write', input: 'x' });

    expect(owner.actions).toEqual([
      { type: 'write', input: '😀' },
      { type: 'submit', input: 'abcd' },
    ]);
    expect(events.delivered
      .filter(event => event.kind === 'command_runner_interaction_result')
      .map(event => event.result)).toEqual([
      { status: 'accepted' },
      { status: 'accepted' },
      { status: 'rejected', code: 'input_budget_exceeded' },
    ]);
    finish(owner);
    await running;
  });

  it('backend 异步拒绝映射为稳定 interaction_failed，且已交付 byte 仍占预算', async () => {
    const owner = createFakeOwner();
    owner.setInteract(async () => { throw new Error('private platform detail'); });
    const { events, run } = createRun({ owner, maxInputBytes: 1 });
    const running = run.start();
    await waitForStarted(events);

    await run.interact(interactionId(0), { type: 'write', input: 'a' });
    await run.interact(interactionId(1), { type: 'write', input: 'b' });
    expect(events.delivered
      .filter(event => event.kind === 'command_runner_interaction_result')
      .map(event => event.result)).toEqual([
      { status: 'rejected', code: 'interaction_failed' },
      { status: 'rejected', code: 'input_budget_exceeded' },
    ]);
    expect(JSON.stringify(events.delivered)).not.toContain('private platform detail');
    finish(owner);
    await running;
  });

  it('root 先退出但后代仍存活时等待 tree empty，不提前 release 或 terminal', async () => {
    const { owner, events, run } = createRun({});
    const running = run.start();
    await waitForStarted(events);
    owner.rootExit.resolve({ exitCode: 0, signal: null });
    owner.terminal.end();
    await waitFor(() => owner.stopCount === 1);
    expect(owner.releaseCount).toBe(0);
    expect(events.delivered.some(event => event.kind === 'command_runner_terminal')).toBe(false);

    owner.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;
    const completed = terminal(events).terminal;
    expect(completed.outcome).toBe('execution_ended');
    if (completed.outcome !== 'execution_ended') return;
    expect(completed.termination_cause).toBe('natural_exit');
  });

  it('tree empty 后立即 release，并允许 release 触发 terminal EOF 后再发布终态', async () => {
    const owner = createFakeOwner();
    owner.setRelease(() => owner.terminal.end());
    const { events, run } = createRun({ owner, deadlineMs: 10 });
    const running = run.start();
    await waitForStarted(events);
    owner.terminal.write('before-release');
    owner.rootExit.resolve({ exitCode: 0, signal: null });
    owner.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owner.releaseCount === 1);
    expect(events.delivered.some(event => event.kind === 'command_runner_terminal')).toBe(false);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(terminal(events)).toMatchObject({
      terminal: { output_drain: { status: 'complete' } },
      output_sources: {
        mode: 'pty',
        terminal: { source_completion: 'complete' },
      },
    });
    expect(events.delivered[events.delivered.length - 1]?.kind).toBe('command_runner_terminal');
  });

  it('backend failure 首先发生时停止整树并发布唯一 internal_failure 终态', async () => {
    const { owner, events, run } = createRun({});
    const running = run.start();
    await waitForStarted(events);
    owner.backendFailure.resolve(new Error('backend reader failed'));
    await waitFor(() => owner.stopCount === 1);
    owner.rootExit.reject(new Error('root observation lost'));
    owner.treeEmpty.resolve({ status: 'succeeded' });
    owner.terminal.destroy(new Error('terminal followed backend failure'));
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;
    expect(terminal(events).terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'internal_failure' },
      tree_cleanup: { status: 'succeeded' },
    });
  });

  it('cancel 采用首终因，整树和资源各结算一次', async () => {
    const { owner, events, run } = createRun({});
    const running = run.start();
    await waitForStarted(events);
    run.stop('user_cancelled');
    run.stop('hard_timeout');
    expect(owner.stopCount).toBe(1);
    owner.rootExit.resolve({ exitCode: null, signal: 'SIGKILL' });
    owner.treeEmpty.resolve({ status: 'succeeded' });
    owner.terminal.end();
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;
    expect(owner.releaseCount).toBe(1);
    expect(terminal(events).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'user_cancelled',
    });
  });

  it('启动后部分失败保留真实 tree cleanup 和 resource release 事实', async () => {
    const events = createRecorder();
    const launch: LaunchCommandRunnerOwnedPtyProcess = async () => {
      throw new CommandRunnerOwnedPtyProcessLaunchError(
        'process_owner_unavailable',
        'PTY startup rollback failed',
        {
          status: 'startup_cleanup_observed',
          treeCleanup: { status: 'failed', error: new Error('tree remained') },
          resourceRelease: { status: 'succeeded' },
        },
      );
    };
    const { run } = createRun({ launch, events });
    await run.start();
    expect(terminal(events).terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'process_owner_unavailable' },
      process_exit: { status: 'unavailable' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('launcher 未交付 owner 就失败时立即清除 hard timeout，不滞留 runner event loop', async () => {
    vi.useFakeTimers();
    try {
      const events = createRecorder();
      const { run } = createRun({
        events,
        launch: async () => {
          throw new CommandRunnerOwnedPtyProcessLaunchError(
            'runtime_unavailable',
            'PTY backend is unavailable',
            { status: 'guaranteed_not_started' },
          );
        },
      });
      await run.start();
      expect(vi.getTimerCount()).toBe(0);
      expect(terminal(events).terminal).toMatchObject({
        outcome: 'runtime_failure',
        failure: { code: 'runtime_unavailable' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('terminal 等待已接收 interaction 的 backend 结果和 control 发布完成', async () => {
    const interaction = deferred<void>();
    const owner = createFakeOwner();
    owner.setInteract(async () => interaction.promise);
    const { events, run } = createRun({ owner });
    const running = run.start();
    await waitForStarted(events);
    const interacting = run.interact(interactionId(0), { type: 'write', input: 'x' });
    await waitFor(() => owner.actions.length === 1);
    owner.rootExit.resolve({ exitCode: 0, signal: null });
    owner.treeEmpty.resolve({ status: 'succeeded' });
    owner.terminal.end();
    expect(events.delivered.some(event => event.kind === 'command_runner_terminal')).toBe(false);

    interaction.resolve();
    await interacting;
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;
    expect(events.delivered.map(event => event.kind).slice(-2)).toEqual([
      'command_runner_interaction_result',
      'command_runner_terminal',
    ]);
  });
});

describe('shared command runner PTY routing', () => {
  const rejectPipeLaunch: LaunchCommandRunnerOwnedPipeProcess = async () => {
    throw new Error('PTY request incorrectly reached the pipe launcher');
  };

  it('按 PTY launch 判别路由 owner，并把 interaction 交给同一 disposable run', async () => {
    const owner = createFakeOwner();
    const events: CommandRunnerEventV1[] = [];
    const exitCodes: number[] = [];
    let ptyLaunchCount = 0;
    const controller = runCommandRunnerProcess({
      async sendEvent(event) { events.push(event); },
      writeDiagnostic() {},
      finish(exitCode) { exitCodes.push(exitCode); },
    }, {
      launchOwnedPipeProcess: rejectPipeLaunch,
      async launchOwnedPtyProcess() {
        ptyLaunchCount += 1;
        return owner.process;
      },
    });

    controller.acceptRequest(START_REQUEST);
    await waitFor(() => events.some(event => event.kind === 'command_runner_started'));
    controller.acceptRequest({
      protocol_version: 1,
      kind: 'command_runner_interaction',
      identity: START_REQUEST.launch.proposal.identity,
      interaction_id: 0,
      action: { type: 'submit', input: 'answer' },
    });
    await waitFor(() => owner.actions.length === 1);
    finish(owner);
    await waitFor(() => exitCodes.length === 1);

    expect(ptyLaunchCount).toBe(1);
    expect(owner.actions).toEqual([{ type: 'submit', input: 'answer' }]);
    expect(events.some(event => event.kind === 'command_runner_interaction_result')).toBe(true);
    expect(exitCodes).toEqual([0]);
  });

  it('未注入平台 PTY backend 时返回稳定 runtime_unavailable，不回退 pipe', async () => {
    const events: CommandRunnerEventV1[] = [];
    const exitCodes: number[] = [];
    const controller = runCommandRunnerProcess({
      async sendEvent(event) { events.push(event); },
      writeDiagnostic() {},
      finish(exitCode) { exitCodes.push(exitCode); },
    }, {
      launchOwnedPipeProcess: rejectPipeLaunch,
      launchOwnedPtyProcess: rejectUnavailableCommandRunnerPtyLaunch,
    });

    controller.acceptRequest(START_REQUEST);
    await waitFor(() => exitCodes.length === 1);
    const terminalEvent = events.find(event => event.kind === 'command_runner_terminal');
    expect(terminalEvent?.kind).toBe('command_runner_terminal');
    if (!terminalEvent || terminalEvent.kind !== 'command_runner_terminal') return;
    expect(terminalEvent.terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'runtime_unavailable' },
      process_exit: { status: 'not_started' },
    });
    expect(exitCodes).toEqual([0]);
  });

  it('拒绝重复 interaction identity，并通过同一 owner 生命周期完成清理', async () => {
    const owner = createFakeOwner();
    const events: CommandRunnerEventV1[] = [];
    const diagnostics: string[] = [];
    const exitCodes: number[] = [];
    const controller = runCommandRunnerProcess({
      async sendEvent(event) { events.push(event); },
      writeDiagnostic(message) { diagnostics.push(message); },
      finish(exitCode) { exitCodes.push(exitCode); },
    }, {
      launchOwnedPipeProcess: rejectPipeLaunch,
      launchOwnedPtyProcess: async () => owner.process,
    });

    controller.acceptRequest(START_REQUEST);
    await waitFor(() => events.some(event => event.kind === 'command_runner_started'));
    const interaction = {
      protocol_version: 1,
      kind: 'command_runner_interaction',
      identity: START_REQUEST.launch.proposal.identity,
      interaction_id: 3,
      action: { type: 'eof' },
    };
    controller.acceptRequest(interaction);
    await waitFor(() => owner.actions.length === 1);
    controller.acceptRequest(interaction);
    await waitFor(() => owner.stopCount === 1);
    owner.rootExit.resolve({ exitCode: null, signal: 'SIGKILL' });
    owner.treeEmpty.resolve({ status: 'succeeded' });
    owner.terminal.end();
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await waitFor(() => exitCodes.length === 1);

    expect(diagnostics).toContain('received a non-monotonic interaction identity');
    expect(owner.actions).toHaveLength(1);
    expect(exitCodes).toEqual([1]);
  });
});
