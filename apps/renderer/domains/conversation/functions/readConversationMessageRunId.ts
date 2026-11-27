import type { BaseMessage } from '../types';

/**
 * 消息所属运行的唯一读取规则。用户消息的运行身份可能来自提交确认（run_id）或活动绑定；
 * 其他消息都带正式 run_id；不属于任何运行的设置/本地通知返回 null。
 */
export function readConversationMessageRunId(message: BaseMessage): string | null {
  switch (message.type) {
    case 'user_input':
      return message.metadata?.run_id ?? message.metadata?.activity?.runId ?? null;
    case 'thought':
    case 'tool_calls':
    case 'final_answer':
    case 'tool_preamble':
    case 'partial_answer':
      return message.metadata.run_id;
    case 'client_notice':
    case 'command_permission_change':
    case 'execution_notice':
    case 'history_summary':
    case 'summarization_progress':
      return message.metadata.run_id;
  }
}
