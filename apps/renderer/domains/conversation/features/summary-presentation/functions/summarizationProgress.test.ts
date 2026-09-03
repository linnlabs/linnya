import { describe, expect, it } from 'vitest';
import {
  buildSummaryContent,
  completeSummarizationProgressMessage,
  createSummarizationProgressMessage,
} from './summarizationProgress';

const CJK_TEXT_PATTERN = /[\u4e00-\u9fff]/;

describe('summarization progress presentation', () => {
  it('keeps presentation fallback content language-neutral', () => {
    expect(buildSummaryContent('summarizing')).toBe('Summarizing conversation history...');
    expect(buildSummaryContent('completed')).toBe('Conversation history summarized');
    expect(buildSummaryContent('error')).toBe('Conversation history summary failed');

    for (const status of ['summarizing', 'completed', 'error'] as const) {
      expect(buildSummaryContent(status)).not.toMatch(CJK_TEXT_PATTERN);
    }
  });

  it('uses the realtime start event as presentation identity and updates metadata', () => {
    const message = createSummarizationProgressMessage({
      eventId: 'summary-start-1',
      timestamp: 10,
      turnId: 'turn-1',
      runId: 'run-1',
      executionId: 'execution-1',
      info: { originalMessageCount: 8 },
    });
    const updated = completeSummarizationProgressMessage(message, 'history-summary-1', {
      originalMessageCount: 8,
      compressedMessageCount: 1,
    });

    expect(message.id).toBe('summarization_progress:summary-start-1');
    expect(message.type).toBe('summarization_progress');
    expect(updated.metadata.summary.status).toBe('completed');
    expect(updated.content).toBe('Conversation history summarized');
    expect(updated.metadata.summary.info.compressedMessageCount).toBe(1);
    expect(updated.metadata.summary).toMatchObject({
      status: 'completed',
      historySummaryId: 'history-summary-1',
    });
  });
});
