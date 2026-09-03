import type { AiMessage } from '../../../../contracts';
import type {
  ContextCompactionRebuildValidationResult,
  ValidateContextCompactionRebuildInput,
} from '../definitions/contextCompactionRebuild';

/**
 * 验证 pending summary 重建确实释放了计划中的历史，且没有留下孤立工具输出。
 *
 * 中文备注：删除仍由 HistoryPurification 完成；这里是提交前的事实校验，不实现第二套
 * 删除逻辑。若校验失败，Graph 必须放弃 pending summary。
 */
export function validateContextCompactionRebuild(
  input: ValidateContextCompactionRebuildInput,
): ContextCompactionRebuildValidationResult {
  const replacedIds = new Set(input.plan.replacedMessageIds);
  for (const message of input.messages) {
    if (message.id === input.pendingSummaryId) continue;
    if (
      replacedIds.has(message.id)
      || readStringArray(message.metadata, 'replacementSourceIds')
        .some(sourceId => replacedIds.has(sourceId))
    ) {
      return {
        valid: false,
        reason: 'replacement_survived',
        messageId: message.id,
      };
    }
  }

  const knownToolCallIds = new Set(
    input.messages.flatMap(message => readToolCallIds(message)),
  );
  for (const message of input.messages) {
    if (message.role !== 'tool') continue;
    const toolCallId = message.metadata?.tool_call_id;
    if (typeof toolCallId === 'string' && !knownToolCallIds.has(toolCallId)) {
      return {
        valid: false,
        reason: 'orphan_tool_output',
        messageId: message.id,
      };
    }
  }

  return { valid: true };
}

function readToolCallIds(message: AiMessage): string[] {
  if (message.role !== 'assistant' || message.type !== 'tool_calls') return [];
  const toolCalls = message.metadata?.tool_calls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.flatMap(toolCall => {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) return [];
    const id = Reflect.get(toolCall, 'id');
    return typeof id === 'string' ? [id] : [];
  });
}

function readStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const candidate = Reflect.get(value, key);
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === 'string')
    : [];
}
