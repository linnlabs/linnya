import type Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import { isPathInsideRoot } from 'src/shared/filesystem/managedPath';
import type {
  ManagedImagePendingRecoveryStats,
  ManagedImageMaintenanceLogger,
  OrphanManagedImageAssetStats,
} from '../../definitions/managedImageMaintenance';
import { recoverPendingManagedImagePublishes } from '../../orchestration/recoverPendingManagedImagePublishes';
import {
  createLegacyAppManagedImageStoragePaths,
  createLegacyWorkspaceManagedImageStoragePaths,
  createManagedImageStoragePaths,
} from '../../../../shared/managed-image-storage';

interface AssetLocalPathRow {
  readonly local_path: string;
}

interface OrphanAssetRow {
  readonly id: string;
  readonly local_path: string | null;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare<[string], { name: string }>(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName));
}

/**
 * 删除失去全部业务引用的受管图片 asset。
 * 显式检查已知 ownership 表，不能依赖调用方是否开启 foreign_keys。
 */
export async function collectOrphanManagedImageAssets(params: {
  readonly db: Database.Database;
  readonly appDataRoot: string;
  readonly storeId: string;
  readonly workspaceRoot: string;
  readonly logger: ManagedImageMaintenanceLogger;
  /** 只回收本进程启动前登记的 asset，避开 ingress → event transaction 窗口。 */
  readonly createdBeforeMs: number;
}): Promise<OrphanManagedImageAssetStats> {
  const referenceTables = [
    'conversation_event_asset_links',
    'project_asset_links',
    'document_asset_links',
    'image_blocks',
    'audio_blocks',
  ].filter(tableName => tableExists(params.db, tableName));
  const absenceClauses = referenceTables.map(
    tableName => `NOT EXISTS (SELECT 1 FROM ${tableName} ref WHERE ref.asset_id = assets.id)`,
  );
  const candidates = params.db.prepare<[number], OrphanAssetRow>(`
    SELECT id, local_path
    FROM assets
    WHERE uri LIKE '/Resources/Attachments/%'
      AND created_at < ?
      ${absenceClauses.length > 0 ? `AND ${absenceClauses.join('\n      AND ')}` : ''}
  `).all(params.createdBeforeMs);

  const deletedRows = params.db.transaction((): readonly OrphanAssetRow[] => {
    const deleted: OrphanAssetRow[] = [];
    const remove = params.db.prepare('DELETE FROM assets WHERE id = ?');
    for (const candidate of candidates) {
      if (remove.run(candidate.id).changes === 1) deleted.push(candidate);
    }
    return deleted;
  })();
  const readCurrentPathOwner = params.db.prepare<[string], { readonly found: 1 }>(`
    SELECT 1 AS found
    FROM assets
    WHERE local_path = ?
    LIMIT 1
  `);

  const managedPaths = createManagedImageStoragePaths(params.appDataRoot, params.storeId);
  const legacyAppPaths = createLegacyAppManagedImageStoragePaths(params.appDataRoot);
  const legacyPaths = createLegacyWorkspaceManagedImageStoragePaths(params.workspaceRoot);
  const allowedRoots = await Promise.all([
    fsp.realpath(managedPaths.contentRoot).catch(() => null),
    fsp.realpath(legacyAppPaths.contentRoot).catch(() => null),
    fsp.realpath(legacyPaths.contentRoot).catch(() => null),
  ]);
  let deletedFiles = 0;
  let failedFiles = 0;
  for (const row of deletedRows) {
    if (!row.local_path) continue;
    const fileRealPath = await fsp.realpath(row.local_path).catch(() => null);
    if (!fileRealPath) continue;
    if (!allowedRoots.some(root => root && isPathInsideRoot(root, fileRealPath))) {
      failedFiles += 1;
      params.logger.warn(`受管图片文件回收跳过越界路径: assetId=${row.id}`);
      continue;
    }
    const currentStoreRoot = allowedRoots[0];
    if (!currentStoreRoot || !isPathInsideRoot(currentStoreRoot, fileRealPath)) {
      // v1 目录没有数据库身份，不能以当前账本的孤儿判断删除可能被旧备份引用的字节。
      continue;
    }
    // 账本行删除与物理回收不是同一事务。启动维护虽然先于 ingress 开放，
    // 这里仍以当前账本为最终删除依据，避免共享 canonical path 被其他合法行占用。
    if (readCurrentPathOwner.get(row.local_path)) continue;
    try {
      await fsp.unlink(row.local_path);
      deletedFiles += 1;
    } catch (error: unknown) {
      failedFiles += 1;
      params.logger.warn(
        `受管图片文件回收失败: assetId=${row.id}, err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { deletedAssets: deletedRows.length, deletedFiles, failedFiles };
}

/** 账本只裁决当前 store 的显式 pending 发布，不扫描未知正式内容。 */
export async function recoverPendingManagedImagePublishesFromLedger(params: {
  readonly db: Database.Database;
  readonly appDataRoot: string;
  readonly storeId: string;
  readonly logger: ManagedImageMaintenanceLogger;
  readonly processStartedAtMs?: number;
  readonly quarantineRetentionMs: number;
}): Promise<ManagedImagePendingRecoveryStats> {
  const rows = params.db.prepare<[], AssetLocalPathRow>(`
    SELECT local_path
    FROM assets
    WHERE local_path IS NOT NULL
  `).all();
  const registeredLocalPaths = new Set(rows.map(row => row.local_path));
  return recoverPendingManagedImagePublishes({
    paths: createManagedImageStoragePaths(params.appDataRoot, params.storeId),
    registeredLocalPaths,
    createdBeforeMs: params.processStartedAtMs ?? Date.now() - process.uptime() * 1_000,
    quarantineDeleteBeforeMs: Date.now() - params.quarantineRetentionMs,
    logger: params.logger,
  });
}
