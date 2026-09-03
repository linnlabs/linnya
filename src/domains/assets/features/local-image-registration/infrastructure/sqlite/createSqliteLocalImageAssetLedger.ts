import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  LocalImageAssetFacts,
  LocalImageAssetLedgerPort,
  RegisteredLocalImageAsset,
} from '../../definitions/localImageAssetRegistration';
import { LocalImageAssetRegistrationError } from '../../definitions/localImageAssetRegistration';

interface LocalImageAssetRow {
  readonly id: string;
  readonly uri: string;
  readonly media_type: string | null;
  readonly size_bytes: number | null;
  readonly width_px: number | null;
  readonly height_px: number | null;
  readonly sha256: string | null;
  readonly storage_status: string;
  readonly local_path: string | null;
  readonly created_at: number;
}

function assertCompatible(row: LocalImageAssetRow, facts: LocalImageAssetFacts): void {
  if (
    row.uri !== facts.uri
    || row.media_type !== facts.mediaType
    || row.size_bytes !== facts.byteLength
    || row.width_px !== facts.width
    || row.height_px !== facts.height
    || row.sha256 !== facts.sha256
    || row.storage_status !== 'local'
  ) {
    throw new LocalImageAssetRegistrationError(
      'ledger_conflict',
      `生成图片 URI 已存在但账本事实冲突: ${facts.uri}`,
    );
  }
}

function toRegistered(row: LocalImageAssetRow): RegisteredLocalImageAsset {
  if (
    (row.media_type !== 'image/jpeg' && row.media_type !== 'image/png' && row.media_type !== 'image/webp')
    || row.size_bytes === null
    || row.width_px === null
    || row.height_px === null
    || row.sha256 === null
    || row.local_path === null
  ) {
    throw new LocalImageAssetRegistrationError(
      'ledger_conflict',
      `生成图片账本不完整: ${row.id}`,
    );
  }
  return {
    assetId: row.id,
    uri: row.uri,
    mediaType: row.media_type,
    byteLength: row.size_bytes,
    width: row.width_px,
    height: row.height_px,
    sha256: row.sha256,
    localPath: row.local_path,
    createdAt: row.created_at,
  };
}

export function createSqliteLocalImageAssetLedger(params: {
  readonly db: Database.Database;
  readonly createAssetId?: () => string;
}): LocalImageAssetLedgerPort {
  const insertAsset = params.db.prepare(`
    INSERT OR IGNORE INTO assets (
      id, uri, media_type, size_bytes, width_px, height_px, sha256,
      storage_status, local_path, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)
  `);
  const selectByUri = params.db.prepare<[string], LocalImageAssetRow>(`
    SELECT id, uri, media_type, size_bytes, width_px, height_px, sha256,
           storage_status, local_path, created_at
    FROM assets
    WHERE uri = ?
  `);
  const updateLocalPath = params.db.prepare(`
    UPDATE assets
    SET local_path = ?
    WHERE id = ?
  `);
  const createAssetId = params.createAssetId ?? randomUUID;

  return {
    registerLocalImage(facts): RegisteredLocalImageAsset {
      insertAsset.run(
        createAssetId(),
        facts.uri,
        facts.mediaType,
        facts.byteLength,
        facts.width,
        facts.height,
        facts.sha256,
        facts.localPath,
        facts.createdAt,
      );
      const row = selectByUri.get(facts.uri);
      if (!row) {
        throw new LocalImageAssetRegistrationError(
          'ledger_conflict',
          `生成图片登记失败: ${facts.uri}`,
        );
      }
      assertCompatible(row, facts);

      // 相同内容再次由生成器产出时，canonical asset 跟随最新可用的宿主文件。
      if (row.local_path !== facts.localPath) {
        updateLocalPath.run(facts.localPath, row.id);
        return toRegistered({ ...row, local_path: facts.localPath });
      }
      return toRegistered(row);
    },
  };
}
