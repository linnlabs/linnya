import type {
  CommandExecutionTerminalV1,
  CommandOwnerTerminationCause,
  CommandRunnerEventV1,
  ProcessPtySizeV1,
} from '@app/schemas/commands';
import type {
  CommandOutputArtifactFailure,
  CommandOutputArtifactFinalizationResult,
  CommandOutputArtifactDiscardResult,
  CommandOutputArtifactOwner,
  CommandOutputArtifactPort,
  CommandProcessOutputObservationPort,
} from '../../../../../../domains/commands';
import type {
  PtyCommandOutputObservationLimits,
  PtyScreenProjectionOptions,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import type { PtyCommandTextSettlement, PtyCommandTextSinkInput } from './ptyCommandTextSink';

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

export type PtyCommandOutputProtocolFailureCode =
  | 'identity_mismatch'
  | 'duplicate_start'
  | 'output_before_start'
  | 'sequence_mismatch'
  | 'terminal_before_start_mismatch'
  | 'terminal_source_mismatch';

export interface PtyCommandOutputProtocolFailure {
  readonly code: PtyCommandOutputProtocolFailureCode;
}

export type PtyCommandOutputAcceptResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'ignored'; readonly reason: 'settled' | 'protocol_failed' }
  | { readonly status: 'protocol_failure'; readonly failure: PtyCommandOutputProtocolFailure };

export type PtyCommandOutputArtifactSettlement =
  | { readonly status: 'unavailable'; readonly failure: CommandOutputArtifactFailure }
  | CommandOutputArtifactDiscardResult
  | CommandOutputArtifactFinalizationResult;

export interface PtyCommandOutputSettlement {
  readonly terminal: CommandExecutionTerminalV1;
  readonly artifact: PtyCommandOutputArtifactSettlement;
  readonly text: PtyCommandTextSettlement;
  readonly protocolFailure?: PtyCommandOutputProtocolFailure;
}

export interface PtyCommandOutputSessionInput {
  readonly owner: CommandOutputArtifactOwner;
  readonly artifactPort: CommandOutputArtifactPort;
  readonly text: PtyCommandTextSinkInput;
  readonly retentionMs?: number;
}

export interface PtyCommandPreparedOutputInput {
  readonly owner: CommandOutputArtifactOwner;
  readonly artifactPort: CommandOutputArtifactPort;
  readonly projection: PtyScreenProjectionOptions;
  readonly observationLimits: PtyCommandOutputObservationLimits;
  readonly openWriter: () => Promise<ToolOutputTextBlobWriter>;
  readonly textLimits?: PtyCommandTextSinkInput['limits'];
  readonly retentionMs?: number;
}

/** owner claim 前只持有有界内存 observation；open 后才创建 artifact writer/session。 */
export interface PtyCommandPreparedOutput {
  readonly observation: CommandProcessOutputObservationPort;
  open(): Promise<PtyCommandPreparedOutputSink>;
}

export interface PtyCommandPreparedOutputSink {
  acceptStarted(event: CommandRunnerStartedEvent): boolean;
  acceptOutput(event: CommandRunnerPtyOutputEvent): boolean;
  acceptResize(size: ProcessPtySizeV1): void;
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

export interface PtyCommandOutputSession {
  readonly owner: CommandOutputArtifactOwner;
  readonly observation: CommandProcessOutputObservationPort;
  acceptStarted(event: CommandRunnerStartedEvent): PtyCommandOutputAcceptResult;
  acceptOutput(event: CommandRunnerPtyOutputEvent): PtyCommandOutputAcceptResult;
  acceptResize(size: ProcessPtySizeV1): void;
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

export type {
  CommandRunnerPtyOutputEvent,
  CommandRunnerStartedEvent,
  CommandRunnerTerminalEvent,
};
