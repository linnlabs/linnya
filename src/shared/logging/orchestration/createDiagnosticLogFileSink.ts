import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_DIAGNOSTIC_LOG_FILE_LIMITS,
  type DiagnosticLogFileLimits,
  type DiagnosticLogRecord,
  type DiagnosticLogSink,
} from '../definitions/diagnosticLogContract';

const DATE_IN_FILE_NAME = /\d{4}-\d{2}-\d{2}/u;

export interface CreateDiagnosticLogFileSinkOptions {
  readonly baseFilePath: string;
  readonly limits?: DiagnosticLogFileLimits;
}

interface ManagedLogFile {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: number;
}

function dailyBasePath(baseFilePath: string, targetDate: string): string {
  const extension = path.extname(baseFilePath) || '.log';
  const stem = path.basename(baseFilePath, path.extname(baseFilePath));
  const datedStem = DATE_IN_FILE_NAME.test(stem)
    ? stem.replace(DATE_IN_FILE_NAME, targetDate)
    : `${stem}-${targetDate}`;
  return path.join(path.dirname(baseFilePath), `${datedStem}${extension}`);
}

function rotatedPath(basePath: string, sequence: number): string {
  const extension = path.extname(basePath);
  return path.join(
    path.dirname(basePath),
    `${path.basename(basePath, extension)}.${sequence}${extension}`,
  );
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error: unknown) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') return 0;
    throw error;
  }
}

async function selectWritablePath(
  basePath: string,
  incomingBytes: number,
  maxFileBytes: number,
  plannedFileSizes: Map<string, number>,
): Promise<string> {
  if (incomingBytes > maxFileBytes) {
    throw new RangeError(`单条诊断日志 ${incomingBytes} bytes 超过单文件上限 ${maxFileBytes} bytes`);
  }
  let sequence = 0;
  while (true) {
    const candidate = sequence === 0 ? basePath : rotatedPath(basePath, sequence);
    let plannedSize = plannedFileSizes.get(candidate);
    if (plannedSize === undefined) {
      plannedSize = await fileSize(candidate);
      plannedFileSizes.set(candidate, plannedSize);
    }
    if (plannedSize + incomingBytes <= maxFileBytes) {
      return candidate;
    }
    sequence += 1;
  }
}

async function listManagedFiles(directory: string, prefix: string): Promise<ManagedLogFile[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.log'))
    .map(async entry => {
      const filePath = path.join(directory, entry.name);
      const stat = await fs.stat(filePath);
      return { name: entry.name, path: filePath, bytes: stat.size, modifiedAt: stat.mtimeMs };
    }));
  return files.sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));
}

async function enforceDirectoryLimits(
  directory: string,
  prefix: string,
  limits: DiagnosticLogFileLimits,
): Promise<void> {
  const files = await listManagedFiles(directory, prefix);
  let totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  let keptFiles = files.length;
  for (const file of [...files].reverse()) {
    if (keptFiles <= limits.maxFiles && totalBytes <= limits.maxDirectoryBytes) break;
    await fs.unlink(file.path);
    totalBytes -= file.bytes;
    keptFiles -= 1;
  }
}

export function createDiagnosticLogFileSink(
  options: CreateDiagnosticLogFileSinkOptions,
): DiagnosticLogSink {
  const limits = options.limits ?? DEFAULT_DIAGNOSTIC_LOG_FILE_LIMITS;
  const directory = path.dirname(options.baseFilePath);
  const rawStem = path.basename(options.baseFilePath, path.extname(options.baseFilePath));
  const managedPrefix = `${rawStem.replace(DATE_IN_FILE_NAME, '')}`.replace(/-+$/u, '-');

  return {
    async write(records: readonly DiagnosticLogRecord[]): Promise<void> {
      await fs.mkdir(directory, { recursive: true });
      const pendingLines = new Map<string, string[]>();
      const plannedFileSizes = new Map<string, number>();
      for (const record of records) {
        const basePath = dailyBasePath(options.baseFilePath, record.targetDate);
        const targetPath = await selectWritablePath(
          basePath,
          record.utf8Bytes,
          limits.maxFileBytes,
          plannedFileSizes,
        );
        const lines = pendingLines.get(targetPath) ?? [];
        lines.push(record.line);
        pendingLines.set(targetPath, lines);
        plannedFileSizes.set(
          targetPath,
          (plannedFileSizes.get(targetPath) ?? 0) + record.utf8Bytes,
        );
      }
      // 同一批同一文件只打开一次，避免高频事件把主日志退化为逐条 fs.open/fs.close。
      for (const [targetPath, lines] of pendingLines) {
        await fs.appendFile(targetPath, `${lines.join('\n')}\n`, 'utf8');
      }
      await enforceDirectoryLimits(directory, managedPrefix, limits);
    },
  };
}
