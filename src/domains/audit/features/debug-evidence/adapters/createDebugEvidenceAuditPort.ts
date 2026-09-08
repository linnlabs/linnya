import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import { Logger } from 'src/shared/logger';
import { sanitizePathSegment } from 'src/shared/utils/pathSanitizer';
import {
  DEBUG_EVIDENCE_MAINTENANCE_INTERVAL_MS,
  DEBUG_EVIDENCE_MAX_DIRECTORY_BYTES,
  DEBUG_EVIDENCE_MAX_RUN_FILE_BYTES,
  DEBUG_EVIDENCE_RETENTION_MS,
} from '../definitions/debugEvidenceRetention';

const logger = new Logger('UnifiedAuditDebugEvidence');

interface StoredEvidenceFile {
  readonly filePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

export interface CreateDebugEvidenceAuditPortOptions {
  readonly directoryPath: string;
  readonly now?: () => number;
  readonly maxDirectoryBytes?: number;
  readonly maxRunFileBytes?: number;
  readonly retentionMs?: number;
}

/**
 * 创建统一 Audit 内部的开发诊断文件 sink。
 *
 * 它不是第二个审计入口：调用方只能从 `createLinnyaAuditRuntime()` 得到 AuditPort，
 * runtime 根据 action namespace 把 debug evidence 路由到这里。按 conversation/run 分片
 * 是为了让删除会话和容量维护能够有明确的文件边界；文件只保存有界 JSONL，不创建
 * `.in_progress` 或最终快照副本。
 */
export function createDebugEvidenceAuditPort(
  options: CreateDebugEvidenceAuditPortOptions
): AuditPort {
  const now = options.now ?? Date.now;
  const maxDirectoryBytes = options.maxDirectoryBytes ?? DEBUG_EVIDENCE_MAX_DIRECTORY_BYTES;
  const maxRunFileBytes = options.maxRunFileBytes ?? DEBUG_EVIDENCE_MAX_RUN_FILE_BYTES;
  const retentionMs = options.retentionMs ?? DEBUG_EVIDENCE_RETENTION_MS;
  const files = new Map<string, StoredEvidenceFile>();
  let totalBytes = 0;
  let initialized = false;
  let lastMaintenanceAtMs = 0;
  let serial = Promise.resolve();

  const emit = (envelope: AuditEnvelope): Promise<void> => {
    const operation = serial.then(async () => {
      await appendEnvelope(envelope);
    });
    serial = operation.catch(error => {
      logger.error('[UnifiedAudit] debug evidence 写入失败', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return operation;
  };

  return {
    emit,
    flush: async () => {
      await serial;
    },
  };

  async function appendEnvelope(envelope: AuditEnvelope): Promise<void> {
    await ensureInitialized();
    const line = `${JSON.stringify(envelope)}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > maxRunFileBytes) {
      warnDropped(envelope, 'single_record_limit', maxRunFileBytes);
      return;
    }

    const filePath = resolveRunFilePath(options.directoryPath, envelope);
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const storedFile = await loadFile(filePath);
    if (storedFile.sizeBytes + lineBytes > maxRunFileBytes) {
      warnDropped(envelope, 'run_file_limit', maxRunFileBytes);
      return;
    }

    await makeRoom(lineBytes, filePath);
    if (totalBytes + lineBytes > maxDirectoryBytes) {
      warnDropped(envelope, 'directory_limit', maxDirectoryBytes);
      return;
    }

    await fsp.appendFile(filePath, line, { encoding: 'utf8', mode: 0o600 });
    storedFile.sizeBytes += lineBytes;
    storedFile.modifiedAtMs = now();
    totalBytes += lineBytes;
    files.set(filePath, storedFile);
    await maybeMaintain();
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) {
      await maybeMaintain();
      return;
    }
    await fsp.mkdir(options.directoryPath, { recursive: true, mode: 0o700 });
    await scanFiles(options.directoryPath);
    initialized = true;
    await maintain();
  }

  async function scanFiles(directoryPath: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }

    await Promise.all(
      entries.map(async entry => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          await scanFiles(entryPath);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
        const stats = await fsp.stat(entryPath);
        const storedFile: StoredEvidenceFile = {
          filePath: entryPath,
          sizeBytes: stats.size,
          modifiedAtMs: stats.mtimeMs,
        };
        files.set(entryPath, storedFile);
        totalBytes += stats.size;
      })
    );
  }

  async function loadFile(filePath: string): Promise<StoredEvidenceFile> {
    const known = files.get(filePath);
    if (known) return known;

    try {
      const stats = await fsp.stat(filePath);
      const storedFile: StoredEvidenceFile = {
        filePath,
        sizeBytes: stats.size,
        modifiedAtMs: stats.mtimeMs,
      };
      files.set(filePath, storedFile);
      totalBytes += stats.size;
      return storedFile;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const storedFile: StoredEvidenceFile = {
        filePath,
        sizeBytes: 0,
        modifiedAtMs: now(),
      };
      files.set(filePath, storedFile);
      return storedFile;
    }
  }

  async function makeRoom(requiredBytes: number, activeFilePath: string): Promise<void> {
    if (totalBytes + requiredBytes <= maxDirectoryBytes) return;
    const candidates = [...files.values()]
      .filter(file => file.filePath !== activeFilePath)
      .sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);
    for (const file of candidates) {
      if (totalBytes + requiredBytes <= maxDirectoryBytes) return;
      await deleteFile(file);
    }
  }

  async function maybeMaintain(): Promise<void> {
    if (now() - lastMaintenanceAtMs < DEBUG_EVIDENCE_MAINTENANCE_INTERVAL_MS) return;
    await maintain();
  }

  async function maintain(): Promise<void> {
    const cutoff = now() - retentionMs;
    for (const file of [...files.values()]) {
      if (file.modifiedAtMs < cutoff) await deleteFile(file);
    }
    await makeRoom(0, '');
    lastMaintenanceAtMs = now();
  }

  async function deleteFile(file: StoredEvidenceFile): Promise<void> {
    try {
      await fsp.rm(file.filePath, { force: true });
      totalBytes -= file.sizeBytes;
      files.delete(file.filePath);
      await removeEmptyParent(path.dirname(file.filePath));
    } catch (error) {
      logger.warn('[UnifiedAudit] debug evidence 清理失败', {
        filePath: file.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function removeEmptyParent(directoryPath: string): Promise<void> {
    if (directoryPath === options.directoryPath) return;
    try {
      await fsp.rmdir(directoryPath);
      await removeEmptyParent(path.dirname(directoryPath));
    } catch {
      // 非空目录、目录已被清理或并发创建都不影响审计写入。
    }
  }
}

function resolveRunFilePath(directoryPath: string, envelope: AuditEnvelope): string {
  const conversationId = sanitizePathSegment(
    envelope.scope?.conversationId ?? 'unknown-conversation',
    160
  );
  const runId = sanitizePathSegment(envelope.scope?.runId ?? envelope.runId, 160);
  return path.join(directoryPath, conversationId, `${runId}.jsonl`);
}

function warnDropped(envelope: AuditEnvelope, reason: string, limitBytes: number): void {
  logger.warn('[UnifiedAudit] debug evidence 已达到容量上限，片段已丢弃', {
    action: envelope.action,
    runId: envelope.runId,
    reason,
    limitBytes,
  });
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
