import type {
  DiagnosticLogEnvelope,
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
  fileWriter?: DiagnosticLogWriter;
  recordForwarder?: (envelope: DiagnosticLogEnvelope) => void;
  fileLoggingClosed: boolean;
}
