import type { CommandPipeOutputChannel } from '@app/schemas/commands';
import type {
  CommandOutputCurrentLogicalLineSnapshot,
} from '../../../../../domains/commands/definitions/commandOutputProjection';
import type {
  CommandProcessOutputObservationPort,
} from '../../../../../domains/commands/definitions/processOutputObservation';

export interface PipeCommandOutputObservationLimits {
  readonly maxEvents: number;
  /** stdout/stderr 共享的 JavaScript UTF-16 单位上限。 */
  readonly maxCharacters: number;
}

export const DEFAULT_PIPE_COMMAND_OUTPUT_OBSERVATION_MAX_EVENTS = 1_024;

export interface PipeCommandOutputObservationController
  extends CommandProcessOutputObservationPort {
  accept(input: {
    readonly channel: CommandPipeOutputChannel;
    readonly stableText: string;
    readonly currentLogicalLines: Readonly<
      Record<CommandPipeOutputChannel, CommandOutputCurrentLogicalLineSnapshot>
    >;
  }): void;
  markProjectionFailed(): void;
  close(input: {
    readonly trailingStableText: Readonly<Record<CommandPipeOutputChannel, string>>;
  }): void;
}
