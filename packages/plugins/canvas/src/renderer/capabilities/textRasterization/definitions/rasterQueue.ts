import type { RasterQueueResult } from './cardRasterization';

export interface RasterJob<I, O> {
  readonly key: string;
  readonly input: I;
  readonly controller: AbortController;
  readonly resolve: (result: RasterQueueResult<O>) => void;
  superseded: boolean;
}
export type RasterQueueExecution<I, O> =
  | {
      readonly execute: (input: I, signal: AbortSignal) => Promise<O>;
      readonly executeBatch?: never;
      readonly batchSize?: never;
    }
  | {
      readonly executeBatch: (inputs: readonly I[], signal: AbortSignal) => Promise<readonly O[]>;
      readonly batchSize: number;
      readonly execute?: never;
    };

export interface RasterQueueCompletion {
  disposed: boolean;
  completed: number;
  discarded: number;
}

export type LatestRasterQueueOptions<I, O> = RasterQueueExecution<I, O> & {
  readonly disposeResult: (output: O) => void;
  readonly capacity?: number;
  readonly readBatchSize?: (inputs: readonly I[]) => number;
};
