import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectImageBytes } from 'src/shared/media/image-inspection';
import { createSqliteLocalImageAssetLedger } from '../../local-image-registration';
import {
  createManagedImageContentIdentity,
  createManagedImageStoragePaths,
} from '../../../shared/managed-image-storage';
import { createManagedImageIngress } from '../index';

const STORE_ID = 'f7bb8587-feaa-44df-82e3-4a1c93d9ba30';

describe('managed image ingress', () => {
  let root: string;
  let appDataRoot: string;
  let sourceRoot: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-managed-image-ingress-'));
    appDataRoot = path.join(root, 'app-data');
    sourceRoot = path.join(root, 'command-output');
    await Promise.all([fsp.mkdir(appDataRoot), fsp.mkdir(sourceRoot)]);
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
        PRIMARY KEY (project_id, asset_id)
      );
    `);
  });

  afterEach(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function createPng(): Promise<Buffer> {
    return sharp({
      create: {
        width: 12,
        height: 7,
        channels: 4,
        background: { r: 30, g: 100, b: 180, alpha: 0.6 },
      },
    })
      .png()
      .toBuffer();
  }

  it('复制并复核命令图片，删除原文件后受管副本和 asset 仍然有效', async () => {
    const bytes = await createPng();
    const sourcePath = path.join(sourceRoot, 'misleading.jpg');
    await fsp.writeFile(sourcePath, bytes);
    const ingress = createManagedImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      maxImageBytes: 1_000_000,
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db, createAssetId: () => 'asset-managed' }),
      createStagingId: () => 'staging-1',
    });

    const asset = await ingress.ingestLocalImage({
      sourcePath,
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    await fsp.unlink(sourcePath);

    expect(asset).toMatchObject({
      assetId: 'asset-managed',
      mediaType: 'image/png',
      byteLength: bytes.length,
      width: 12,
      height: 7,
      createdAt: Date.parse('2026-07-23T00:00:00.000Z'),
    });
    expect(asset.uri).toMatch(/^\/Resources\/Attachments\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/);
    expect(asset.localPath).not.toBe(sourcePath);
    await expect(fsp.readFile(asset.localPath)).resolves.toEqual(bytes);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    await expect(fsp.readdir(paths.pendingRoot)).resolves.toEqual([]);
    await expect(fsp.readdir(paths.stagingRoot)).resolves.toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM project_asset_links').get()).toEqual({
      count: 0,
    });
  });

  it('内存图片与本地文件共用同一内容寻址发布和账本合同', async () => {
    const bytes = await createPng();
    const ingress = createManagedImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      maxImageBytes: 1_000_000,
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db, createAssetId: () => 'asset-bytes' }),
      createStagingId: () => 'bytes-staging',
    });

    const asset = await ingress.ingestImageBytes({
      bytes,
      createdAt: '2026-08-20T00:00:00.000Z',
    });

    expect(asset).toMatchObject({
      assetId: 'asset-bytes',
      mediaType: 'image/png',
      byteLength: bytes.length,
      width: 12,
      height: 7,
      createdAt: Date.parse('2026-08-20T00:00:00.000Z'),
    });
    await expect(fsp.readFile(asset.localPath)).resolves.toEqual(bytes);
  });

  it('账本登记失败时保留 pending 恢复事实，但不保留 staging 副本', async () => {
    const bytes = await createPng();
    const sourcePath = path.join(sourceRoot, 'ledger-failure.png');
    await fsp.writeFile(sourcePath, bytes);
    const ingress = createManagedImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      maxImageBytes: 1_000_000,
      maxImagePixels: 1_000_000,
      ledger: {
        registerLocalImage() {
          throw new Error('ledger unavailable');
        },
      },
      createStagingId: () => 'ledger-failure',
    });

    await expect(ingress.ingestLocalImage({ sourcePath })).rejects.toThrow('ledger unavailable');

    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    await expect(fsp.readdir(paths.stagingRoot)).resolves.toEqual([]);
    await expect(fsp.readdir(paths.pendingRoot)).resolves.toEqual(['ledger-failure.json']);
    const contentPrefixes = await fsp.readdir(paths.contentRoot);
    expect(contentPrefixes).toHaveLength(1);
  });

  it('拒绝符号链接来源，也不把损坏的既有内容寻址目标静默覆盖', async () => {
    const bytes = await createPng();
    const sourcePath = path.join(sourceRoot, 'source.png');
    const symlinkPath = path.join(sourceRoot, 'source-link.png');
    await fsp.writeFile(sourcePath, bytes);
    await fsp.symlink(sourcePath, symlinkPath);
    const ingress = createManagedImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      maxImageBytes: 1_000_000,
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db }),
      createStagingId: (() => {
        const ids = ['staging-link', 'staging-conflict'];
        return () => ids.shift() ?? 'staging-extra';
      })(),
    });

    await expect(ingress.ingestLocalImage({ sourcePath: symlinkPath })).rejects.toMatchObject({
      failure: 'source_not_file',
    });

    const inspected = await inspectImageBytes({ bytes, maxImagePixels: 1_000_000 });
    const identity = createManagedImageContentIdentity({
      paths: createManagedImageStoragePaths(appDataRoot, STORE_ID),
      sha256: inspected.sha256,
      mediaType: inspected.mediaType,
    });
    await fsp.mkdir(path.dirname(identity.localPath), { recursive: true });
    await fsp.writeFile(identity.localPath, 'corrupt-existing-content');

    await expect(ingress.ingestLocalImage({ sourcePath })).rejects.toMatchObject({
      failure: 'content_address_conflict',
    });
    await expect(fsp.readFile(identity.localPath, 'utf8')).resolves.toBe(
      'corrupt-existing-content'
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 });
  });

  it('在读取和解码前按文件大小拒绝超限来源', async () => {
    const sourcePath = path.join(sourceRoot, 'oversized.png');
    await fsp.writeFile(sourcePath, Buffer.alloc(257));
    const ingress = createManagedImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      maxImageBytes: 256,
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db }),
    });

    await expect(ingress.ingestLocalImage({ sourcePath })).rejects.toMatchObject({
      failure: 'source_too_large',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 });
  });

  it('在解码前按字节长度拒绝超限内存图片', async () => {
    const ingress = createManagedImageIngress({
      appDataRoot,
      storeId: STORE_ID,
      maxImageBytes: 256,
      maxImagePixels: 1_000_000,
      ledger: createSqliteLocalImageAssetLedger({ db }),
    });

    await expect(ingress.ingestImageBytes({ bytes: Buffer.alloc(257) })).rejects.toMatchObject({
      failure: 'source_too_large',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 });
  });
});
