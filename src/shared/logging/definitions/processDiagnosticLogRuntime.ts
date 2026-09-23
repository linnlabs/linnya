import type {
  DiagnosticLogEnvelope,
  DiagnosticLogRecord,
  DiagnosticLogWriter,
} from './diagnosticLogContract';

export interface ProcessDiagnosticLogConfig {
  minLevel: 0 | 1 | 2 | 3;
  enableConsole: boolean;
  enableFile: boolean;
  logFilePath?: string;
}

export interface ProcessDiagnosticLogRuntime {
  readonly config: ProcessDiagnosticLogConfig;
  readonly writeConsoleRecord: (record: DiagnosticLogRecord) => void;
  fileWriter?: DiagnosticLogWriter;
  recordForwarder?: (envelope: DiagnosticLogEnvelope) => void;
  fileLoggingClosed: boolean;
}
