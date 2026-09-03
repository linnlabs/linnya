import { PassThrough } from 'node:stream';

import {
  PipeCommandLaunchSnapshotV1Schema,
  parseCommandRunnerRequest,
  type CommandRunnerEventV1,
  type CommandRunnerRequestV1,
} from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import type { CommandRunnerEventTransport } from '../definitions/commandRunnerOutputTransport';
import {
  CommandRunnerOwnedPipeProcessLaunchError,
  type LaunchCommandRunnerOwnedPipeProcess,
} from '../definitions/commandRunnerOwnedPipeProcess';
import type {
  OwnedPipeProcess,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime';
import { createDisposablePipeCommandRun } from '../orchestration/createDisposablePipeCommandRun';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface FakeOwnedProcess {
  readonly process: OwnedPipeProcess;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly rootExit: Deferred<OwnedProcessRootExit>;
  readonly rootClose: Deferred<void>;
  readonly treeEmpty: Deferred<OwnedProcessTreeStopResult>;
  readonly releaseResult: Deferred<OwnedProcessResourceReleaseResult>;
  readonly stopCount: number;
  readonly releaseCount: number;
  readonly operations: readonly string[];
  onStop(operation: () => void): void;
}

interface EventRecorder {
  readonly transport: CommandRunnerEventTransport;
  readonly delivered: readonly CommandRunnerEventV1[];
  readonly attemptedControlKinds: readonly CommandRunnerEventV1['kind'][];
}

function createStartRequest(hardTimeoutMs = 60_000): Extract<
  CommandRunnerRequestV1,
  { readonly kind: 'command_runner_start' }
> {
  const request = parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_start',
    launch: PipeCommandLaunchSnapshotV1Schema.parse({
      protocol_version: 1,
      kind: 'pipe_command_launch_snapshot',
      conversation_root: process.cwd(),
      proposal: {
        protocol_version: 1,
        kind: 'shell_command_proposal',
        identity: {
          conversation_id: 'owned-lifecycle-conversation',
          agent_run_id: 'owned-lifecycle-agent-run',
          origin_tool_call_id: 'owned-lifecycle-tool-call',
          command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000101',
          owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000102',
          created_at_ms: 100,
        },
        command: 'printf owned-lifecycle',
        cwd: process.cwd(),
        permission: {
          protocol_version: 1,
          kind: 'command_permission_snapshot',
          identity: {
            conversation_id: 'owned-lifecycle-conversation',
            agent_run_id: 'owned-lifecycle-agent-run',
            origin_tool_call_id: 'owned-lifecycle-tool-call',
            command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000101',
            owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000102',
            created_at_ms: 100,
          },
          base_level: 'standard',
          effective_level: 'standard',
          grant_source: 'global_setting',
          internal_data_access: 'denied',
        },
      },
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity: {
          conversation_id: 'owned-lifecycle-conversation',
          agent_run_id: 'owned-lifecycle-agent-run',
          origin_tool_call_id: 'owned-lifecycle-tool-call',
          command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000101',
          owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000102',
          created_at_ms: 100,
        },
        base_level: 'standard',
        effective_level: 'standard',
        grant_source: 'global_setting',
        internal_data_access: 'denied',
      },
      mode: 'pipe',
      shell: {
        platform: 'macos',
        shell_semantics_id: 'zsh',
        shell_version: '5.9',
        snapshot_revision: 'owned-lifecycle-test',
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        argv_prefix: ['-f', '-c'],
      },
      environment: { revision: 'owned-lifecycle-test', entries: {} },
      stdin: 'closed',
      lifecycle_policy: 'terminate_with_run',
      hard_timeout_ms: hardTimeoutMs,
    }),
  });
  if (request.kind !== 'command_runner_start') {
    throw new Error('owned lifecycle fixture produced a stop request');
  }
  return request;
}

const START_REQUEST = createStartRequest();

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createFakeOwnedProcess(): FakeOwnedProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const rootExit = deferred<OwnedProcessRootExit>();
  const rootClose = deferred<void>();
  const treeEmpty = deferred<OwnedProcessTreeStopResult>();
  const releaseResult = deferred<OwnedProcessResourceReleaseResult>();
  const operations: string[] = [];
  let stopCount = 0;
  let releaseCount = 0;
  let stopOperation: (() => void) | undefined;

  return {
    stdout,
    stderr,
    rootExit,
    rootClose,
    treeEmpty,
    releaseResult,
    get stopCount() {
      return stopCount;
    },
    get releaseCount() {
      return releaseCount;
    },
    operations,
    onStop(operation) {
      stopOperation = operation;
    },
    process: {
      stdout,
      stderr,
      rootExit: rootExit.promise,
      rootClose: rootClose.promise,
      treeEmpty: treeEmpty.promise,
      stopAndWaitForTreeEmpty() {
        stopCount += 1;
        operations.push('stop-tree');
        stopOperation?.();
        return treeEmpty.promise;
      },
      release() {
        releaseCount += 1;
        operations.push('release');
        return releaseResult.promise;
      },
    },
  };
}

function createEventRecorder(
  input: {
    readonly failStartedWith?: Error;
  } = {}
): EventRecorder {
  const delivered: CommandRunnerEventV1[] = [];
  const attemptedControlKinds: CommandRunnerEventV1['kind'][] = [];
  return {
    delivered,
    attemptedControlKinds,
    transport: {
      offerOutput(event) {
        delivered.push(event);
        return { status: 'accepted' };
      },
      async sendControl(event) {
        attemptedControlKinds.push(event.kind);
        if (event.kind === 'command_runner_started' && input.failStartedWith) {
          throw input.failStartedWith;
        }
        delivered.push(event);
      },
    },
  };
}

function createRun(input: {
  readonly launch: LaunchCommandRunnerOwnedPipeProcess;
  readonly events?: EventRecorder;
  readonly request?: typeof START_REQUEST;
  readonly postTreeSettlementDeadlineMs?: number;
}) {
  let clock = 200;
  const events = input.events ?? createEventRecorder();
  const run = createDisposablePipeCommandRun({
    request: input.request ?? START_REQUEST,
    events: events.transport,
    launchOwnedProcess: input.launch,
    now: () => {
      clock += 1;
      return clock;
    },
    postTreeSettlementDeadlineMs: input.postTreeSettlementDeadlineMs ?? 1_000,
  });
  return { run, events };
}

function readTerminal(events: readonly CommandRunnerEventV1[]) {
  const terminal = events.find(event => event.kind === 'command_runner_terminal');
  if (!terminal || terminal.kind !== 'command_runner_terminal') {
    throw new Error('runner did not publish a terminal event');
  }
  return terminal;
}

function hasTerminal(events: readonly CommandRunnerEventV1[]): boolean {
  return events.some(event => event.kind === 'command_runner_terminal');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('condition was not observed before the integration-test deadline');
}

async function waitForStarted(events: EventRecorder): Promise<void> {
  await waitFor(() => events.delivered.some(event => event.kind === 'command_runner_started'));
}

function finishStreams(owner: FakeOwnedProcess): void {
  owner.stdout.end();
  owner.stderr.end();
}

describe('disposable pipe command owned lifecycle', () => {
  it('自然退出后等待 tree、双流和 release，且按平台事实发布完整终态', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({ launch: async () => owner.process });
    const running = run.start();
    await waitForStarted(events);

    owner.rootClose.resolve();
    owner.rootExit.resolve({ exitCode: 0, signal: null });
    await waitFor(() => owner.stopCount === 1);
    expect(owner.releaseCount).toBe(0);
    expect(hasTerminal(events.delivered)).toBe(false);

    owner.treeEmpty.resolve({ status: 'succeeded' });
    owner.stdout.write('owned-output');
    owner.stdout.end();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(owner.releaseCount).toBe(0);
    expect(hasTerminal(events.delivered)).toBe(false);

    owner.stderr.end();
    await waitFor(() => owner.releaseCount === 1);
    expect(hasTerminal(events.delivered)).toBe(false);
    expect(owner.operations).toEqual(['stop-tree', 'release']);

    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    const terminal = readTerminal(events.delivered);
    expect(terminal.terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      process_exit: { status: 'observed', exit_code: 0, signal: null },
      output_drain: { status: 'complete' },
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
    expect(
      Buffer.from(
        events.delivered
          .filter(event => event.kind === 'command_runner_output')
          .flatMap(event => [...event.bytes])
      ).toString('utf8')
    ).toBe('owned-output');
    expect(events.delivered[events.delivered.length - 1]?.kind).toBe('command_runner_terminal');
  });

  it('root 已自然退出后收树变慢，也不会被随后到期的 hard timeout 改写', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({
      launch: async () => owner.process,
      request: createStartRequest(10),
    });
    const running = run.start();
    await waitForStarted(events);

    owner.rootExit.resolve({ exitCode: 0, signal: null });
    await waitFor(() => owner.stopCount === 1);
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    owner.rootClose.resolve();
    owner.treeEmpty.resolve({ status: 'succeeded' });
    finishStreams(owner);
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('启动中取消会中止 launcher，并发布未启动终态而不创建平台 owner', async () => {
    let launchCount = 0;
    let ownerCreated = false;
    let observedAbort = false;
    const launch: LaunchCommandRunnerOwnedPipeProcess = async (_launch, options) => {
      launchCount += 1;
      const signal = options?.abortSignal;
      if (!signal) throw new Error('runner did not provide a launch abort signal');
      await new Promise<void>((_resolve, reject) => {
        const abort = (): void => {
          observedAbort = true;
          reject(new Error('launch aborted before platform owner handoff'));
        };
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
      ownerCreated = true;
      throw new Error('aborted launch unexpectedly continued');
    };
    const { run, events } = createRun({ launch });
    const running = run.start();
    await waitFor(() => launchCount === 1);

    run.stop('user_cancelled');
    await running;

    expect(observedAbort).toBe(true);
    expect(ownerCreated).toBe(false);
    expect(events.delivered.some(event => event.kind === 'command_runner_started')).toBe(false);
    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'user_cancelled',
      process_exit: { status: 'not_started' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'not_required' },
    });
  });

  it('owner 交付前回滚失败时保留真实清理事实，不伪报为无需清理', async () => {
    const { run, events } = createRun({
      launch: async () => {
        throw new CommandRunnerOwnedPipeProcessLaunchError(
          'process_owner_unavailable',
          'platform owner rollback was incomplete',
          {
            status: 'startup_cleanup_observed',
            treeCleanup: {
              status: 'failed',
              error: new Error('suspended child remained'),
            },
            resourceRelease: { status: 'succeeded' },
          },
        );
      },
    });

    await run.start();

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'process_owner_unavailable' },
      process_exit: { status: 'unavailable', reason: 'platform_not_reported' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('started 后只采用首个停止原因，并只停止和释放一次', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({ launch: async () => owner.process });
    const running = run.start();
    await waitForStarted(events);

    run.stop('user_cancelled');
    run.stop('hard_timeout');
    run.stop('owner_ended');
    expect(owner.stopCount).toBe(1);

    owner.rootExit.resolve({ exitCode: null, signal: 'SIGKILL' });
    owner.rootClose.resolve();
    owner.treeEmpty.resolve({ status: 'succeeded' });
    finishStreams(owner);
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(owner.stopCount).toBe(1);
    expect(owner.releaseCount).toBe(1);
    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'user_cancelled',
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('保留平台 tree cleanup 失败事实，同时仍排空输出并释放资源', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({ launch: async () => owner.process });
    const running = run.start();
    await waitForStarted(events);

    owner.rootExit.resolve({ exitCode: 3, signal: null });
    owner.rootClose.resolve();
    owner.treeEmpty.resolve({ status: 'failed', error: new Error('tree remained alive') });
    finishStreams(owner);
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      process_exit: { status: 'observed', exit_code: 3 },
      tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('收树失败且 root exit 永不返回时仍在有限时间内释放并发布失败终态', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({
      launch: async () => owner.process,
      postTreeSettlementDeadlineMs: 10,
    });
    const running = run.start();
    await waitForStarted(events);

    run.stop('user_cancelled');
    owner.treeEmpty.resolve({ status: 'failed', error: new Error('tree remained alive') });
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({
      status: 'failed',
      error: new Error('resources remain owned by the live tree'),
    });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'user_cancelled',
      process_exit: { status: 'unavailable', reason: 'platform_not_reported' },
      output_drain: {
        status: 'failed',
        reason: 'drain_deadline_exceeded',
      },
      tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
  });

  it('tree empty 已证明但 root exit callback 丢失时仍调用 release', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({
      launch: async () => owner.process,
      postTreeSettlementDeadlineMs: 10,
    });
    const running = run.start();
    await waitForStarted(events);

    run.stop('user_cancelled');
    owner.treeEmpty.resolve({ status: 'succeeded' });
    finishStreams(owner);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'user_cancelled',
      process_exit: { status: 'unavailable', reason: 'platform_not_reported' },
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('保留 resource release 失败事实，不把已归零的进程树伪报为失败', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({ launch: async () => owner.process });
    const running = run.start();
    await waitForStarted(events);

    owner.rootExit.resolve({ exitCode: 0, signal: null });
    owner.rootClose.resolve();
    owner.treeEmpty.resolve({ status: 'succeeded' });
    finishStreams(owner);
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({
      status: 'failed',
      error: new Error('native handle remained open'),
    });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
  });

  it('自然退出先获胜后 root close 观察失败仍调用 release，且不改写主终因', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({ launch: async () => owner.process });
    const running = run.start();
    await waitForStarted(events);

    owner.rootExit.resolve({ exitCode: 0, signal: null });
    owner.rootClose.reject(new Error('root close observer failed'));
    owner.treeEmpty.resolve({ status: 'succeeded' });
    finishStreams(owner);
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(owner.releaseCount).toBe(1);
    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('root close 永不返回时以有界 release 结果收口，不永久等待终态', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({ launch: async () => owner.process });
    const running = run.start();
    await waitForStarted(events);

    owner.rootExit.resolve({ exitCode: 0, signal: null });
    owner.treeEmpty.resolve({ status: 'succeeded' });
    finishStreams(owner);
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({
      status: 'failed',
      error: new Error('root close deadline exceeded'),
    });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
  });

  it('stream observer 失败会立即停止整树，而不是让业务进程继续到 hard timeout', async () => {
    const owner = createFakeOwnedProcess();
    const { run, events } = createRun({
      launch: async () => owner.process,
      request: createStartRequest(10),
    });
    const running = run.start();
    await waitForStarted(events);

    owner.stdout.destroy(new Error('stdout observer failed'));
    await waitFor(() => owner.stopCount === 1);
    // runtime failure 已先获胜；随后 hard timeout 到达也不能改写主终因。
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    owner.stderr.end();
    owner.rootExit.resolve({ exitCode: null, signal: 'SIGKILL' });
    owner.rootClose.reject(new Error('root close followed observer failure'));
    owner.treeEmpty.resolve({ status: 'succeeded' });
    await waitFor(() => owner.releaseCount === 1);
    owner.releaseResult.resolve({ status: 'succeeded' });
    await running;

    expect(readTerminal(events.delivered).terminal).toMatchObject({
      outcome: 'runtime_failure',
      failure: { code: 'internal_failure' },
      output_drain: {
        status: 'failed',
        code: 'output_drain_failed',
        reason: 'stream_read_failed',
      },
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
  });

  it('started 控制帧发送失败后仍先停止整树并释放资源，再让 runner 失败', async () => {
    const startedFailure = new Error('started control channel closed');
    const events = createEventRecorder({ failStartedWith: startedFailure });
    const owner = createFakeOwnedProcess();
    owner.onStop(() => {
      owner.rootClose.resolve();
      owner.treeEmpty.resolve({ status: 'succeeded' });
    });
    owner.releaseResult.resolve({ status: 'succeeded' });
    const { run } = createRun({ launch: async () => owner.process, events });

    await expect(run.start()).rejects.toBe(startedFailure);

    expect(events.attemptedControlKinds).toEqual(['command_runner_started']);
    expect(events.delivered).toEqual([]);
    expect(owner.stopCount).toBe(1);
    expect(owner.releaseCount).toBe(1);
    expect(owner.operations).toEqual(['stop-tree', 'release']);
  });
});
