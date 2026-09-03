export interface TranscriptionProgressEvent {
  readonly stage: string;
  readonly percent: number;
  readonly message: string;
  readonly timestamp: number;
}

export type TranscriptionProgressPublisher = (event: TranscriptionProgressEvent) => void;
