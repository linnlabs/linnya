import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import {
  createManagedSvgAssetRuntime,
  createSqliteManagedSvgAssetLedger,
} from 'src/domains/assets/features/managed-svg-asset';
import { createSqliteDocumentAssetOwnership } from '../../document-assets';
import {
  createDocumentSvgAssetRuntime,
  DocumentSvgAssetRuntimeError,
} from '../index';

const STORE_ID = '265a3086-9470-4e32-8262-3e281f748e2f';
const CANONICAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#2563EB"/></svg>';

describe('document SVG asset runtime', () => {
  let root: string;
  let appDataRoot: string;
  let db: Database.Database;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-document-svg-assets-'));
    appDataRoot = path.join(root, 'app-data');
    await fsp.mkdir(appDataRoot);
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY);
      ${ASSET_LEDGER_SCHEMAS.join(';')};
      INSERT INTO workspace_nodes (id) VALUES ('slides-1'), ('slides-2');
    `);
  });

  afterEach(async () => {
    db.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  function createRuntime(maxSvgBytes = 64 * 1024) {
    return createDocumentSvgAssetRuntime({
      svgAssets: createManagedSvgAssetRuntime({
        appDataRoot,
        storeId: STORE_ID,
        maxSvgBytes,
        ledger: createSqliteManagedSvgAssetLedger({
          db,
          createAssetId: () => 'svg-asset-1',
        }),
        createStagingId: () => 'document-svg',
      }),
      ownership: createSqliteDocumentAssetOwnership(db),
    });
  }

  it('把 canonical SVG 接管为无像素尺寸的文档 asset，并按 durable ownership 回读', async () => {
    const runtime = createRuntime();
    const contentHash = sha256(CANONICAL_SVG);
    const adopted = await runtime.adoptCanonicalSvg({
      documentId: 'slides-1',
      canonicalSvg: CANONICAL_SVG,
      contentHash,
      usageHint: 'slides:svg-graphic',
    });

    await expect(
      runtime.readOwnedSvg({ documentId: 'slides-1', assetId: adopted.assetId })
    ).resolves.toEqual(adopted);
    expect(adopted).toEqual({
      assetId: 'svg-asset-1',
      mediaType: 'image/svg+xml',
      byteLength: Buffer.byteLength(CANONICAL_SVG, 'utf8'),
      sha256: contentHash,
      canonicalSvg: CANONICAL_SVG,
    });
    expect(
      db
        .prepare(
          'SELECT media_type, width_px, height_px, sha256 FROM assets WHERE id = ?'
        )
        .get(adopted.assetId)
    ).toEqual({
      media_type: 'image/svg+xml',
      width_px: null,
      height_px: null,
      sha256: contentHash,
    });
    expect(
      db
        .prepare(
          'SELECT document_node_id, asset_id, usage_hint FROM document_asset_links'
        )
        .all()
    ).toEqual([
      {
        document_node_id: 'slides-1',
        asset_id: 'svg-asset-1',
        usage_hint: 'slides:svg-graphic',
      },
    ]);
  });

  it('不允许另一个文档凭 asset id 越过 ownership 读取', async () => {
    const runtime = createRuntime();
    const adopted = await runtime.adoptCanonicalSvg({
      documentId: 'slides-1',
      canonicalSvg: CANONICAL_SVG,
      contentHash: sha256(CANONICAL_SVG),
      usageHint: 'slides:svg-graphic',
    });

    await expect(
      runtime.readOwnedSvg({ documentId: 'slides-2', assetId: adopted.assetId })
    ).rejects.toEqual(
      new DocumentSvgAssetRuntimeError('asset_not_owned', 'slides-2', adopted.assetId)
    );
  });

  it('拒绝 hash 不一致和超出预算的输入，不建立 asset 或 ownership', async () => {
    await expect(
      createRuntime().adoptCanonicalSvg({
        documentId: 'slides-1',
        canonicalSvg: CANONICAL_SVG,
        contentHash: '0'.repeat(64),
        usageHint: 'slides:svg-graphic',
      })
    ).rejects.toEqual(
      new DocumentSvgAssetRuntimeError('invalid_canonical_content', 'slides-1', null)
    );
    await expect(
      createRuntime(8).adoptCanonicalSvg({
        documentId: 'slides-1',
        canonicalSvg: CANONICAL_SVG,
        contentHash: sha256(CANONICAL_SVG),
        usageHint: 'slides:svg-graphic',
      })
    ).rejects.toEqual(
      new DocumentSvgAssetRuntimeError('content_limit_exceeded', 'slides-1', null)
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM document_asset_links').get()).toEqual({
      count: 0,
    });
  });

  it('受管 bytes 被篡改后明确报告完整性失败，不回退到原 authoring source', async () => {
    const runtime = createRuntime();
    const adopted = await runtime.adoptCanonicalSvg({
      documentId: 'slides-1',
      canonicalSvg: CANONICAL_SVG,
      contentHash: sha256(CANONICAL_SVG),
      usageHint: 'slides:svg-graphic',
    });
    const row = db
      .prepare<[string], { readonly local_path: string }>(
        'SELECT local_path FROM assets WHERE id = ?'
      )
      .get(adopted.assetId);
    if (!row) throw new Error('Expected managed SVG asset row.');
    await fsp.writeFile(row.local_path, '<svg/>');

    await expect(
      runtime.readOwnedSvg({ documentId: 'slides-1', assetId: adopted.assetId })
    ).rejects.toEqual(
      new DocumentSvgAssetRuntimeError(
        'managed_asset_integrity_failed',
        'slides-1',
        adopted.assetId
      )
    );
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
