import type {
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import type {
  CommandExecutionActivityState,
  CommandExecutionRuntimeControl,
  CommandExecutionRuntimeStopCause,
  CommandProcessOutputObservationPort,
  CommandSettledTextOutput,
} from '../../../../../../domains/commands';

/** 只存在于当前 Electron command owner 的活动记录；终态 replay 不复用该类型。 */
export interface LocalCommandExecutionEntry {
  readonly binding: CommandExecutionOwnerBindingV1;
  state: CommandExecutionActivityState;
  runtime?: CommandExecutionRuntimeControl;
  interactionTail: Promise<void>;
  stdinState: 'open' | 'eof_sent';
  outputObservation?: CommandProcessOutputObservationPort;
  settledTextOutput?: Promise<CommandSettledTextOutput>;
  startedAtMs?: number;
  handlePublished: boolean;
  stopCause?: CommandExecutionRuntimeStopCause;
  stopPromise?: Promise<CommandExecutionTerminalV1>;
  stopFailure?: unknown;
  terminal?: CommandExecutionTerminalV1;
  startSettled: boolean;
  settlementPublished: boolean;
  readonly settlement: Promise<CommandExecutionTerminalV1 | null>;
  readonly resolveSettlement: (terminal: CommandExecutionTerminalV1 | null) => void;
}
