/**
 * @file src/shared/logger.ts
 * @description 后端诊断日志的兼容入口。容量、队列和写盘规则统一委托给 logging 模块。
 */

import {
  createDiagnosticLogFileSink,
  createDiagnosticLogWriter,
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  projectDiagnosticLogEntry,
  type DiagnosticLogShutdownResult,
  type DiagnosticLogWriter,
  type DiagnosticLogWriterStatus,
} from './logging';
import { getProcessDiagnosticLogRuntime } from './logging/orchestration/getProcessDiagnosticLogRuntime';
import { Logger, LogLevel } from './logging/orchestration/diagnosticLogger';
export { Logger, LogLevel, enableDiagnosticLogForwarding, writeForwardedDiagnosticLogRecord } from './logging/orchestration/diagnosticLogger';
import path from 'node:path';
import { pathManager } from './utils/pathManager';

const runtime = getProcessDiagnosticLogRuntime();
let globalLoggerInstance: Logger | null = null;

function getOrCreateFileWriter(): DiagnosticLogWriter | undefined {
  if (!runtime.config.enableFile || runtime.fileLoggingClosed) return undefined;
  runtime.config.logFilePath ??= path.join(pathManager.getLogDirectory(), 'backend.log');
  runtime.fileWriter ??= createDiagnosticLogWriter({
    sink: createDiagnosticLogFileSink({ baseFilePath: runtime.config.logFilePath }),
    onSinkDisabled(error) {
      // 磁盘满、权限变化等持续错误只报告一次并熔断，不能形成递归日志风暴。
      runtime.writeConsoleRecord(projectDiagnosticLogEntry({
        receivedAt: new Date(),
        level: 'ERROR',
        module: 'Logger',
        message: 'File sink disabled after write failure',
        data: error,
      }, DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS));
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
  // 不在 import/配置阶段打开文件，第一条启用的记录才创建唯一 writer。
  if (enable) runtime.writeFileRecord = record => { getOrCreateFileWriter()?.writeRecord(record); };
  if (enable) runtime.fileLoggingClosed = false;
  if (logFilePath) runtime.config.logFilePath = logFilePath;
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

export function getLogger(module: string = '默认'): Logger {
  if (!globalLoggerInstance) globalLoggerInstance = new Logger(module);
  return module === '默认' ? globalLoggerInstance : new Logger(module);
}

export const logger = getLogger('默认');
