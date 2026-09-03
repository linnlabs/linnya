import type { CommandExecutionIdentity } from '@app/schemas/commands';

import type {
  CommandExecutionReservationRejectionCode,
} from '../definitions/commandExecutionReservation';
import type { ProcessOwnerSnapshot } from '../definitions/processOwnerState';

export type CommandExecutionReservationAcceptance =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'rejected';
      readonly code: CommandExecutionReservationRejectionCode;
    };

/**
 * reservation 是 deletion 能观察到命令的线性化点。这里必须先拒绝 owner/conversation
 * 的结束状态，再允许 host 分配 handle；不能等审批完成后才把命令放进 owner。
 */
export function acceptCommandExecutionReservation(input: {
  readonly owner: ProcessOwnerSnapshot;
  readonly identity: CommandExecutionIdentity;
  readonly conversationStopping: boolean;
  readonly executionAlreadyExists: boolean;
  readonly capacityReached: boolean;
}): CommandExecutionReservationAcceptance {
  if (input.owner.lifecycle === 'ending') {
    return { status: 'rejected', code: 'owner_ending' };
  }
  if (input.owner.lifecycle === 'ended') {
    return { status: 'rejected', code: 'owner_ended' };
  }
  if (input.identity.owner_generation_id !== input.owner.generationId) {
    return { status: 'rejected', code: 'scope_mismatch' };
  }
  if (input.conversationStopping) {
    return { status: 'rejected', code: 'conversation_stopping' };
  }
  if (input.executionAlreadyExists) {
    return { status: 'rejected', code: 'duplicate_execution' };
  }
  if (input.capacityReached) {
    return { status: 'rejected', code: 'capacity_unavailable' };
  }
  return { status: 'accepted' };
}
