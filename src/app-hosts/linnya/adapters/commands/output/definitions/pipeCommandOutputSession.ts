import type {
  CommandExecutionTerminalV1,
  CommandOwnerTerminationCause,
  CommandPipeOutputChannel,
  CommandRunnerEventV1,
} from '@app/schemas/commands';
import type {
  CommandOutputArtifactDiscardResult,
  CommandOutputArtifactFailure,
  CommandOutputArtifactFinalizationResult,
  CommandOutputArtifactOwner,
  CommandOutputArtifactPort,
  CommandProcessOutputObservationPort,
} from '../../../../../../domains/commands';
import type {
  PipeCommandTextSettlement,
  PipeCommandTextSinkInput,
} from './pipeCommandTextSink';

type CommandRunnerStartedEventV1 = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_started' }
>;

type CommandRunnerOutputEventV1 = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_output' }
>;

type CommandRunnerTerminalEventV1 = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_terminal' }
>;

export const COMMAND_OUTPUT_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export type PipeCommandOutputProtocolFailureCode =
  | 'identity_mismatch'
  | 'duplicate_start'
  | 'output_before_start'
  | 'sequence_mismatch'
  | 'terminal_before_start_mismatch'
  | 'terminal_source_mismatch';

export interface PipeCommandOutputProtocolFailure {
  readonly code: PipeCommandOutputProtocolFailureCode;
  readonly channel?: CommandPipeOutputChannel;
}

export type PipeCommandOutputAcceptResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'ignored'; readonly reason: 'settled' | 'protocol_failed' }
  | {
      readonly status: 'protocol_failure';
      readonly failure: PipeCommandOutputProtocolFailure;
    };

export type PipeCommandOutputArtifactSettlement =
  | {
      readonly status: 'unavailable';
      readonly failure: CommandOutputArtifactFailure;
    }
  | CommandOutputArtifactDiscardResult
  | CommandOutputArtifactFinalizationResult;

export interface PipeCommandOutputSettlement {
  readonly terminal: CommandExecutionTerminalV1;
  readonly artifact: PipeCommandOutputArtifactSettlement;
  readonly text: PipeCommandTextSettlement;
  readonly protocolFailure?: PipeCommandOutputProtocolFailure;
}

export interface PipeCommandOutputSessionInput {
  readonly owner: CommandOutputArtifactOwner;
  readonly artifactPort: CommandOutputArtifactPort;
  readonly text: PipeCommandTextSinkInput;
  readonly retentionMs?: number;
}

export interface PipeCommandOutputSession {
  readonly owner: CommandOutputArtifactOwner;
  readonly observation: CommandProcessOutputObservationPort;
  acceptStarted(event: CommandRunnerStartedEventV1): PipeCommandOutputAcceptResult;
  acceptOutput(event: CommandRunnerOutputEventV1): PipeCommandOutputAcceptResult;
  settleRunnerTerminal(input: {
    readonly event: CommandRunnerTerminalEventV1;
    /** host 真正开始封存的时间；runner terminal 时间只描述业务进程。 */
    readonly sealedAtMs: number;
  }): Promise<PipeCommandOutputSettlement>;
  /** runner 已经可能收到 start request，host 不能再声称业务来源从未启动。 */
  settleRuntimeLoss(input: {
    readonly settledAtMs: number;
    readonly resourceRelease: 'succeeded' | 'failed';
  }): Promise<PipeCommandOutputSettlement>;
  /** 只用于 fork/启动 request 发送前的确定失败。 */
  settleBeforeSourceStart(input: {
    readonly settledAtMs: number;
    readonly failureCode: 'runtime_unavailable' | 'internal_failure';
  }): Promise<PipeCommandOutputSettlement>;
  /** owner 在 fork 前已经要求停止，业务 child 确定不存在。 */
  settleBeforeSourceStartTermination(input: {
    readonly settledAtMs: number;
    readonly cause: CommandOwnerTerminationCause;
  }): Promise<PipeCommandOutputSettlement>;
}

export type {
  CommandRunnerOutputEventV1,
  CommandRunnerStartedEventV1,
  CommandRunnerTerminalEventV1,
};
