import {
  acceptProcessAction,
  type CommandExecutionInteractionSettlement,
  type CommandProcessInteractionResult,
  type OwnedProcessHandle,
  type ProcessInteractionRequestV1,
  type ProcessOwnerSnapshot,
} from '../../../../../../domains/commands';
import type { LocalCommandExecutionEntry } from '../definitions/localCommandExecutionEntry';

/**
 * 只编排一个已完成 scope 查找的活动 handle。entry 的创建、终态和清理由总 owner 持有；
 * 本函数只拥有 write/submit/EOF/resize 的串行顺序，避免输入状态机膨胀总生命周期编排。
 */
export async function controlLocalCommandProcessInteraction(input: {
  readonly owner: ProcessOwnerSnapshot;
  readonly request: ProcessInteractionRequestV1;
  readonly entry: LocalCommandExecutionEntry | undefined;
  readonly target: OwnedProcessHandle | undefined;
  readonly isCurrentEntry: (entry: LocalCommandExecutionEntry) => boolean;
}): Promise<CommandProcessInteractionResult> {
  const acceptance = acceptProcessAction({
    owner: input.owner,
    request: input.request,
    target: input.target,
  });
  if (acceptance.status === 'rejected') return acceptance;
  if (acceptance.status === 'terminal_replay' || !input.entry) {
    return { status: 'rejected', code: 'incompatible_state' };
  }

  const entry = input.entry;
  const runtime = entry.runtime;
  if (!runtime) return { status: 'rejected', code: 'incompatible_state' };
  if (runtime.interaction.kind === 'closed') {
    return {
      status: 'rejected',
      code: input.request.action.type === 'resize' ? 'action_not_supported' : 'stdin_closed',
    };
  }

  const interaction = runtime.interaction;
  const operation = entry.interactionTail.then(async (): Promise<CommandProcessInteractionResult> => {
    // 排队期间 cancel、自然终态或 owner 结束都可能先赢。执行前必须复核同一 runtime
    // 仍由该活动 entry 持有，不能让迟到动作触碰已经释放或被替换的原生 PTY。
    if (
      entry.state !== 'running'
      || entry.runtime !== runtime
      || entry.terminal
      || !input.isCurrentEntry(entry)
    ) {
      return { status: 'rejected', code: 'incompatible_state' };
    }
    if (input.request.action.type !== 'resize' && entry.stdinState === 'eof_sent') {
      return { status: 'rejected', code: 'stdin_closed' };
    }

    try {
      let settlement: CommandExecutionInteractionSettlement;
      switch (input.request.action.type) {
        case 'write':
          settlement = await interaction.write(input.request.action.input);
          break;
        case 'submit':
          settlement = await interaction.submit(input.request.action.input);
          break;
        case 'eof':
          settlement = await interaction.eof();
          if (!settlement) entry.stdinState = 'eof_sent';
          break;
        case 'resize':
          settlement = await interaction.resize({
            columns: input.request.action.columns,
            rows: input.request.action.rows,
          });
          break;
      }
      if (settlement) return settlement;
      return { status: 'accepted', processHandle: input.request.process_handle };
    } catch {
      // 原生 Broken Pipe/无效句柄文案不属于公共合同。若生命周期已经变化，返回真实
      // owner 状态；仍在同一活跃 PTY 时才报告稳定的交互失败。
      if (
        entry.state !== 'running'
        || entry.runtime !== runtime
        || entry.terminal
        || !input.isCurrentEntry(entry)
      ) {
        return { status: 'rejected', code: 'incompatible_state' };
      }
      return { status: 'rejected', code: 'interaction_failed' };
    }
  });
  // 只有输入和 resize 共用该串行门。cancel 直接走 stop Promise，poll/wait 直接走
  // observation，因此慢输入不能阻止整树取消或非消费式读取。
  entry.interactionTail = operation.then(() => undefined, () => undefined);
  return operation;
}
