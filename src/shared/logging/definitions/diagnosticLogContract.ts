export type DiagnosticLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface DiagnosticLogInput {
  readonly receivedAt: Date;
  readonly level: DiagnosticLogLevel;
  readonly module: string;
  readonly message: string;
  readonly data?: unknown;
}

export interface DiagnosticLogRecord {
  readonly receivedAtIso: string;
  readonly targetDate: string;
  readonly level: DiagnosticLogLevel;
  readonly line: string;
  readonly utf8Bytes: number;
}

export interface DiagnosticLogEnvelope {
  readonly type: 'diagnostic_log';
  readonly version: 1;
  readonly record: DiagnosticLogRecord;
}

export interface DiagnosticLogProjectionLimits {
  readonly maxRecordBytes: number;
  readonly maxStringBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCollectionEntries: number;
}

export interface DiagnosticLogWriterLimits {
  readonly maxQueueEntries: number;
  readonly maxQueueBytes: number;
  readonly maxBatchEntries: number;
  readonly maxBatchBytes: number;
  readonly shutdownTimeoutMs: number;
}

export interface DiagnosticLogFileLimits {
  readonly maxFileBytes: number;
  readonly maxDirectoryBytes: number;
  readonly maxFiles: number;
}

export interface DiagnosticLogSink {
  write(records: readonly DiagnosticLogRecord[]): Promise<void>;
}

export interface DiagnosticLogDropCounts {
  readonly queue: number;
  readonly sink: number;
  readonly closed: number;
}

export interface DiagnosticLogWriterStatus {
  readonly state: 'open' | 'closing' | 'closed' | 'sink_disabled';
  readonly queuedEntries: number;
  readonly queuedBytes: number;
  readonly writtenEntries: number;
  readonly dropped: DiagnosticLogDropCounts;
  readonly sinkFailure?: unknown;
}

export interface DiagnosticLogWriteResult {
  readonly accepted: boolean;
  readonly reason?: 'queue_full' | 'closed' | 'sink_disabled';
}

export interface DiagnosticLogShutdownResult {
  readonly complete: boolean;
  readonly status: DiagnosticLogWriterStatus;
}

export interface DiagnosticLogWriter {
  write(input: DiagnosticLogInput): DiagnosticLogWriteResult;
  writeRecord(record: DiagnosticLogRecord): DiagnosticLogWriteResult;
  getStatus(): DiagnosticLogWriterStatus;
  shutdown(timeoutMs?: number): Promise<DiagnosticLogShutdownResult>;
}

export const DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS: DiagnosticLogProjectionLimits = {
  maxRecordBytes: 16 * 1024,
  maxStringBytes: 8 * 1024,
  maxDepth: 6,
  maxNodes: 256,
  maxCollectionEntries: 32,
};

export const DEFAULT_DIAGNOSTIC_LOG_WRITER_LIMITS: DiagnosticLogWriterLimits = {
  maxQueueEntries: 1024,
  maxQueueBytes: 4 * 1024 * 1024,
  maxBatchEntries: 64,
  maxBatchBytes: 256 * 1024,
  shutdownTimeoutMs: 1000,
};

export const DEFAULT_DIAGNOSTIC_LOG_FILE_LIMITS: DiagnosticLogFileLimits = {
  maxFileBytes: 8 * 1024 * 1024,
  maxDirectoryBytes: 64 * 1024 * 1024,
  maxFiles: 16,
};
