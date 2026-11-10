import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentImageAssetSchema } from '@app/schemas';
import { inspectImageBytes } from 'src/shared/media/image-inspection';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { createSqliteLocalImageAssetLedger } from 'src/domains/assets/features/local-image-registration';
import { createManagedImageIngress } from 'src/domains/assets/features/managed-image-ingress';
import {
  createManagedImageContentIdentity,
  createManagedImageStoragePaths,
} from 'src/domains/assets/shared/managed-image-storage';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import {
  createDocumentImageAssetRuntime,
  createSqliteDocumentAssetOwnership,
  DocumentImageAssetRuntimeError,
} from '../index';
import { registerDocumentAssetOwnership } from '../../document-assets';

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

  function createImageLoader() {
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    return createWorkspaceVerifiedImageLoader({
      db,
      storage: { appDataRoot, contentRoot: paths.contentRoot },
      maxImagePixels: 1_000_000,
    });
  }
  function createRuntime() {
    return createDocumentImageAssetRuntime({
      imageIngress: createManagedImageIngress({
        appDataRoot,
        storeId: STORE_ID,
        maxImageBytes: 1_000_000,
        maxImagePixels: 1_000_000,
        ledger: createSqliteLocalImageAssetLedger({ db, createAssetId: () => 'asset-1' }),
        createStagingId: () => 'document-image',
      }),
      imageLoader: createImageLoader(),
      ownership: createSqliteDocumentAssetOwnership(db),
    });
  }

  it('准备图片不提前建立文档归属，归属与内容提交一起回滚或成功', async () => {
    const runtime = createRuntime();
    const prepared = await runtime.prepareImageBytes({
      documentId: 'slides-1',
      bytes: await fsp.readFile(sourcePath),
    });
    expect(db.prepare('SELECT * FROM document_asset_links').all()).toEqual([]);
    const register = () =>
      registerDocumentAssetOwnership({
        database: db,
        documentId: 'slides-1',
        assetIds: [prepared.assetId],
        usageHint: 'image',
      });
    expect(register).toThrow('transaction');
    expect(() =>
      db.transaction(() => {
        register();
        throw new Error('content rejected');
      })()
    ).toThrow('content rejected');
    expect(db.prepare('SELECT * FROM document_asset_links').all()).toEqual([]);
    db.transaction(register)();
    expect(
      await runtime.readOwnedImage({ documentId: 'slides-1', assetId: prepared.assetId })
    ).toEqual(prepared);
  });

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
      displayWidth: 16,
      displayHeight: 9,
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

  it.each([6, 8])(
    '准备和重读方向%s的JPEG保留编码身份，同时提供浏览器使用的竖向显示尺寸',
    async orientation => {
      const bytes = await sharp({
        create: { width: 120, height: 80, channels: 3, background: '#349756' },
      })
        .jpeg()
        .withMetadata({ orientation })
        .toBuffer();
      const inspected = await inspectImageBytes({ bytes, maxImagePixels: 1_000_000 });
      expect(inspected).toMatchObject({
        width: 120,
        height: 80,
        displayWidth: 80,
        displayHeight: 120,
      });
      const prepared = DocumentImageAssetSchema.parse(
        await createRuntime().prepareImageBytes({ documentId: 'slides-1', bytes })
      );
      expect(prepared).toMatchObject({
        width: 120,
        height: 80,
        displayWidth: 80,
        displayHeight: 120,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      expect(Buffer.from(prepared.dataUri.split(',')[1], 'base64')).toEqual(bytes);
      db.transaction(() =>
        registerDocumentAssetOwnership({
          database: db,
          documentId: 'slides-1',
          assetIds: [prepared.assetId],
          usageHint: 'image',
        })
      )();
      const reopened = DocumentImageAssetSchema.parse(
        await createRuntime().readOwnedImage({ documentId: 'slides-1', assetId: prepared.assetId })
      );
      expect(reopened).toEqual(prepared);
      expect(
        db.prepare('SELECT width_px, height_px FROM assets WHERE id=?').get(prepared.assetId)
      ).toEqual({ width_px: 120, height_px: 80 });
    }
  );

  it('既有竖拍资产只含旧编码尺寸的账本与durable期望仍可读取，不迁移或重写身份', async () => {
    const bytes = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#2375a4' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const identity = createManagedImageContentIdentity({
      paths: createManagedImageStoragePaths(appDataRoot, STORE_ID),
      sha256,
      mediaType: 'image/jpeg',
    });
    await fsp.mkdir(path.dirname(identity.localPath), { recursive: true });
    await fsp.writeFile(identity.localPath, bytes);
    const legacy = createSqliteLocalImageAssetLedger({
      db,
      createAssetId: () => 'legacy-oriented',
    }).registerLocalImage({
      ...identity,
      mediaType: 'image/jpeg',
      byteLength: bytes.length,
      width: 120,
      height: 80,
      sha256,
      createdAt: 1,
    });
    db.transaction(() =>
      registerDocumentAssetOwnership({
        database: db,
        documentId: 'slides-1',
        assetIds: [legacy.assetId],
        usageHint: 'legacy',
      })
    )();
    const before = db.prepare('SELECT * FROM assets WHERE id=?').get(legacy.assetId);
    const expected = {
      mediaType: 'image/jpeg' as const,
      byteLength: bytes.length,
      width: 120,
      height: 80,
      sha256,
    };
    const [verified] = await createImageLoader().loadImages([
      { assetId: legacy.assetId, expected },
    ]);
    expect(verified).toMatchObject({ ...expected, displayWidth: 80, displayHeight: 120 });
    expect(
      DocumentImageAssetSchema.parse(
        await createRuntime().readOwnedImage({ documentId: 'slides-1', assetId: legacy.assetId })
      )
    ).toMatchObject({ ...expected, displayWidth: 80, displayHeight: 120 });
    expect(db.prepare('SELECT * FROM assets WHERE id=?').get(legacy.assetId)).toEqual(before);
    await expect(fsp.readFile(identity.localPath)).resolves.toEqual(bytes);
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
        storage: { appDataRoot, contentRoot: managedPaths.contentRoot },
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
