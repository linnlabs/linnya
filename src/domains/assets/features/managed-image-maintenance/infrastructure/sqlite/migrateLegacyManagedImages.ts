import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { isPathInsideRoot } from 'src/shared/filesystem/managedPath';
import { inspectImageBytes } from 'src/shared/media/image-inspection';
import {
  completeManagedImagePublish,
  createLegacyAppManagedImageStoragePaths,
  createLegacyWorkspaceManagedImageStoragePaths,
  createManagedImageContentIdentity,
  createManagedImageStoragePaths,
  isManagedImageResourceUri,
  publishStagedManagedImage,
} from '../../../../shared/managed-image-storage';
import type { ManagedImageMaintenanceLogger } from '../../definitions/managedImageMaintenance';

interface LegacyManagedImageRow {
  readonly id: string;
  readonly uri: string;
  readonly media_type: string | null;
  readonly size_bytes: number | null;
  readonly width_px: number | null;
  readonly height_px: number | null;
  readonly sha256: string | null;
  readonly local_path: string;
}

export interface LegacyManagedImageMigrationStats {
  readonly scanned: number;
  readonly migrated: number;
  readonly skipped: number;
  readonly failed: number;
}

function matchesLedger(
  row: LegacyManagedImageRow,
  inspected: Awaited<ReturnType<typeof inspectImageBytes>>,
): boolean {
  return row.media_type === inspected.mediaType
    && row.size_bytes === inspected.byteLength
    && row.width_px === inspected.width
    && row.height_px === inspected.height
    && row.sha256 === inspected.sha256;
}

/**
 * 只依据已有 asset.local_path 把 v1 AppData 与 Workspace ManagedAssets 迁入当前
 * store。空数据库不会认领目录中的未知文件，迁移也不会扫描未登记内容。
 */
export async function migrateLegacyManagedImages(params: {
  readonly db: Database.Database;
  readonly appDataRoot: string;
  readonly storeId: string;
  readonly workspaceRoot: string;
  readonly maxImagePixels: number;
  readonly logger: ManagedImageMaintenanceLogger;
}): Promise<LegacyManagedImageMigrationStats> {
  const nextPaths = createManagedImageStoragePaths(params.appDataRoot, params.storeId);
  const legacyAppPaths = createLegacyAppManagedImageStoragePaths(params.appDataRoot);
  const legacyWorkspacePaths = createLegacyWorkspaceManagedImageStoragePaths(params.workspaceRoot);
  const lexicalLegacyRoots = [
    path.resolve(legacyAppPaths.contentRoot),
    path.resolve(legacyWorkspacePaths.contentRoot),
  ];
  const rows = params.db.prepare<[], LegacyManagedImageRow>(`
    SELECT id, uri, media_type, size_bytes, width_px, height_px, sha256, local_path
    FROM assets
    WHERE local_path IS NOT NULL
  `).all().filter(row =>
    isManagedImageResourceUri(row.uri)
    && lexicalLegacyRoots.some(root => isPathInsideRoot(root, path.resolve(row.local_path)))
  );

  await Promise.all([
    fsp.mkdir(nextPaths.stagingRoot, { recursive: true }),
    fsp.mkdir(nextPaths.contentRoot, { recursive: true }),
    fsp.mkdir(nextPaths.pendingRoot, { recursive: true }),
  ]);
  const [appDataRealPath, nextContentRealPath, workspaceRealPath] = await Promise.all([
    fsp.realpath(params.appDataRoot),
    fsp.realpath(nextPaths.contentRoot),
    fsp.realpath(params.workspaceRoot),
  ]);
  if (!isPathInsideRoot(appDataRealPath, nextContentRealPath)) {
    throw new Error('Managed image content root escapes AppData boundary');
  }
  const legacyRoots = (
    await Promise.all([
      fsp.realpath(legacyAppPaths.contentRoot).catch(() => null),
      fsp.realpath(legacyWorkspacePaths.contentRoot).catch(() => null),
    ])
  ).filter((root): root is string => root !== null);
  for (const legacyRoot of legacyRoots) {
    if (
      !isPathInsideRoot(appDataRealPath, legacyRoot)
      && !isPathInsideRoot(workspaceRealPath, legacyRoot)
    ) {
      throw new Error('Legacy managed image root escapes its storage boundary');
    }
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    let sourceRealPath: string;
    try {
      sourceRealPath = await fsp.realpath(row.local_path);
    } catch {
      failed += 1;
      params.logger.warn(`旧受管图片迁移失败: assetId=${row.id}, reason=file_missing`);
      continue;
    }
    if (!legacyRoots.some(root => isPathInsideRoot(root, sourceRealPath))) {
      skipped += 1;
      continue;
    }

    try {
      const stat = await fsp.lstat(row.local_path);
      if (!stat.isFile()) throw new Error('file_not_regular');
      const bytes = await fsp.readFile(row.local_path);
      const inspected = await inspectImageBytes({ bytes, maxImagePixels: params.maxImagePixels });
      if (!matchesLedger(row, inspected)) throw new Error('ledger_mismatch');
      const identity = createManagedImageContentIdentity({
        paths: nextPaths,
        sha256: inspected.sha256,
        mediaType: inspected.mediaType,
      });
      if (identity.uri !== row.uri) throw new Error('uri_mismatch');

      const publishId = `migration_${randomUUID()}`;
      const stagingPath = path.join(nextPaths.stagingRoot, `${publishId}.upload`);
      await fsp.writeFile(stagingPath, bytes, { flag: 'wx' });
      try {
        const pendingPublish = await publishStagedManagedImage({
          paths: nextPaths,
          publishId,
          stagingPath,
          finalPath: identity.localPath,
          expectedSha256: inspected.sha256,
        });
        const update = params.db.prepare(`
          UPDATE assets
          SET local_path = ?
          WHERE id = ? AND local_path = ?
        `).run(identity.localPath, row.id, row.local_path);
        if (update.changes !== 1) {
          skipped += 1;
          continue;
        }
        await completeManagedImagePublish(pendingPublish);
      } finally {
        await fsp.rm(stagingPath, { force: true });
      }
      migrated += 1;
      // v1 没有 store 身份，可能仍被另一份数据库备份引用。当前库迁移成功也只更新
      // 自己的账本，不能据此删除旧字节；v1 进入只读保留态，不再自动物理 GC。
    } catch (error: unknown) {
      failed += 1;
      params.logger.warn(
        `旧受管图片迁移失败: assetId=${row.id}, reason=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { scanned: rows.length, migrated, skipped, failed };
}
