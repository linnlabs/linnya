import type {
  CommandExecutionTerminalV1,
  CommandProcessHandle,
  ProcessControlRejectionCode,
  ProcessControlRequestV1,
} from '@app/schemas/commands';
import type { CommandSettledTextOutput } from '../../../definitions/commandSettledTextOutput';

export type ProcessCancellationRequestV1 = ProcessControlRequestV1 & {
  readonly action: Extract<
    ProcessControlRequestV1['action'],
    { readonly type: 'cancel' }
  >;
};

export type ProcessInteractionRequestV1 = ProcessControlRequestV1 & {
  readonly action: Extract<
    ProcessControlRequestV1['action'],
    { readonly type: 'write' | 'submit' | 'eof' | 'resize' }
  >;
};

export type CommandProcessCancellationResult =
  | {
      readonly status: 'terminal';
      readonly processHandle: CommandProcessHandle;
      readonly startedAtMs: number;
      readonly terminal: CommandExecutionTerminalV1;
      readonly settledTextOutput: CommandSettledTextOutput;
    }
  | {
      readonly status: 'rejected';
      readonly code: ProcessControlRejectionCode;
    };

export type CommandProcessInteractionResult =
  | {
      readonly status: 'accepted';
      readonly processHandle: CommandProcessHandle;
    }
  | {
      readonly status: 'rejected';
      readonly code: ProcessControlRejectionCode;
    };

export function isProcessCancellationRequest(
  request: ProcessControlRequestV1,
): request is ProcessCancellationRequestV1 {
  return request.action.type === 'cancel';
}

export function isProcessInteractionRequest(
  request: ProcessControlRequestV1,
): request is ProcessInteractionRequestV1 {
  return request.action.type === 'write'
    || request.action.type === 'submit'
    || request.action.type === 'eof'
    || request.action.type === 'resize';
}
