import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ImageInspectionError } from 'src/shared/media/image-inspection';
import {
  createSqliteLocalImageAssetLedger,
  registerLocalImageAsset,
} from '../index';

let db: Database.Database;
let root: string;

async function createPng(width = 16, height = 9): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 32, g: 96, b: 160, alpha: 1 },
    },
  }).png().toBuffer();
}

describe('local image asset registration', () => {
  beforeEach(async () => {
    db = new Database(':memory:');
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
      CREATE TABLE project_asset_links (
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        role TEXT NOT NULL,
        origin TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(project_id, asset_id)
      );
    `);
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-local-image-asset-'));
  });

  afterEach(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('按真实字节登记媒体事实且不隐式创建项目归属', async () => {
    const sourcePath = path.join(root, 'misleading.jpg');
    const bytes = await createPng();
    await fsp.writeFile(sourcePath, bytes);

    const asset = await registerLocalImageAsset({
      sourcePath,
      createdAt: '2026-07-23T00:00:00.000Z',
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db, createAssetId: () => 'asset-1' }),
    });

    expect(asset).toMatchObject({
      assetId: 'asset-1',
      mediaType: 'image/png',
      byteLength: bytes.length,
      width: 16,
      height: 9,
      localPath: sourcePath,
      createdAt: Date.parse('2026-07-23T00:00:00.000Z'),
    });
    expect(asset.uri).toMatch(/^\/Resources\/GeneratedImages\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
    expect(asset.uri).not.toContain(root);
    expect(db.prepare('SELECT COUNT(*) AS count FROM project_asset_links').get()).toEqual({ count: 0 });
  });

  it('相同内容复用 canonical asset，并把宿主路径更新到最新有效文件', async () => {
    const bytes = await createPng();
    const firstPath = path.join(root, 'first.png');
    const secondPath = path.join(root, 'second.png');
    await Promise.all([fsp.writeFile(firstPath, bytes), fsp.writeFile(secondPath, bytes)]);
    const ledger = createSqliteLocalImageAssetLedger({
      db,
      createAssetId: () => 'asset-canonical',
    });

    const first = await registerLocalImageAsset({
      sourcePath: firstPath,
      maxImagePixels: 1_000_000,
      ledger,
    });
    const second = await registerLocalImageAsset({
      sourcePath: secondPath,
      maxImagePixels: 1_000_000,
      ledger,
    });

    expect(second.assetId).toBe(first.assetId);
    expect(second.localPath).toBe(secondPath);
    expect(db.prepare('SELECT id, local_path FROM assets').all()).toEqual([
      { id: 'asset-canonical', local_path: secondPath },
    ]);
  });

  it('无效图片在写 ledger 前失败', async () => {
    const sourcePath = path.join(root, 'not-an-image.png');
    await fsp.writeFile(sourcePath, 'not-an-image');

    await expect(registerLocalImageAsset({
      sourcePath,
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db }),
    })).rejects.toBeInstanceOf(ImageInspectionError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 });
  });
});
