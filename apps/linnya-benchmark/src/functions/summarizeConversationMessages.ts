import type { ConversationControlMessagesResponse } from '@app/schemas';
import type { BenchmarkMessageSummary } from '../definitions/benchmarkRun';

export function summarizeConversationMessages(
  response: ConversationControlMessagesResponse,
): BenchmarkMessageSummary {
  if (response.status === 'preparing') return { status: 'preparing' };
  const byType: Record<string, number> = {};
  for (const message of response.messages) {
    byType[message.message_type] = (byType[message.message_type] ?? 0) + 1;
  }
  return {
    status: 'ready',
    count: response.messages.length,
    byType,
    latestMessageId: response.messages.at(-1)?.message_id,
    revision: response.revision,
  };
}
