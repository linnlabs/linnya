import type {
  SandboxRunnerResult,
} from 'src/features/sandbox/definitions/sandboxRunner.js';
import type {
  SandboxRunnerEvaluationResult,
} from 'src/features/sandbox/runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import type {
  SandboxUtilitySettlementFailure,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport.js';
import type {
  SandboxUtilityProcessExit,
  SandboxUtilityTerminalPayload,
} from '../definitions/sandboxUtilityProcessTransport.js';

const RESOURCE_CLEANUP_FAILURES: ReadonlySet<SandboxUtilitySettlementFailure> = new Set([
  'tree_cleanup_failed',
  'tree_empty_failed',
  'resource_release_failed',
]);

export type SandboxRunnerTerminationIntent = 'cancelled' | 'owner_ended';

export interface ProjectSandboxRunnerResultInput {
  readonly runToken: string;
  readonly limits: {
    readonly timeoutMs: number;
    readonly idleTimeoutMs: number;
  };
  readonly terminal?: SandboxUtilityTerminalPayload;
  readonly utilityExit?: SandboxUtilityProcessExit;
  readonly evaluation?: SandboxRunnerEvaluationResult;
  /** 区分“尚未 fork”与“fork 后丢失全部退出事实”，后者绝不能冒充已安全取消。 */
  readonly utilityForked: boolean;
  /**
   * 只有 fork 前已经冻结首因时才使用。此时没有 Utility、terminal 或 mailbox；
   * 一旦出现跨进程事实，就必须以真实 terminal/exit 为准，不能由 intent 改写。
   */
  readonly terminationIntent?: SandboxRunnerTerminationIntent;
  /** host 后置结算失败只降低成功，不允许把底层路径或错误文本公开。 */
  readonly hostSettlementFailure?: Error;
  /**
   * host 已创建的 Utility 或运行目录没有被证明完成收口。它是执行失败之外的独立事实，
   * 不能由启动参数校验、普通 transport 错误等宽泛 failure 推导。
   */
  readonly hostCleanupIncomplete?: boolean;
}

const COMPLETE_EVALUATOR_FRAMES = ['ready', 'started', 'result_committed'] as const;

/**
 * 把 Sandbox 内部 transport 事实投影回既有公开 runner 合同。
 *
 * 这里刻意不读取 mailbox、不删除目录也不控制进程：调用方必须先严格重读结果、
 * 等待 Utility 退出并完成 host 后置结算，再把冻结事实一次性交给本函数。
 */
export function projectSandboxRunnerResult(
  input: ProjectSandboxRunnerResultInput,
): SandboxRunnerResult {
  if (!input.terminal) {
    const cleanOwnerExit = input.terminationIntent === 'owner_ended'
      && input.utilityExit?.exitCode === 0
      && !input.utilityExit.transportFailure;
    if (!input.evaluation
      && input.terminationIntent
      && ((!input.utilityForked && !input.utilityExit) || cleanOwnerExit)) {
      return input.terminationIntent === 'cancelled'
        ? buildCancellationResult(input)
        : buildOwnerEndedResult(input);
    }
    return buildTransportFailure(input);
  }

  const terminal = input.terminal;
  if (terminal.runToken !== input.runToken) {
    // 错 identity 的 terminal 不属于本次公开结果，连 PID、帧和 Evaluator stderr 也不能借用。
    return buildDetachedTransportFailure(input.utilityExit, input.hostCleanupIncomplete);
  }
  switch (terminal.cause) {
    case 'natural':
      if (input.hostSettlementFailure
        || !input.utilityExit
        || input.utilityExit.exitCode !== 0
        || input.utilityExit.transportFailure
        || terminal.settlementFailures.length > 0
        || !isCompleteNaturalTerminal(terminal)
        || !input.evaluation) {
        return buildTransportFailure(input);
      }
      return {
        ...input.evaluation,
        logs: [...input.evaluation.logs],
        capabilityCalls: [...input.evaluation.capabilityCalls],
        deniedActions: [...input.evaluation.deniedActions],
        stderr: terminal.stderrTail,
        diagnostics: buildDiagnostics(terminal),
      };
    case 'timed_out':
      return buildHardTimeoutResult(input);
    case 'idle_timed_out':
      return buildIdleTimeoutResult(input);
    case 'cancelled':
      return buildCancellationResult(input);
    case 'owner_ended':
      return buildOwnerEndedResult(input);
    case 'transport_failed':
      return buildTransportFailure(input);
  }
}

function isCompleteNaturalTerminal(terminal: SandboxUtilityTerminalPayload): boolean {
  return terminal.rootExit?.exitCode === 0
    && terminal.rootExit.signal === null
    && terminal.control.completed
    && terminal.control.acceptedFrames.length === COMPLETE_EVALUATOR_FRAMES.length
    && terminal.control.acceptedFrames.every(
      (frame, index) => frame === COMPLETE_EVALUATOR_FRAMES[index],
    );
}

function buildHardTimeoutResult(
  input: ProjectSandboxRunnerResultInput,
): SandboxRunnerResult {
  return buildFailureResult(input, {
    type: 'timeout',
    message: `Sandbox runner 超时终止（>${input.limits.timeoutMs}ms）。`,
    elapsedMs: input.limits.timeoutMs,
  });
}

function buildIdleTimeoutResult(
  input: ProjectSandboxRunnerResultInput,
): SandboxRunnerResult {
  return buildFailureResult(input, {
    type: 'timeout',
    message: `Sandbox runner 空闲超时终止（>${input.limits.idleTimeoutMs}ms 无协议活动）。`,
    elapsedMs: input.limits.idleTimeoutMs,
    idleTimeoutTriggered: true,
  });
}

function buildCancellationResult(
  input: ProjectSandboxRunnerResultInput,
): SandboxRunnerResult {
  return buildFailureResult(input, {
    type: 'transport',
    message: 'Sandbox runner 因宿主取消而终止。',
    elapsedMs: 0,
  });
}

function buildOwnerEndedResult(
  input: ProjectSandboxRunnerResultInput,
): SandboxRunnerResult {
  return buildFailureResult(input, {
    type: 'transport',
    message: 'Sandbox runner 因宿主结束而终止。',
    elapsedMs: 0,
  });
}

function buildTransportFailure(
  input: ProjectSandboxRunnerResultInput,
): SandboxRunnerResult {
  return buildFailureResult(input, {
    type: 'transport',
    message: 'Sandbox runner 运行时通信失败。',
    elapsedMs: 0,
  });
}

function buildDetachedTransportFailure(
  utilityExit: SandboxUtilityProcessExit | undefined,
  hostCleanupIncomplete = false,
): SandboxRunnerResult {
  return {
    success: false,
    logs: [],
    error: {
      type: 'transport',
      message: 'Sandbox runner 运行时通信失败。',
    },
    elapsedMs: 0,
    capabilityCalls: [],
    deniedActions: [],
    stderr: utilityExit?.stderrTail ?? '',
    diagnostics: buildEmptyDiagnostics(utilityExit, false, hostCleanupIncomplete),
  };
}

function buildFailureResult(
  input: ProjectSandboxRunnerResultInput,
  failure: {
    readonly type: 'timeout' | 'transport';
    readonly message: string;
    readonly elapsedMs: number;
    readonly idleTimeoutTriggered?: boolean;
  },
): SandboxRunnerResult {
  return {
    success: false,
    logs: [],
    error: {
      type: failure.type,
      message: failure.message,
    },
    elapsedMs: failure.elapsedMs,
    capabilityCalls: [],
    deniedActions: [],
    stderr: resolveStderrTail(input),
    diagnostics: input.terminal
      ? buildDiagnostics(
          input.terminal,
          failure.idleTimeoutTriggered,
          input.hostCleanupIncomplete,
        )
      : buildEmptyDiagnostics(
          input.utilityExit,
          failure.idleTimeoutTriggered,
          input.hostCleanupIncomplete,
        ),
  };
}

function buildDiagnostics(
  terminal: SandboxUtilityTerminalPayload,
  idleTimeoutTriggered = false,
  hostCleanupIncomplete = false,
): SandboxRunnerResult['diagnostics'] {
  const protocolEvents = terminal.control.acceptedFrames.map(frame => (
    frame === 'result_committed' ? 'result' : frame
  ));
  return {
    runnerKind: 'local-process',
    ...(terminal.control.evaluatorPid === undefined
      ? {}
      : { childPid: terminal.control.evaluatorPid }),
    startConfirmed: terminal.control.acceptedFrames.includes('started'),
    heartbeatCount: 0,
    protocolEvents,
    ...(protocolEvents.length === 0
      ? {}
      : { lastEvent: protocolEvents[protocolEvents.length - 1] }),
    stderrBytes: terminal.stderrBytes,
    idleTimeoutTriggered,
    cleanupStatus: resolveSandboxCleanupStatus({ terminal, hostCleanupIncomplete }),
  };
}

function buildEmptyDiagnostics(
  utilityExit: SandboxUtilityProcessExit | undefined,
  idleTimeoutTriggered = false,
  hostCleanupIncomplete = false,
): SandboxRunnerResult['diagnostics'] {
  return {
    runnerKind: 'local-process',
    startConfirmed: false,
    heartbeatCount: 0,
    protocolEvents: [],
    stderrBytes: utilityExit?.stderrBytes ?? 0,
    idleTimeoutTriggered,
    cleanupStatus: hostCleanupIncomplete ? 'failed' : 'succeeded',
  };
}

/**
 * 业务首因与资源收口是两条独立事实。这里只投影稳定状态，不把 Utility 的内部
 * failure 名称、路径或平台错误暴露给插件和用户代码。
 */
export function resolveSandboxCleanupStatus(input: {
  readonly terminal?: SandboxUtilityTerminalPayload;
  readonly hostCleanupIncomplete?: boolean;
}): SandboxRunnerResult['diagnostics']['cleanupStatus'] {
  if (input.hostCleanupIncomplete) return 'failed';
  return input.terminal?.settlementFailures.some(failure => (
    RESOURCE_CLEANUP_FAILURES.has(failure)
  ))
    ? 'failed'
    : 'succeeded';
}

function resolveStderrTail(input: ProjectSandboxRunnerResultInput): string {
  return input.terminal?.stderrTail ?? input.utilityExit?.stderrTail ?? '';
}
