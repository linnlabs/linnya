import type {
  CommandExecutionTerminalV1,
  CommandOwnerTerminationCause,
  CommandRunnerEventV1,
  CommandRunnerInternalEnvironmentV1,
  ProcessInteractionRejectionCode,
  PtyCommandLaunchSnapshotV1,
} from '@app/schemas/commands';
import type {
  CommandProcessOutputObservationPort,
  CommandRunnerProcessPort,
  PreparedCommandExecutionRuntime,
} from '../../../../../../domains/commands';
import type { PtyCommandOutputSettlement } from '../../output';

type CommandRunnerStartedEvent = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_started' }
>;
type CommandRunnerPtyOutputEvent = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_pty_output' }
>;
type CommandRunnerTerminalEvent = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_terminal' }
>;

/**
 * PTY screen、raw artifact 和 Agent 文本尚未组合前，prepared runtime 只依赖这一条
 * terminal 单流边界。实现方负责 sequence/byte 对账与最终封存，不能把 PTY 伪装成双流 pipe。
 */
export interface DisposablePtyCommandOutputSink {
  acceptStarted(event: CommandRunnerStartedEvent): boolean;
  acceptOutput(event: CommandRunnerPtyOutputEvent): boolean;
  acceptResize(size: { readonly columns: number; readonly rows: number }): void;
  settleRunnerTerminal(input: {
    readonly event: CommandRunnerTerminalEvent;
    readonly sealedAtMs: number;
  }): Promise<PtyCommandOutputSettlement>;
  settleRuntimeLoss(input: {
    readonly settledAtMs: number;
    readonly resourceRelease: 'succeeded' | 'failed';
    readonly candidate?: CommandExecutionTerminalV1;
  }): Promise<PtyCommandOutputSettlement>;
  settleBeforeSourceStart(input: {
    readonly settledAtMs: number;
    readonly failureCode: 'runtime_unavailable' | 'internal_failure';
  }): Promise<PtyCommandOutputSettlement>;
  settleBeforeSourceStartTermination(input: {
    readonly settledAtMs: number;
    readonly cause: CommandOwnerTerminationCause;
  }): Promise<PtyCommandOutputSettlement>;
}

/** prepare 可创建有界内存 observation，但 open 必须推迟到 owner claim 后的 start。 */
export interface DisposablePtyCommandPreparedOutput {
  readonly observation: CommandProcessOutputObservationPort;
  open(): Promise<DisposablePtyCommandOutputSink>;
}

export interface DisposablePtyCommandPreparedRuntimeInput {
  readonly launch: PtyCommandLaunchSnapshotV1;
  readonly runnerProcess: CommandRunnerProcessPort;
  /** 宿主短期凭证只进入 runner wire，不合并到 immutable launch 或审计。 */
  readonly internalEnvironment?: CommandRunnerInternalEnvironmentV1;
  readonly output: DisposablePtyCommandPreparedOutput;
  readonly now?: () => number;
  readonly startHandshakeDeadlineMs?: number;
  readonly closeDeadlineMs?: number;
  readonly onDiagnostic?: (bytes: Uint8Array) => void;
}

export interface DisposablePtyCommandPreparedRuntime extends PreparedCommandExecutionRuntime {
  readonly outputSettlement: Promise<PtyCommandOutputSettlement>;
}

/** runner 的稳定拒绝需要穿过 Promise 边界；平台错误文本不进入 host 公共行为。 */
export class DisposablePtyCommandInteractionError extends Error {
  readonly code: ProcessInteractionRejectionCode;

  constructor(code: ProcessInteractionRejectionCode) {
    super(`PTY command interaction rejected: ${code}`);
    this.name = 'DisposablePtyCommandInteractionError';
    this.code = code;
  }
}

export type {
  CommandRunnerPtyOutputEvent,
  CommandRunnerStartedEvent,
  CommandRunnerTerminalEvent,
};
