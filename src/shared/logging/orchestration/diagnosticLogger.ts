import { DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS, type DiagnosticLogEnvelope, type DiagnosticLogLevel, type DiagnosticLogRecord } from '../definitions/diagnosticLogContract';
import { createDiagnosticLogEnvelope } from '../functions/diagnosticLogEnvelope';
import { projectDiagnosticLogEntry } from '../functions/projectDiagnosticLogEntry';
import { getProcessDiagnosticLogRuntime } from './getProcessDiagnosticLogRuntime';

// Logger 只投影和路由记录；文件路径与懒 writer 由 Host 日志生命周期安装。
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const runtime = getProcessDiagnosticLogRuntime();

function levelName(level: LogLevel): DiagnosticLogLevel {
  switch (level) {
    case LogLevel.DEBUG: return 'DEBUG';
    case LogLevel.INFO: return 'INFO';
    case LogLevel.WARN: return 'WARN';
    case LogLevel.ERROR: return 'ERROR';
  }
}

export function enableDiagnosticLogForwarding(
  forwarder: (envelope: DiagnosticLogEnvelope) => void,
): void {
  if (runtime.fileWriter) throw new Error('活动日志 writer 已启动，不能切换为 worker 转发模式');
  runtime.recordForwarder = forwarder;
  runtime.config.enableFile = false;
  runtime.config.enableConsole = false;
}

function writeRecordToOutputs(record: DiagnosticLogRecord, allowForwarding: boolean): void {
  if (runtime.config.enableConsole) {
    runtime.writeConsoleRecord(record);
  }
  if (allowForwarding && runtime.recordForwarder) {
    try {
      runtime.recordForwarder(createDiagnosticLogEnvelope(record));
    } catch {
      // owner 结束后 MessagePort 可能先关闭；诊断转发失败不能改变 worker 的业务终态。
    }
    return;
  }
  if (runtime.config.enableFile) runtime.writeFileRecord?.(record);
}

export function writeForwardedDiagnosticLogRecord(record: DiagnosticLogRecord): void {
  writeRecordToOutputs(record, false);
}

export class Logger {
  constructor(private readonly module: string) {}

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (level < runtime.config.minLevel) return;
    const input = {
      receivedAt: new Date(),
      level: levelName(level),
      module: this.module,
      message,
      data,
    } as const;

    // 控制台与文件共用同一有界投影，避免开发模式反而被无界对象阻塞，也避免
    // 为同一份超大 metadata 做两次递归遍历。
    const record = projectDiagnosticLogEntry(input, DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS);
    writeRecordToOutputs(record, true);
  }
}
