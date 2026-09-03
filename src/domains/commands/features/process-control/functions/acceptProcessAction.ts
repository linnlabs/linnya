import type {
  CommandExecutionTerminalV1,
  ProcessControlActionV1,
  ProcessControlRejectionCode,
  ProcessControlRequestV1,
} from '@app/schemas/commands';

import type {
  OwnedProcessHandle,
  ProcessOwnerSnapshot,
} from '../definitions/processOwnerState';

export type ProcessActionAcceptance =
  | {
      readonly status: 'accepted';
      readonly target: Extract<OwnedProcessHandle, { state: 'running' }>;
    }
  | {
      readonly status: 'terminal_replay';
      readonly terminal: CommandExecutionTerminalV1;
    }
  | {
      readonly status: 'rejected';
      readonly code: ProcessControlRejectionCode;
    };

function isTerminalQuery(action: ProcessControlActionV1): boolean {
  return action.type === 'poll' || action.type === 'wait';
}

function belongsToRequest(
  target: OwnedProcessHandle,
  request: ProcessControlRequestV1,
): boolean {
  return target.identity.conversation_id === request.scope.conversation_id
    && target.identity.agent_run_id === request.scope.agent_run_id
    && target.identity.owner_generation_id === request.scope.owner_generation_id;
}

/**
 * 这里只判断 owner、handle 和终态归属。游标与同一 handle 的动作互斥由各自窄规则判断，
 * 避免一个函数逐渐变成同时管理输出、输入、取消和平台资源的上帝状态机。
 */
export function acceptProcessAction(params: {
  readonly owner: ProcessOwnerSnapshot;
  readonly request: ProcessControlRequestV1;
  readonly target: OwnedProcessHandle | undefined;
}): ProcessActionAcceptance {
  const { owner, request, target } = params;

  if (owner.lifecycle === 'ended') {
    return { status: 'rejected', code: 'owner_ended' };
  }
  if (request.scope.owner_generation_id !== owner.generationId) {
    return { status: 'rejected', code: 'scope_mismatch' };
  }
  if (owner.lifecycle === 'ending') {
    return { status: 'rejected', code: 'owner_ending' };
  }
  if (!target || target.processHandle !== request.process_handle) {
    return { status: 'rejected', code: 'unknown_handle' };
  }
  if (!belongsToRequest(target, request)) {
    return { status: 'rejected', code: 'scope_mismatch' };
  }
  if (target.state === 'expired') {
    return { status: 'rejected', code: 'handle_expired' };
  }
  if (target.state === 'terminal') {
    return isTerminalQuery(request.action)
      ? { status: 'terminal_replay', terminal: target.terminal }
      : { status: 'rejected', code: 'incompatible_state' };
  }

  return { status: 'accepted', target };
}
