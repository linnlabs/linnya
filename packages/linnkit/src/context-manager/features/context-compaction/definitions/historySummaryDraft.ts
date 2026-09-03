import type { AiMessage, HistorySummaryEvent } from '../../../../contracts';
import type { ContextCheckpointValidationFailure } from './contextCheckpointFormat';

export type HistorySummaryDraftResult =
  | {
      readonly kind: 'ready';
      readonly message: AiMessage;
      readonly event: HistorySummaryEvent;
      readonly compressionRatio: number;
      readonly summaryTokenEstimate: number;
    }
  | {
      readonly kind: 'ineffective';
      readonly compressionRatio: number;
      readonly summaryTokenEstimate: number;
    };

export type ContextCompactionDraftPreparationResult =
  | HistorySummaryDraftResult
  | {
      readonly kind: 'invalid';
      readonly reason: ContextCheckpointValidationFailure;
      readonly tokenEstimate: number;
    };
