import {
  parseCommandExecutionTerminal,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandOwnerTerminationCause,
  type CommandRuntimeFailureCode,
} from '@app/schemas/commands';

import type {
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime';

export type PromiseFact<T> =
  | { readonly status: 'succeeded'; readonly value: T }
  | { readonly status: 'failed'; readonly error: Error };

export type OwnedCommandOutcomeWinner =
  | {
      readonly outcome: 'execution_ended';
      readonly terminationCause: 'natural_exit' | CommandOwnerTerminationCause;
    }
  | {
      readonly outcome: 'runtime_failure';
      readonly failureCode: Extract<CommandRuntimeFailureCode, 'runtime_lost' | 'internal_failure'>;
    };

export interface OwnedCommandLifecycleProcess {
  readonly rootExit: Promise<OwnedProcessRootExit>;
  readonly treeEmpty: Promise<OwnedProcessTreeStopResult>;
  stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult>;
  release(): Promise<OwnedProcessResourceReleaseResult>;
}

export interface OwnedCommandSettlement {
  readonly rootExit: PromiseFact<OwnedProcessRootExit>;
  readonly treeCleanup: PromiseFact<OwnedProcessTreeStopResult>;
  readonly resourceRelease: PromiseFact<OwnedProcessResourceReleaseResult>;
  readonly outcome: OwnedCommandOutcomeWinner;
}

export interface OwnedCommandLifecycle {
  readonly abortSignal: AbortSignal;
  begin(): void;
  attach(process: OwnedCommandLifecycleProcess): void;
  stop(cause: CommandOwnerTerminationCause): void;
  fail(
    code?: Extract<CommandRuntimeFailureCode, 'runtime_lost' | 'internal_failure'>,
  ): void;
  allowRelease(): void;
  finishBeforeAttach(): OwnedCommandOutcomeWinner | undefined;
  treeSettlement(): Promise<PromiseFact<OwnedProcessTreeStopResult>>;
  settlement(): Promise<OwnedCommandSettlement>;
  currentOutcome(): OwnedCommandOutcomeWinner | undefined;
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

export function observeCommandPromise<T>(
  promise: Promise<T>,
  fallbackMessage: string,
): Promise<PromiseFact<T>> {
  return promise.then(
    value => ({ status: 'succeeded' as const, value }),
    error => ({ status: 'failed' as const, error: toError(error, fallbackMessage) }),
  );
}

/**
 * pipe 与 PTY 共用的只有 owner 事实：首终因、启动取消、hard timeout、整树停止、
 * root/tree/release 结算。输出排空和 PTY 输入不进入这里，避免 shared 反向知道模式。
 */
export function createOwnedCommandLifecycle(input: {
  readonly hardTimeoutMs: number;
  readonly postTreeSettlementDeadlineMs: number;
  readonly releasePolicy: 'after_tree' | 'after_explicit_barrier';
}): OwnedCommandLifecycle {
  const launchAbort = new AbortController();
  let process: OwnedCommandLifecycleProcess | undefined;
  let outcome: OwnedCommandOutcomeWinner | undefined;
  let treeStopPromise: Promise<OwnedProcessTreeStopResult> | undefined;
  let settlementPromise: Promise<OwnedCommandSettlement> | undefined;
  let treeSettlementPromise: Promise<PromiseFact<OwnedProcessTreeStopResult>> | undefined;
  let releaseAllowed = input.releasePolicy === 'after_tree';
  let resolveReleaseBarrier: () => void = () => {};
  const releaseBarrier = releaseAllowed
    ? Promise.resolve()
    : new Promise<void>((resolve) => { resolveReleaseBarrier = resolve; });
  let begun = false;
  let hardTimeoutTimer: NodeJS.Timeout | undefined;

  function begin(): void {
    if (begun) throw new Error('command lifecycle can only begin once');
    begun = true;
    if (outcome) return;
    hardTimeoutTimer = setTimeout(() => stop('hard_timeout'), input.hardTimeoutMs);
  }

  function allowRelease(): void {
    if (releaseAllowed) return;
    releaseAllowed = true;
    resolveReleaseBarrier();
  }

  function finishBeforeAttach(): OwnedCommandOutcomeWinner | undefined {
    if (process) throw new Error('attached command lifecycle cannot finish as not started');
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    hardTimeoutTimer = undefined;
    return outcome;
  }

  function stopTree(): Promise<OwnedProcessTreeStopResult> | undefined {
    if (!process) return undefined;
    treeStopPromise ??= process.stopAndWaitForTreeEmpty();
    return treeStopPromise;
  }

  function stop(cause: CommandOwnerTerminationCause): void {
    outcome ??= { outcome: 'execution_ended', terminationCause: cause };
    launchAbort.abort();
    const stopping = stopTree();
    // treeEmpty 是独立事实源，settlement 会观察同一 owner 结果；这里不能用 stop
    // Promise 的 reject 提前跳过 release，也不需要制造第二个错误投影。
    if (stopping) void stopping.catch(() => undefined);
  }

  function fail(
    code: Extract<CommandRuntimeFailureCode, 'runtime_lost' | 'internal_failure'>
      = 'internal_failure',
  ): void {
    outcome ??= { outcome: 'runtime_failure', failureCode: code };
    launchAbort.abort();
    const stopping = stopTree();
    if (stopping) void stopping.catch(() => undefined);
  }

  function attach(attached: OwnedCommandLifecycleProcess): void {
    if (process) throw new Error('command lifecycle process can only be attached once');
    process = attached;
    const rootExit = observeCommandPromise(
      attached.rootExit,
      'command root exit observation failed',
    );
    void rootExit.then((fact) => {
      if (fact.status === 'succeeded') {
        outcome ??= { outcome: 'execution_ended', terminationCause: 'natural_exit' };
        if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      } else {
        fail();
      }
      const stopping = stopTree();
      if (stopping) void stopping.catch(() => undefined);
    });
    if (outcome?.outcome === 'execution_ended' && outcome.terminationCause !== 'natural_exit') {
      stop(outcome.terminationCause);
    } else if (outcome?.outcome === 'runtime_failure') {
      fail(outcome.failureCode);
    }
  }

  function treeSettlement(): Promise<PromiseFact<OwnedProcessTreeStopResult>> {
    if (treeSettlementPromise) return treeSettlementPromise;
    if (!process) throw new Error('command lifecycle cannot observe tree before process attachment');
    treeSettlementPromise = observeCommandPromise(
      process.treeEmpty,
      'command process tree observation failed',
    );
    return treeSettlementPromise;
  }

  function settlement(): Promise<OwnedCommandSettlement> {
    if (settlementPromise) return settlementPromise;
    const attached = process;
    if (!attached) throw new Error('command lifecycle cannot settle before process attachment');
    const rootExitFact = observeCommandPromise(
      attached.rootExit,
      'command root exit observation failed',
    );
    const treeEmptyFact = treeSettlement();
    settlementPromise = treeEmptyFact.then(async (treeCleanup) => {
      // Windows ClosePseudoConsole 可能由 release 触发 terminal EOF。tree 一结算就必须
      // 立即开始 release，不能先等 output drain，否则会形成 release↔EOF 循环等待。
      let rootExitDeadlineTimer: NodeJS.Timeout | undefined;
      const boundedRootExit = Promise.race([
        rootExitFact,
        new Promise<PromiseFact<OwnedProcessRootExit>>((resolve) => {
          rootExitDeadlineTimer = setTimeout(() => resolve({
            status: 'failed',
            error: new Error('command root exit did not settle after tree cleanup'),
          }), input.postTreeSettlementDeadlineMs);
        }),
      ]);
      const rootExitPromise = boundedRootExit;
      // explicit barrier 由 shared 自己创建且只能 resolve，输出层只能“放行”，不能用
      // rejected Promise 阻断 release 或让第一次 settlement 调用偷偷冻结不同策略。
      await releaseBarrier;
      const releaseFact = observeCommandPromise(
        attached.release(),
        'command process resource release failed',
      );
      const [rootExit, resourceRelease] = await Promise.all([
        rootExitPromise,
        releaseFact,
      ]);
      if (rootExitDeadlineTimer) clearTimeout(rootExitDeadlineTimer);
      if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      hardTimeoutTimer = undefined;
      return {
        rootExit,
        treeCleanup,
        resourceRelease,
        outcome: outcome ?? {
          outcome: 'runtime_failure',
          failureCode: 'internal_failure',
        },
      };
    });
    return settlementPromise;
  }

  return Object.freeze({
    abortSignal: launchAbort.signal,
    begin,
    attach,
    stop,
    fail,
    allowRelease,
    finishBeforeAttach,
    treeSettlement,
    settlement,
    currentOutcome: () => outcome,
  });
}

export function createNotStartedCommandTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly settledAtMs: number;
  readonly stopCause?: CommandOwnerTerminationCause;
  readonly failureCode: CommandRuntimeFailureCode;
  readonly cleanup?: {
    readonly treeCleanup: OwnedProcessTreeStopResult;
    readonly resourceRelease: OwnedProcessResourceReleaseResult;
  };
}): CommandExecutionTerminalV1 {
  const cleanup = input.cleanup;
  const base = {
    protocol_version: 1 as const,
    kind: 'command_execution_terminal' as const,
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    process_exit: cleanup
      ? { status: 'unavailable' as const, reason: 'platform_not_reported' as const }
      : { status: 'not_started' as const },
    output_drain: { status: 'not_started' as const },
    tree_cleanup: cleanup
      ? cleanup.treeCleanup.status === 'succeeded'
        ? { status: 'succeeded' as const }
        : { status: 'failed' as const, code: 'tree_cleanup_failed' as const }
      : { status: 'not_required' as const },
    resource_release: cleanup
      ? cleanup.resourceRelease.status === 'succeeded'
        ? { status: 'succeeded' as const }
        : { status: 'failed' as const, code: 'resource_release_failed' as const }
      : { status: 'not_required' as const },
  };
  return input.stopCause
    ? parseCommandExecutionTerminal({
        ...base,
        outcome: 'execution_ended',
        termination_cause: input.stopCause,
      })
    : parseCommandExecutionTerminal({
        ...base,
        outcome: 'runtime_failure',
        failure: { code: input.failureCode },
      });
}
