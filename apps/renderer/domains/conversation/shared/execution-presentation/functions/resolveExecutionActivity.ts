import type { ConversationToolMessageStatus } from '@app/schemas';
import type { InteractiveRunSnapshot } from '../../../features/interactive-run';
import type { ExecutionActivity, ExecutionActivityState } from '../definitions/executionActivity';

/** 文案与执行动画的唯一规则；busy、网络连接和未结算结果均不能替代执行态。 */
export function executionActivity(state: ExecutionActivityState): ExecutionActivity {
  return {
    state,
    isExecuting: state === 'running',
    // 内部控制态不直接泄露到界面；用户只看到暂停、进行中与 AI 输出结束。
    labelKey:
      state === 'pausing' ||
      state === 'paused' ||
      state === 'awaiting_user' ||
      state === 'cancelling'
        ? 'conversation.execution.paused'
        : state === 'inactive' ||
            state === 'completed' ||
            state === 'failed' ||
            state === 'cancelled'
          ? 'conversation.execution.finished'
          : 'conversation.execution.running',
  };
}

export function resolveRunExecutionActivity(
  run: InteractiveRunSnapshot | undefined
): ExecutionActivity {
  if (!run) return executionActivity('inactive');
  if (run.status === 'paused' && !run.pause?.settled) return executionActivity('pausing');
  return executionActivity(run.status);
}

/** 完成的工具始终保留自己的结果；父 run 完成也不能把未结算工具伪装成成功。 */
export function resolveToolExecutionActivity(
  status: ConversationToolMessageStatus,
  owner: ExecutionActivity
): ExecutionActivity {
  if (status === 'success') return executionActivity('completed');
  if (status === 'error') return executionActivity('failed');
  return owner.state === 'completed' ? executionActivity('inactive') : owner;
}
