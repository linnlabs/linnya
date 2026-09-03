import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLegacyAppManagedImageStoragePaths,
  createLegacyWorkspaceManagedImageStoragePaths,
} from '../../../shared/managed-image-storage';
import { migrateLegacyManagedImages } from '../index';

const STORE_ID = 'ed800f4d-8829-4f2c-9843-192eb376cf73';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      media_type TEXT,
      size_bytes INTEGER,
      width_px INTEGER,
      height_px INTEGER,
      sha256 TEXT,
      storage_status TEXT NOT NULL,
      local_path TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('legacy managed image migration', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fsp.rm(dir, { recursive: true, force: true })));
  });

  async function createRoots(): Promise<{ readonly appDataRoot: string; readonly workspaceRoot: string }> {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-legacy-app-data-'));
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-legacy-workspace-'));
    tempDirs.push(appDataRoot, workspaceRoot);
    return { appDataRoot, workspaceRoot };
  }

  it('按已有账本把 AppData v1 与 Workspace ManagedAssets 迁入绑定 store', async () => {
    const { appDataRoot, workspaceRoot } = await createRoots();
    const pngBytes = await sharp({
      create: {
        width: 8,
        height: 6,
        channels: 3,
        background: { r: 40, g: 100, b: 180 },
      },
    }).png().toBuffer();
    const webpBytes = await sharp(pngBytes).webp().toBuffer();
    const legacyRoots = [
      createLegacyAppManagedImageStoragePaths(appDataRoot),
      createLegacyWorkspaceManagedImageStoragePaths(workspaceRoot),
    ];
    const sourceImages = [
      { bytes: pngBytes, extension: 'png', mediaType: 'image/png' },
      { bytes: webpBytes, extension: 'webp', mediaType: 'image/webp' },
    ] as const;
    const oldImages = await Promise.all(sourceImages.map(async (image, index) => {
      const sha256 = createHash('sha256').update(image.bytes).digest('hex');
      const localPath = path.join(
        legacyRoots[index].contentRoot,
        sha256.slice(0, 2),
        `${sha256}.${image.extension}`,
      );
      await fsp.mkdir(path.dirname(localPath), { recursive: true });
      await fsp.writeFile(localPath, image.bytes);
      return { ...image, id: `legacy-${index}`, localPath, sha256 };
    }));
    const db = createDatabase();
    for (const old of oldImages) {
      db.prepare(`
        INSERT INTO assets VALUES (?, ?, ?, ?, 8, 6, ?, 'local', ?, 1)
      `).run(
        old.id,
        `/Resources/Attachments/${old.sha256.slice(0, 2)}/${old.sha256}.${old.extension}`,
        old.mediaType,
        old.bytes.length,
        old.sha256,
        old.localPath,
      );
    }
    const logger = { warn: vi.fn() };
    try {
      expect(await migrateLegacyManagedImages({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
        maxImagePixels: 1_000_000,
        logger,
      })).toEqual({ scanned: 2, migrated: 2, skipped: 0, failed: 0 });
      const rows = db.prepare('SELECT id, local_path FROM assets ORDER BY id').all() as Array<{
        readonly id: string;
        readonly local_path: string;
      }>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.local_path).toContain(
          `${path.sep}ConversationAttachments${path.sep}v2${path.sep}stores${path.sep}${STORE_ID}${path.sep}`,
        );
        await expect(fsp.readFile(row.local_path)).resolves.toBeInstanceOf(Buffer);
      }
      for (const old of oldImages) {
        await expect(fsp.readFile(old.localPath)).resolves.toEqual(old.bytes);
      }
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('空账本不认领也不删除 v1 目录中的未知图片', async () => {
    const { appDataRoot, workspaceRoot } = await createRoots();
    const legacyPaths = createLegacyAppManagedImageStoragePaths(appDataRoot);
    const unknownPath = path.join(legacyPaths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(unknownPath), { recursive: true });
    await fsp.writeFile(unknownPath, 'unknown');
    const db = createDatabase();
    const logger = { warn: vi.fn() };
    try {
      expect(await migrateLegacyManagedImages({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
        maxImagePixels: 1_000_000,
        logger,
      })).toEqual({ scanned: 0, migrated: 0, skipped: 0, failed: 0 });
      await expect(fsp.readFile(unknownPath, 'utf8')).resolves.toBe('unknown');
    } finally {
      db.close();
    }
  });

  it('账本与旧文件不一致时保留原路径和字节', async () => {
    const { appDataRoot, workspaceRoot } = await createRoots();
    const legacyPaths = createLegacyAppManagedImageStoragePaths(appDataRoot);
    const declaredSha = 'a'.repeat(64);
    const oldPath = path.join(legacyPaths.contentRoot, 'aa', `${declaredSha}.png`);
    await fsp.mkdir(path.dirname(oldPath), { recursive: true });
    await fsp.writeFile(oldPath, 'corrupted');
    const db = createDatabase();
    db.prepare(`
      INSERT INTO assets VALUES (?, ?, 'image/png', 10, 8, 6, ?, 'local', ?, 1)
    `).run(
      'corrupt-asset',
      `/Resources/Attachments/aa/${declaredSha}.png`,
      declaredSha,
      oldPath,
    );
    const logger = { warn: vi.fn() };
    try {
      expect(await migrateLegacyManagedImages({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
        maxImagePixels: 1_000_000,
        logger,
      })).toEqual({ scanned: 1, migrated: 0, skipped: 0, failed: 1 });
      expect(db.prepare('SELECT local_path FROM assets').get()).toEqual({ local_path: oldPath });
      await expect(fsp.readFile(oldPath, 'utf8')).resolves.toBe('corrupted');
    } finally {
      db.close();
    }
  });
});
