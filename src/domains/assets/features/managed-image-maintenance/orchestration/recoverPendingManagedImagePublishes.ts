import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type {
  ManagedImagePendingRecoveryStats,
  ManagedImageMaintenanceLogger,
} from '../definitions/managedImageMaintenance';
import type { ManagedImageWritableStoragePaths } from '../../../shared/managed-image-storage';

const RECEIPT_FILE_PATTERN = /^([0-9a-zA-Z_-]{1,200})\.json$/;
const CONTENT_RELATIVE_PATH_PATTERN = /^([a-f0-9]{2})\/([a-f0-9]{64})\.(jpg|png|webp|svg)$/;
const QUARANTINE_FILE_PATTERN = /^[0-9a-zA-Z_-]{1,200}--[a-f0-9]{64}\.(?:jpg|png|webp|svg)$/;

interface PendingPublishReceiptV1 {
  readonly version: 1;
  readonly contentRelativePath: string;
  readonly expectedSha256: string;
}

function parsePendingReceipt(value: unknown): PendingPublishReceiptV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'contentRelativePath,expectedSha256,version') return null;
  const version = Reflect.get(value, 'version');
  const contentRelativePath = Reflect.get(value, 'contentRelativePath');
  const expectedSha256 = Reflect.get(value, 'expectedSha256');
  if (version !== 1) return null;
  if (typeof contentRelativePath !== 'string') return null;
  if (typeof expectedSha256 !== 'string') return null;
  const match = CONTENT_RELATIVE_PATH_PATTERN.exec(contentRelativePath);
  if (!match || match[2] !== expectedSha256) return null;
  return {
    version: 1,
    contentRelativePath,
    expectedSha256,
  };
}

async function removeExpiredQuarantine(params: {
  readonly paths: ManagedImageWritableStoragePaths;
  readonly deleteBeforeMs: number;
  readonly logger: ManagedImageMaintenanceLogger;
}): Promise<{ readonly deleted: number; readonly failed: number }> {
  const entries = await fsp.readdir(params.paths.quarantineRoot, { withFileTypes: true }).catch(() => []);
  let deleted = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !QUARANTINE_FILE_PATTERN.test(entry.name)) continue;
    const quarantinePath = path.join(params.paths.quarantineRoot, entry.name);
    try {
      const stat = await fsp.stat(quarantinePath);
      if (stat.mtimeMs >= params.deleteBeforeMs) continue;
      await fsp.unlink(quarantinePath);
      deleted += 1;
    } catch (error: unknown) {
      failed += 1;
      params.logger.warn(
        `受管图片隔离文件清理失败: file=${quarantinePath}, err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { deleted, failed };
}

/**
 * 只恢复由发布协议显式留下的 pending 凭证。正式 content 目录不再通过
 * “当前数据库没有登记”反向推断所有权，避免错误数据库删除另一账本的数据。
 */
export async function recoverPendingManagedImagePublishes(params: {
  readonly paths: ManagedImageWritableStoragePaths;
  readonly registeredLocalPaths: ReadonlySet<string>;
  readonly createdBeforeMs: number;
  readonly quarantineDeleteBeforeMs: number;
  readonly logger: ManagedImageMaintenanceLogger;
}): Promise<ManagedImagePendingRecoveryStats> {
  await Promise.all([
    fsp.mkdir(params.paths.pendingRoot, { recursive: true }),
    fsp.mkdir(params.paths.quarantineRoot, { recursive: true }),
  ]);
  const entries = await fsp.readdir(params.paths.pendingRoot, { withFileTypes: true });
  let scanned = 0;
  let completed = 0;
  let quarantined = 0;
  let failed = 0;

  for (const entry of entries) {
    const receiptMatch = entry.isFile() ? RECEIPT_FILE_PATTERN.exec(entry.name) : null;
    if (!receiptMatch) continue;
    scanned += 1;
    const receiptPath = path.join(params.paths.pendingRoot, entry.name);
    try {
      const receiptStat = await fsp.stat(receiptPath);
      if (receiptStat.mtimeMs >= params.createdBeforeMs) continue;
      const parsed = parsePendingReceipt(JSON.parse(await fsp.readFile(receiptPath, 'utf8')));
      if (!parsed) throw new Error('invalid_pending_receipt');
      const finalPath = path.join(
        params.paths.contentRoot,
        ...parsed.contentRelativePath.split('/'),
      );
      if (params.registeredLocalPaths.has(finalPath)) {
        await fsp.unlink(receiptPath);
        completed += 1;
        continue;
      }

      const finalStat = await fsp.lstat(finalPath).catch(() => null);
      if (finalStat) {
        if (!finalStat.isFile()) throw new Error('pending_target_not_regular');
        const quarantinePath = path.join(
          params.paths.quarantineRoot,
          `${receiptMatch[1]}--${path.basename(finalPath)}`,
        );
        await fsp.rename(finalPath, quarantinePath);
        quarantined += 1;
      }
      await fsp.unlink(receiptPath);
      completed += 1;
    } catch (error: unknown) {
      failed += 1;
      params.logger.warn(
        `受管图片 pending 恢复失败: receipt=${receiptPath}, err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const quarantine = await removeExpiredQuarantine({
    paths: params.paths,
    deleteBeforeMs: params.quarantineDeleteBeforeMs,
    logger: params.logger,
  });
  return {
    scanned,
    completed,
    quarantined,
    quarantineDeleted: quarantine.deleted,
    failed: failed + quarantine.failed,
  };
}
