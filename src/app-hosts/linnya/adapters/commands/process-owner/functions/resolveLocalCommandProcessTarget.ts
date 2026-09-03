import type {
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import type {
  CommandExecutionActivityState,
  OwnedProcessHandle,
} from '../../../../../../domains/commands';
import type { LocalCommandTerminalReplay } from './createLocalCommandTerminalReplayRegistry';

interface LocalCommandProcessTargetEntry {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly state: CommandExecutionActivityState;
  readonly handlePublished: boolean;
  readonly startSettled: boolean;
  readonly terminal?: CommandExecutionTerminalV1;
}

/**
 * 这里只把已经完成 scope 查找的本地记录投影成 action target。未公开 handle 不可见，
 * terminal replay 也不重新进入活动 registry，避免查询与取消各维护一套准入事实。
 */
export function resolveLocalCommandProcessTarget(input: {
  readonly entry: LocalCommandProcessTargetEntry | undefined;
  readonly replay: LocalCommandTerminalReplay | undefined;
  readonly expiredBinding: CommandExecutionOwnerBindingV1 | undefined;
}): OwnedProcessHandle | undefined {
  const { entry, replay, expiredBinding } = input;
  if (replay) {
    return {
      state: 'terminal',
      processHandle: replay.binding.process_handle,
      identity: replay.binding.identity,
      terminal: replay.terminal,
    };
  }
  if (expiredBinding) {
    return {
      state: 'expired',
      processHandle: expiredBinding.process_handle,
      identity: expiredBinding.identity,
    };
  }
  if (!entry?.handlePublished || (entry.state !== 'running' && entry.state !== 'stopping')) {
    return undefined;
  }
  if (entry.terminal && entry.startSettled) {
    return {
      state: 'terminal',
      processHandle: entry.binding.process_handle,
      identity: entry.binding.identity,
      terminal: entry.terminal,
    };
  }
  return {
    state: 'running',
    processHandle: entry.binding.process_handle,
    identity: entry.binding.identity,
  };
}
