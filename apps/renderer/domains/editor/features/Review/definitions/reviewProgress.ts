export type ReviewProgressPhase =
  | 'idle'
  | 'preparing'
  | 'reviewingChunk'
  | 'completed'
  | 'failed';

export interface ReviewProgressState {
  readonly phase: ReviewProgressPhase;
  readonly agentId?: string;
  readonly chunkIndex?: number;
  readonly totalChunks?: number;
}

export const IDLE_REVIEW_PROGRESS: ReviewProgressState = {
  phase: 'idle',
};
