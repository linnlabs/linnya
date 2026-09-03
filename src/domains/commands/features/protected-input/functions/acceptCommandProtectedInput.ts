import {
  MAX_PROCESS_INTERACTION_INPUT_BYTES,
  type CommandExecutionOwnerBindingV1,
} from '@app/schemas/commands';

import type { CommandExecutionActivityState } from '../../process-control/definitions/commandExecutionReservation';
import { hasSameCommandExecutionOwnerBinding } from '../../process-control/functions/hasSameCommandExecutionOwnerBinding';
import type {
  CommandProtectedInputRejectionCode,
} from '../definitions/commandProtectedInput';

const UTF8_ENCODER = new TextEncoder();

export type CommandProtectedInputAcceptance =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'rejected';
      readonly code: CommandProtectedInputRejectionCode;
    };

/**
 * 保护输入只认 Electron host 已经持有的完整 binding，不接受 renderer 或模型重建 scope。
 * 这里保持纯判断，owner adapter 只负责在通过后排入现有 PTY 输入串行门。
 */
export function acceptCommandProtectedInput(input: {
  readonly ownerLifecycle: 'active' | 'ending' | 'ended';
  readonly requestedBinding: CommandExecutionOwnerBindingV1;
  readonly activeBinding: CommandExecutionOwnerBindingV1 | undefined;
  readonly activityState: CommandExecutionActivityState | undefined;
  readonly value: string;
}): CommandProtectedInputAcceptance {
  if (input.ownerLifecycle === 'ended') return { status: 'rejected', code: 'owner_ended' };
  if (input.ownerLifecycle === 'ending') return { status: 'rejected', code: 'owner_ending' };
  if (
    !input.activeBinding
    || !hasSameCommandExecutionOwnerBinding(input.activeBinding, input.requestedBinding)
    || input.activityState !== 'running'
  ) return { status: 'rejected', code: 'incompatible_state' };
  if (input.activeBinding.mode !== 'pty') {
    return { status: 'rejected', code: 'action_not_supported' };
  }
  if (UTF8_ENCODER.encode(input.value).byteLength > MAX_PROCESS_INTERACTION_INPUT_BYTES) {
    return { status: 'rejected', code: 'input_budget_exceeded' };
  }
  return { status: 'accepted' };
}
