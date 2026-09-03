import type { AudioPreprocessingConfig } from '../../../features/transcription/audio-preprocessing/config';

export interface AudioProcessingWorkerInput {
  readonly filePath: string;
  readonly config: AudioPreprocessingConfig;
}

export interface AudioProcessingWorkerSegment {
  readonly index: number;
  readonly filePath: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
}

export type AudioProcessingWorkerOutput =
  | { readonly type: 'started' }
  | {
      readonly type: 'progress';
      readonly percent: number;
      readonly stage: string;
      readonly bytesProcessed: number;
      readonly totalBytes: number;
    }
  | { readonly type: 'segment'; readonly segment: AudioProcessingWorkerSegment }
  | {
      readonly type: 'done';
      readonly totalSegments: number;
      readonly totalDuration: number;
      readonly stats: {
        readonly segmentCount: number;
        readonly avgSegmentDuration: number;
      };
    }
  | { readonly type: 'failed'; readonly error: string };
