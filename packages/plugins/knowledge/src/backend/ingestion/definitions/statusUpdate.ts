import type { InternalStage, IngestionFrontendState } from './state';
import type { StoreResult } from '../ingestionTypes';

export interface IngestionStatusUpdateEvent {
  readonly taskId: string;
  readonly docId: string;
  readonly filename: string;
  readonly stage: InternalStage;
  readonly errorMessage?: string;
  readonly frontendState: IngestionFrontendState;
  readonly storeResult?: StoreResult;
}

export type StatusUpdatePublisher = (event: IngestionStatusUpdateEvent) => void;
