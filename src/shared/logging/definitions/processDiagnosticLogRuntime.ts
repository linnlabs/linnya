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
  /** 仅 Host 文件日志 owner 安装；Worker 没有文件路径或 writer 构造能力。 */
  writeFileRecord?: (record: DiagnosticLogRecord) => void;
  recordForwarder?: (envelope: DiagnosticLogEnvelope) => void;
  fileLoggingClosed: boolean;
}
