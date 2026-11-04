import {
  ConversationControlMessagesResponseSchema,
  type ConversationUiMessage,
} from '@app/schemas';
import type { CanvasToolTraceFacts } from '../definitions/canvasToolTrace';
import { readAllowedCanvasTraceRuns } from './readAllowedCanvasTraceRuns';
export interface CanvasTraceMessage {
  readonly message: ConversationUiMessage;
  readonly sourceFile: string;
}
export function readToolTraceMessages(input: {
  readonly facts: CanvasToolTraceFacts;
  readonly audit: unknown;
  readonly continuationAudits?: readonly unknown[];
  readonly pages: readonly { readonly sourceFile: string; readonly value: unknown }[];
}) {
  const scope = input.facts.scope,
    allowed = readAllowedCanvasTraceRuns({ ...input, scope });
  if (!allowed) {
    input.facts.needsReview = true;
    input.facts.diagnostics.push({
      code: 'audit_scope_invalid',
      message: '审计不完整或不能证明本次全部模型run范围',
      sourceFile: 'audit',
    });
    return [];
  }
  const rows = new Map<string, CanvasTraceMessage>(),
    conflicts = new Set<string>();
  let hasHead = false,
    hasTail = false;
  for (const page of input.pages) {
    const parsed = ConversationControlMessagesResponseSchema.safeParse(page.value);
    if (
      !parsed.success ||
      parsed.data.status !== 'ready' ||
      parsed.data.conversation_id !== scope.conversationId
    ) {
      input.facts.needsReview = true;
      input.facts.diagnostics.push({
        code: 'messages_not_ready',
        message: '消息窗口未就绪或不属于目标会话',
        sourceFile: page.sourceFile,
      });
      continue;
    }
    hasHead ||= !parsed.data.has_more_before;
    hasTail ||= !parsed.data.has_more_after;
    for (const message of parsed.data.messages) {
      if (message.conversation_id !== scope.conversationId) {
        input.facts.needsReview = true;
        input.facts.diagnostics.push({
          code: 'message_conversation_mismatch',
          message: '窗口内消息不属于目标会话',
          sourceFile: page.sourceFile,
        });
        continue;
      }
      if (
        message.run_id === null ||
        !allowed.has(message.run_id) ||
        conflicts.has(message.message_id)
      )
        continue;
      const previous = rows.get(message.message_id);
      if (previous && JSON.stringify(previous.message) !== JSON.stringify(message)) {
        conflicts.add(message.message_id);
        rows.delete(message.message_id);
        input.facts.needsReview = true;
        input.facts.diagnostics.push({
          code: 'message_window_conflict',
          message: '分页中同一消息出现不一致版本，需重新采集终态',
          sourceFile: page.sourceFile,
        });
        continue;
      }
      rows.set(message.message_id, { message, sourceFile: page.sourceFile });
    }
  }
  if (!hasHead || !hasTail) {
    input.facts.needsReview = true;
    input.facts.diagnostics.push({
      code: 'messages_incomplete',
      message: '消息没有覆盖完整前后窗口，不能计算首写和修正',
      sourceFile: 'messages',
    });
  }
  return [...rows.values()].sort((a, b) => a.message.sort_seq - b.message.sort_seq);
}
