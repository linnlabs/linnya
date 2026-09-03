/**
 * @file src/shared/logger.ts
 * @description 后端诊断日志的兼容入口。容量、队列和写盘规则统一委托给 logging 模块。
 */

import {
  createDiagnosticLogFileSink,
  createDiagnosticLogEnvelope,
  createDiagnosticLogWriter,
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  projectDiagnosticLogEntry,
  type DiagnosticLogLevel,
  type DiagnosticLogEnvelope,
  type DiagnosticLogRecord,
  type DiagnosticLogShutdownResult,
  type DiagnosticLogWriter,
  type DiagnosticLogWriterStatus,
} from './logging';
import { getProcessDiagnosticLogRuntime } from './logging/orchestration/getProcessDiagnosticLogRuntime';
import path from 'node:path';
import { pathManager } from './utils/pathManager';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const runtime = getProcessDiagnosticLogRuntime();
let globalLoggerInstance: Logger | null = null;

function levelName(level: LogLevel): DiagnosticLogLevel {
  switch (level) {
    case LogLevel.DEBUG: return 'DEBUG';
    case LogLevel.INFO: return 'INFO';
    case LogLevel.WARN: return 'WARN';
    case LogLevel.ERROR: return 'ERROR';
  }
}

function getOrCreateFileWriter(): DiagnosticLogWriter | undefined {
  if (!runtime.config.enableFile || runtime.fileLoggingClosed) return undefined;
  runtime.config.logFilePath ??= path.join(pathManager.getLogDirectory(), 'backend.log');
  runtime.fileWriter ??= createDiagnosticLogWriter({
    sink: createDiagnosticLogFileSink({ baseFilePath: runtime.config.logFilePath }),
    onSinkDisabled(error) {
      // 磁盘满、权限变化等持续错误只报告一次并熔断，不能形成递归日志风暴。
      console.error('[Logger] File sink disabled after write failure:', error);
    },
  });
  return runtime.fileWriter;
}

export function setGlobalLogLevel(level: LogLevel): void {
  runtime.config.minLevel = level;
}

export function enableConsoleLogging(enable: boolean): void {
  runtime.config.enableConsole = enable;
}

export function enableFileLogging(enable: boolean, logFilePath?: string): void {
  if (enable && runtime.recordForwarder) {
    throw new Error('worker 日志转发与直接文件写入不能同时启用');
  }
  if (
    runtime.fileWriter
    && logFilePath
    && logFilePath !== runtime.config.logFilePath
  ) {
    throw new Error('活动日志 writer 已启动，不能在同一生命周期切换文件路径');
  }
  runtime.config.enableFile = enable;
  if (enable) runtime.fileLoggingClosed = false;
  if (logFilePath) runtime.config.logFilePath = logFilePath;
}

export function enableDiagnosticLogForwarding(
  forwarder: (envelope: DiagnosticLogEnvelope) => void,
): void {
  if (runtime.fileWriter) throw new Error('活动日志 writer 已启动，不能切换为 worker 转发模式');
  runtime.recordForwarder = forwarder;
  runtime.config.enableFile = false;
  runtime.config.enableConsole = false;
}

export function getDiagnosticLogWriterStatus(): DiagnosticLogWriterStatus | undefined {
  return runtime.fileWriter?.getStatus();
}

export async function shutdownDiagnosticLogging(timeoutMs?: number): Promise<DiagnosticLogShutdownResult | undefined> {
  if (!runtime.fileWriter) return undefined;
  const writer = runtime.fileWriter;
  const result = await writer.shutdown(timeoutMs);
  runtime.fileLoggingClosed = true;
  if (result.complete) runtime.fileWriter = undefined;
  return result;
}

function writeRecordToOutputs(record: DiagnosticLogRecord, allowForwarding: boolean): void {
  if (runtime.config.enableConsole) {
    switch (record.level) {
      case 'DEBUG': console.debug(record.line); break;
      case 'INFO': console.info(record.line); break;
      case 'WARN': console.warn(record.line); break;
      case 'ERROR': console.error(record.line); break;
    }
  }
  if (allowForwarding && runtime.recordForwarder) {
    try {
      runtime.recordForwarder(createDiagnosticLogEnvelope(record));
    } catch {
      // owner 结束后 MessagePort 可能先关闭；诊断转发失败不能改变 worker 的业务终态。
    }
    return;
  }
  getOrCreateFileWriter()?.writeRecord(record);
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

export function getLogger(module: string = '默认'): Logger {
  if (!globalLoggerInstance) globalLoggerInstance = new Logger(module);
  return module === '默认' ? globalLoggerInstance : new Logger(module);
}

export const logger = getLogger('默认');
