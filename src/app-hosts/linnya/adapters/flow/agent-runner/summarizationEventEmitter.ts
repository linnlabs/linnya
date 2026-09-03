import { generateRuntimeEventId } from '@linnlabs/linnkit/contracts';
import type { RunId, SSEEvent, SummarizationCallbacks } from '@linnlabs/linnkit/contracts';
import { Logger } from 'src/shared/logger';
import type { SSESink } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';

const logger = new Logger('SummarizationEventEmitter');

export interface SummarizationRealtimePort {
  /** presentation transport 失败不得改写 Agent 的 durable 执行语义。 */
  emit(event: SSEEvent): void;
}

export interface SummarizationEventEmitterOptions {
  conversationId: string;
  turnId: string;
  runId: RunId;
  executionId: string;
  realtimePort: SummarizationRealtimePort;
}

export function createSseSummarizationRealtimePort(sink: SSESink): SummarizationRealtimePort {
  return {
    emit(event: SSEEvent) {
      try {
        sink(event);
      } catch (error) {
        logger.error('Summarization realtime presentation delivery failed', {
          eventType: event.type,
          conversationId: event.conversation_id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function createSummarizationCallbacks(
  options: SummarizationEventEmitterOptions
): SummarizationCallbacks {
  let activeSummarizationId: string | null = null;

  const readActiveSummarizationId = (eventType: 'end' | 'error'): string | undefined => {
    if (!activeSummarizationId) {
      logger.error('Summarization presentation state is missing an active start', {
        eventType,
        conversationId: options.conversationId,
        runId: options.runId,
        executionId: options.executionId,
      });
      return undefined;
    }
    return activeSummarizationId;
  };

  return {
    onSummarizationStart: () => {
      if (activeSummarizationId) {
        logger.error('Summarization presentation received a duplicate start', {
          conversationId: options.conversationId,
          runId: options.runId,
          executionId: options.executionId,
          summarizationId: activeSummarizationId,
        });
        return;
      }
      activeSummarizationId = generateRuntimeEventId();
      options.realtimePort.emit({
        type: 'summarization_start',
        id: activeSummarizationId,
        summarization_id: activeSummarizationId,
        timestamp: Date.now(),
        conversation_id: options.conversationId,
        turn_id: options.turnId,
        run_id: options.runId,
        execution_id: options.executionId,
      });
    },
    onSummarizationEnd: summaryInfo => {
      const summarizationId = readActiveSummarizationId('end');
      if (!summarizationId) return;
      const summaryEvent = summaryInfo.summaryEvent;
      activeSummarizationId = null;
      options.realtimePort.emit({
        type: 'summarization_end',
        id: generateRuntimeEventId(),
        summarization_id: summarizationId,
        timestamp: Date.now(),
        conversation_id: options.conversationId,
        turn_id: options.turnId,
        run_id: options.runId,
        execution_id: options.executionId,
        summary_id: summaryEvent.id,
        original_message_count: summaryInfo.originalMessageCount,
        compressed_message_count: 1,
        ...(summaryEvent.compression_ratio === undefined
          ? {}
          : { compression_ratio: summaryEvent.compression_ratio }),
      });

    },
    onSummarizationError: (error: Error) => {
      logger.error('Summarization failed', { errorMessage: error.message });
      const summarizationId = readActiveSummarizationId('error');
      if (!summarizationId) return;
      activeSummarizationId = null;

      options.realtimePort.emit({
        type: 'summarization_error',
        id: generateRuntimeEventId(),
        summarization_id: summarizationId,
        timestamp: Date.now(),
        conversation_id: options.conversationId,
        turn_id: options.turnId,
        run_id: options.runId,
        execution_id: options.executionId,
        error: error.message,
      });
    },
  };
}
