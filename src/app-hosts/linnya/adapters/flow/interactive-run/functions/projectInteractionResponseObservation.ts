import type { ConversationInteractionResponseRequest } from '@app/schemas';

type InteractionResponseObservationSource = Pick<
  ConversationInteractionResponseRequest,
  'interaction_status' | 'observation' | 'tool_name'
>;

/**
 * 将已提交的 HITL 事实投影成 Agent 可直接理解的工具结果。
 *
 * 批准是控制语义，不只是一个供 UI 读取的枚举值。若把裸的
 * `{ "action": "approve" }` 原样交给模型，原始用户消息中的“等待确认”仍可能
 * 被理解为尚未满足。Host 在 committed fact 边界统一补足这层语义，避免 Renderer、
 * CLI 和具体工具分别维护容易漂移的提示文本。
 */
export function projectInteractionResponseObservation(
  response: InteractionResponseObservationSource,
): string {
  if (response.interaction_status !== 'approved') {
    // submit / modify / skip 的 observation 由交互工具 owner 组织，可能包含问卷答案、
    // 修改后的计划等领域信息；Host 不能用通用文案覆盖这些有效内容。
    return response.observation;
  }

  return [
    `用户已批准本次 ${response.tool_name} 交互。`,
    '该工具调用等待的用户确认已经完成。',
    '请按照已批准的结果继续当前任务，不要再次请求同一项确认。',
  ].join('\n');
}
