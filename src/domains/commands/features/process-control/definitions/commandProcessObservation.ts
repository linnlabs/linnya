import type {
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
  CommandProcessHandle,
  ProcessControlRejectionCode,
  ProcessControlRequestV1,
} from '@app/schemas/commands';

import type {
  ProcessOutputObservationWindow,
} from '../../../definitions/processOutputObservation';
import type { CommandSettledTextOutput } from '../../../definitions/commandSettledTextOutput';

/** 已结束 handle 只为短期重试保留，不能随 App 长会话无界累积大文本引用。 */
export const COMMAND_TERMINAL_REPLAY_MAXIMUM_COUNT = 64;
export const COMMAND_TERMINAL_REPLAY_RETENTION_MS = 30 * 60 * 1_000;

export type CommandProcessHandlePublishResult =
  | { readonly status: 'published'; readonly binding: CommandExecutionOwnerBindingV1 }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'owner_ending'
        | 'owner_ended'
        | 'scope_mismatch'
        | 'unknown_reservation'
        | 'incompatible_state';
    };

export type CommandProcessHandleDiscardResult =
  | { readonly status: 'discarded' }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'owner_ending'
        | 'owner_ended'
        | 'scope_mismatch'
        | 'unknown_reservation'
        | 'incompatible_state';
    };

export type CommandProcessOutputQueryResult =
  | {
      readonly status: 'running';
      readonly processHandle: CommandProcessHandle;
      readonly startedAtMs: number;
      readonly observation: ProcessOutputObservationWindow;
    }
  | {
      readonly status: 'terminal';
      readonly processHandle: CommandProcessHandle;
      readonly startedAtMs: number;
      readonly observation: ProcessOutputObservationWindow;
      readonly terminal: CommandExecutionTerminalV1;
      readonly settledTextOutput: CommandSettledTextOutput;
    }
  | {
      readonly status: 'rejected';
      readonly code: ProcessControlRejectionCode;
    };

export type ProcessOutputQueryRequestV1 = ProcessControlRequestV1 & {
  readonly action: Extract<
    ProcessControlRequestV1['action'],
    { readonly type: 'poll' | 'wait' }
  >;
};

export function isProcessOutputQueryRequest(
  request: ProcessControlRequestV1,
): request is ProcessOutputQueryRequestV1 {
  return request.action.type === 'poll' || request.action.type === 'wait';
}
