import type { CommandExecutionOwnerBindingV1 } from '@app/schemas/commands';

import type {
  CommandExecutionActivityState,
  CommandExecutionStartRejectionCode,
} from '../definitions/commandExecutionReservation';
import type { ProcessOwnerSnapshot } from '../definitions/processOwnerState';
import { hasSameCommandExecutionOwnerBinding } from './hasSameCommandExecutionOwnerBinding';

export type CommandExecutionStartAcceptance =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'rejected';
      readonly code: CommandExecutionStartRejectionCode;
    };

/**
 * start claim 只能消费当前 owner 中仍为 reserved 的精确 binding。审批等待期间删除若先
 * 设置 conversation stopping，迟到的“允许”会在任何启动 callback 执行前被拒绝。
 */
export function acceptCommandExecutionStart(input: {
  readonly owner: ProcessOwnerSnapshot;
  readonly requestedBinding: CommandExecutionOwnerBindingV1;
  readonly reservedBinding: CommandExecutionOwnerBindingV1 | undefined;
  readonly reservationState: CommandExecutionActivityState | undefined;
  readonly conversationStopping: boolean;
}): CommandExecutionStartAcceptance {
  if (input.owner.lifecycle === 'ending') {
    return { status: 'rejected', code: 'owner_ending' };
  }
  if (input.owner.lifecycle === 'ended') {
    return { status: 'rejected', code: 'owner_ended' };
  }
  if (input.requestedBinding.identity.owner_generation_id !== input.owner.generationId) {
    return { status: 'rejected', code: 'scope_mismatch' };
  }
  if (input.conversationStopping) {
    return { status: 'rejected', code: 'conversation_stopping' };
  }
  if (!input.reservedBinding || !input.reservationState) {
    return { status: 'rejected', code: 'unknown_reservation' };
  }
  if (!hasSameCommandExecutionOwnerBinding(
    input.reservedBinding,
    input.requestedBinding,
  )) {
    return { status: 'rejected', code: 'scope_mismatch' };
  }
  if (input.reservationState !== 'reserved') {
    return { status: 'rejected', code: 'incompatible_state' };
  }
  return { status: 'accepted' };
}
