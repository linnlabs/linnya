import {
  publishConversationPerf,
  readConversationPerfNowMs,
} from '../../shared/observability/conversationPerf';

export type HistoryLoadPerfDetails = Record<string, string | number | boolean | null>;

export function publishHistoryLoadPerf(
  conversationId: string,
  phase: string,
  startedAt?: number,
  details?: HistoryLoadPerfDetails,
): void {
  publishConversationPerf({
    kind: 'history-load',
    phase,
    conversationId,
    durationMs: typeof startedAt === 'number' ? readConversationPerfNowMs() - startedAt : undefined,
    details,
  });
}

export { readConversationPerfNowMs };
