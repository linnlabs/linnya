/**
 * @file log-maintenance.ts
 *
 * 启动期日志维护：
 * - 活跃日志文件采用“按天命名”，避免单文件无限增长；
 * - 启动最早阶段先对“当前活跃日志”做大小上限收口；
 * - 启动维护阶段再清理 logs/ 目录下超期的历史日志。
 */

import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

import { getLogDirectory } from '../../../shared/utils/pathManager';
import { DEFAULT_DIAGNOSTIC_LOG_FILE_LIMITS } from '../../../shared/logging';

export const STARTUP_LOG_RETENTION_DAYS = 7;
export const STARTUP_ACTIVE_LOG_MAX_BYTES = DEFAULT_DIAGNOSTIC_LOG_FILE_LIMITS.maxFileBytes;

export interface LogMaintenanceLoggerLike {
  info(message: string): void;
  warn(message: string): void;
}

export interface StartupLogMaintenanceStats {
  scannedFiles: number;
  deletedFiles: number;
  skippedFiles: number;
  failedFiles: number;
}

export interface PrepareActiveLogFileResult {
  existed: boolean;
  truncated: boolean;
  originalBytes: number;
  keptBytes: number;
}

function sanitizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

export function buildBackendLogFileName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `backend-${year}-${month}-${day}.log`;
}

export function getBackendLogFilePath(logDirectory: string = getLogDirectory(), date: Date = new Date()): string {
  return path.join(logDirectory, buildBackendLogFileName(date));
}

/**
 * 在启用文件日志之前，对“当前活跃日志”做大小上限收口。
 *
 * 设计原因：
 * - `backend.log` 固定文件名会导致无法按天清理；
 * - 即便切到“按天命名”，同一天内反复启动也会持续追加；
 * - 因此仍需要在每次启动早期对“今天的活跃文件”做一次限长。
 */
export function prepareActiveLogFileForStartupSync(params: {
  logFilePath: string;
  maxBytes?: number;
}): PrepareActiveLogFileResult {
  const maxBytes = sanitizePositiveInteger(params.maxBytes ?? STARTUP_ACTIVE_LOG_MAX_BYTES, STARTUP_ACTIVE_LOG_MAX_BYTES);

  try {
    const stat = fs.statSync(params.logFilePath);
    if (!stat.isFile()) {
      return { existed: false, truncated: false, originalBytes: 0, keptBytes: 0 };
    }

    const originalBytes = stat.size;
    if (originalBytes <= maxBytes) {
      return { existed: true, truncated: false, originalBytes, keptBytes: originalBytes };
    }

    const fd = fs.openSync(params.logFilePath, 'r');
    try {
      const tailBytes = Math.min(originalBytes, maxBytes);
      const buffer = Buffer.allocUnsafe(tailBytes);
      fs.readSync(fd, buffer, 0, tailBytes, originalBytes - tailBytes);

      // 优先从第一个换行之后开始保留，尽量避免从半行中间截断。
      const firstNewlineIndex = buffer.indexOf(0x0a);
      const tail =
        firstNewlineIndex >= 0 && firstNewlineIndex < buffer.length - 1
          ? buffer.subarray(firstNewlineIndex + 1)
          : buffer;

      fs.writeFileSync(params.logFilePath, tail);
      return {
        existed: true,
        truncated: true,
        originalBytes,
        keptBytes: tail.length
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { existed: false, truncated: false, originalBytes: 0, keptBytes: 0 };
  }
}

export async function runStartupLogMaintenanceOnce(params: {
  logger: LogMaintenanceLoggerLike;
  logDirectory?: string;
  activeLogFileName?: string;
  retentionDays?: number;
  now?: Date;
}): Promise<StartupLogMaintenanceStats> {
  const logger = params.logger;
  const now = params.now ?? new Date();
  const retentionDays = sanitizePositiveInteger(params.retentionDays ?? STARTUP_LOG_RETENTION_DAYS, STARTUP_LOG_RETENTION_DAYS);
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const logDirectory = params.logDirectory ?? getLogDirectory();
  const activeLogFileName = params.activeLogFileName ?? buildBackendLogFileName(now);

  const stats: StartupLogMaintenanceStats = {
    scannedFiles: 0,
    deletedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0
  };

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(logDirectory, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith('.log')) {
      continue;
    }

    stats.scannedFiles += 1;

    if (entry.name === activeLogFileName) {
      stats.skippedFiles += 1;
      continue;
    }

    const filePath = path.join(logDirectory, entry.name);
    try {
      const fileStat = await fsp.stat(filePath);
      const ageMs = now.getTime() - fileStat.mtimeMs;
      if (ageMs <= retentionMs) {
        stats.skippedFiles += 1;
        continue;
      }
      await fsp.unlink(filePath);
      stats.deletedFiles += 1;
    } catch (error) {
      stats.failedFiles += 1;
      logger.warn(`启动日志清理失败: file=${entry.name}, err=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logger.info(
    `启动日志维护完成: retentionDays=${retentionDays}, scanned=${stats.scannedFiles}, deleted=${stats.deletedFiles}, skipped=${stats.skippedFiles}, failed=${stats.failedFiles}`
  );

  return stats;
}
