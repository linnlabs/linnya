import {
  createHistorySummaryEvent,
  type AiMessage,
  type ContextCompactionPlan,
} from '../../../../contracts';
import type { HistorySummaryDraftResult } from '../definitions/historySummaryDraft';

export function createHistorySummaryDraft(input: {
  readonly id: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly timestamp: number;
  readonly checkpointContent: string;
  readonly plan: ContextCompactionPlan;
  readonly estimateTokens: (message: AiMessage) => number;
}): HistorySummaryDraftResult {
  const includedOldSummary = input.plan.includedOldSummary;
  const description = includedOldSummary
    ? `[历史对话摘要（更新版）- 自动压缩了 ${input.plan.originalMessageCount} 条消息]`
    : `[历史对话摘要 - 自动压缩了 ${input.plan.originalMessageCount} 条消息]`;
  const content = `${description}\n\n${input.checkpointContent}`;
  const baseMetadata = {
    messageType: 'summary' as const,
    originalMessageCount: input.plan.originalMessageCount,
    includedOldSummary,
    replacedMessageIds: [...input.plan.replacedMessageIds],
    summarySeq: input.plan.nextSummarySeq,
  };
  const messageWithoutRatio: AiMessage = {
    id: input.id,
    role: 'system',
    type: 'history_summary',
    content,
    timestamp: input.timestamp,
    metadata: baseMetadata,
  };
  const summaryTokenEstimate = input.estimateTokens(messageWithoutRatio);
  const compressionRatio = summaryTokenEstimate / input.plan.replacedTokenEstimate;
  if (!Number.isFinite(compressionRatio) || compressionRatio >= 1) {
    return { kind: 'ineffective', compressionRatio, summaryTokenEstimate };
  }

  const message: AiMessage = {
    ...messageWithoutRatio,
    metadata: { ...baseMetadata, compressionRatio },
  };
  const event = createHistorySummaryEvent(
    input.id,
    input.conversationId,
    input.turnId,
    content,
    [...input.plan.replacedMessageIds],
    input.plan.originalMessageCount,
    input.plan.nextSummarySeq,
    {
      timestamp: input.timestamp,
      compression_ratio: compressionRatio,
      included_old_summary: includedOldSummary,
    },
  );
  return { kind: 'ready', message, event, compressionRatio, summaryTokenEstimate };
}
