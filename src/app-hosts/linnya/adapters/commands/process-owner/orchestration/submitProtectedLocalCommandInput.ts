import {
  acceptCommandProtectedInput,
  type CommandProtectedInputRequest,
  type CommandProtectedInputResult,
  type ProcessOwnerLifecycle,
} from '../../../../../../domains/commands';
import type { LocalCommandExecutionEntry } from '../definitions/localCommandExecutionEntry';

/**
 * 用户秘密与 Agent 输入共享同一个 PTY 和 interactionTail，但不共享 Agent tool request。
 * 这既保持原生写入顺序，也避免为保护输入创建第二个进程 owner 或旁路 stdin。
 */
export function submitProtectedLocalCommandInput(input: {
  readonly ownerLifecycle: ProcessOwnerLifecycle;
  readonly request: CommandProtectedInputRequest;
  readonly entry: LocalCommandExecutionEntry | undefined;
  readonly isCurrentEntry: (entry: LocalCommandExecutionEntry) => boolean;
}): Promise<CommandProtectedInputResult> {
  const acceptance = acceptCommandProtectedInput({
    ownerLifecycle: input.ownerLifecycle,
    requestedBinding: input.request.binding,
    activeBinding: input.entry?.binding,
    activityState: input.entry?.state,
    value: input.request.input,
  });
  if (acceptance.status === 'rejected') return Promise.resolve(acceptance);
  const entry = input.entry;
  const runtime = entry?.runtime;
  if (!entry || !runtime) {
    return Promise.resolve({ status: 'rejected', code: 'incompatible_state' });
  }
  if (runtime.interaction.kind === 'closed') {
    return Promise.resolve({ status: 'rejected', code: 'action_not_supported' });
  }
  if (entry.stdinState === 'eof_sent') {
    return Promise.resolve({ status: 'rejected', code: 'stdin_closed' });
  }

  const interaction = runtime.interaction;
  const operation = entry.interactionTail.then(async (): Promise<CommandProtectedInputResult> => {
    // 票据签发后到真正写入前，cancel、自然终态或 owner end 都可能先赢。
    if (
      entry.state !== 'running'
      || entry.runtime !== runtime
      || entry.terminal
      || !input.isCurrentEntry(entry)
    ) return { status: 'rejected', code: 'incompatible_state' };
    if (entry.stdinState === 'eof_sent') return { status: 'rejected', code: 'stdin_closed' };

    try {
      const settlement = await interaction.submit(input.request.input);
      return settlement ?? { status: 'accepted' };
    } catch {
      if (
        entry.state !== 'running'
        || entry.runtime !== runtime
        || entry.terminal
        || !input.isCurrentEntry(entry)
      ) return { status: 'rejected', code: 'incompatible_state' };
      return { status: 'rejected', code: 'interaction_failed' };
    }
  });
  entry.interactionTail = operation.then(() => undefined, () => undefined);
  return operation;
}
