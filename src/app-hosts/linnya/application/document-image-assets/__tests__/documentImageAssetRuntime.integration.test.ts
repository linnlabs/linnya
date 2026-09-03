import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { createSqliteLocalImageAssetLedger } from 'src/domains/assets/features/local-image-registration';
import { createManagedImageIngress } from 'src/domains/assets/features/managed-image-ingress';
import { createManagedImageStoragePaths } from 'src/domains/assets/shared/managed-image-storage';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import {
  createDocumentImageAssetRuntime,
  createSqliteDocumentAssetOwnership,
  DocumentImageAssetRuntimeError,
} from '../index';

const STORE_ID = '265a3086-9470-4e32-8262-3e281f748e2f';

describe('document image asset runtime', () => {
  let root: string;
  let appDataRoot: string;
  let sourcePath: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-document-image-assets-'));
    appDataRoot = path.join(root, 'app-data');
    await fsp.mkdir(appDataRoot);
    sourcePath = path.join(root, 'source.png');
    await fsp.writeFile(
      sourcePath,
      await sharp({
        create: {
          width: 16,
          height: 9,
          channels: 4,
          background: { r: 12, g: 34, b: 56, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
    );

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY);
      ${ASSET_LEDGER_SCHEMAS.join(';')};
      INSERT INTO workspace_nodes (id) VALUES ('slides-1');
    `);
  });

  afterEach(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  function createRuntime() {
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    return createDocumentImageAssetRuntime({
      imageIngress: createManagedImageIngress({
        appDataRoot,
        storeId: STORE_ID,
        maxImageBytes: 1_000_000,
        maxImagePixels: 1_000_000,
        ledger: createSqliteLocalImageAssetLedger({ db, createAssetId: () => 'asset-1' }),
        createStagingId: () => 'document-image',
      }),
      imageLoader: createWorkspaceVerifiedImageLoader({
        db,
        storageBoundaries: [{ boundaryRoot: appDataRoot, contentRoot: paths.contentRoot }],
        maxImagePixels: 1_000_000,
      }),
      ownership: createSqliteDocumentAssetOwnership(db),
    });
  }

  it('本地图片被文档接管后不再依赖原文件，并可按 durable ownership 重新读取', async () => {
    const runtime = createRuntime();
    const adopted = await runtime.adoptLocalImage({
      documentId: 'slides-1',
      sourcePath,
      usageHint: 'slides:image',
    });
    await fsp.unlink(sourcePath);

    const reread = await runtime.readOwnedImage({
      documentId: 'slides-1',
      assetId: adopted.assetId,
    });

    expect(adopted).toMatchObject({
      assetId: 'asset-1',
      mediaType: 'image/png',
      width: 16,
      height: 9,
    });
    expect(reread).toEqual(adopted);
    expect(
      db
        .prepare(
          `
      SELECT document_node_id, asset_id, usage_hint
      FROM document_asset_links
    `
        )
        .all()
    ).toEqual([
      {
        document_node_id: 'slides-1',
        asset_id: 'asset-1',
        usage_hint: 'slides:image',
      },
    ]);
  });

  it('没有文档 ownership 的 asset 不允许借 durable id 读取', async () => {
    const runtime = createRuntime();
    const adopted = await runtime.adoptImageBytes({
      documentId: 'slides-1',
      bytes: await fsp.readFile(sourcePath),
      usageHint: 'slides:image',
    });
    db.prepare('DELETE FROM document_asset_links WHERE document_node_id = ?').run('slides-1');

    await expect(
      runtime.readOwnedImage({
        documentId: 'slides-1',
        assetId: adopted.assetId,
      })
    ).rejects.toEqual(
      new DocumentImageAssetRuntimeError('asset_not_owned', 'slides-1', adopted.assetId)
    );
  });

  it('把本地来源缺失投影为稳定 use-case 失败，不泄漏绝对路径', async () => {
    const runtime = createRuntime();
    const missingPath = path.join(root, 'missing.png');

    await expect(
      runtime.adoptLocalImage({
        documentId: 'slides-1',
        sourcePath: missingPath,
        usageHint: 'slides:image',
      })
    ).rejects.toEqual(new DocumentImageAssetRuntimeError('local_source_missing', 'slides-1', null));
    await expect(
      runtime.adoptLocalImage({
        documentId: 'slides-1',
        sourcePath: missingPath,
        usageHint: 'slides:image',
      })
    ).rejects.not.toMatchObject({ message: expect.stringContaining(missingPath) });
  });

  it('把损坏图片与像素限制投影为可区分的稳定失败', async () => {
    const runtime = createRuntime();
    const managedPaths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    await fsp.writeFile(sourcePath, 'not-an-image');

    await expect(
      runtime.adoptLocalImage({
        documentId: 'slides-1',
        sourcePath,
        usageHint: 'slides:image',
      })
    ).rejects.toEqual(new DocumentImageAssetRuntimeError('invalid_media', 'slides-1', null));

    const constrainedRuntime = createDocumentImageAssetRuntime({
      imageIngress: createManagedImageIngress({
        appDataRoot,
        storeId: STORE_ID,
        maxImageBytes: 2,
        maxImagePixels: 1_000_000,
        ledger: createSqliteLocalImageAssetLedger({ db }),
      }),
      imageLoader: createWorkspaceVerifiedImageLoader({
        db,
        storageBoundaries: [{ boundaryRoot: appDataRoot, contentRoot: managedPaths.contentRoot }],
        maxImagePixels: 1_000_000,
      }),
      ownership: createSqliteDocumentAssetOwnership(db),
    });
    await expect(
      constrainedRuntime.adoptImageBytes({
        documentId: 'slides-1',
        bytes: Buffer.from([1, 2, 3]),
        usageHint: 'slides:image',
      })
    ).rejects.toEqual(new DocumentImageAssetRuntimeError('media_limit_exceeded', 'slides-1', null));
  });
});
