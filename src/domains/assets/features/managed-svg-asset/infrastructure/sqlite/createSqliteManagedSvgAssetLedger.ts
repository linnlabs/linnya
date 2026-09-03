import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  MANAGED_SVG_MEDIA_TYPE,
  ManagedSvgAssetError,
  type ManagedSvgAssetFacts,
  type ManagedSvgAssetLedgerPort,
  type RegisteredManagedSvgAsset,
} from '../../definitions/managedSvgAsset';

interface ManagedSvgAssetRow {
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

function toRegistered(row: ManagedSvgAssetRow): RegisteredManagedSvgAsset {
  if (
    row.media_type !== MANAGED_SVG_MEDIA_TYPE ||
    row.size_bytes === null ||
    row.width_px !== null ||
    row.height_px !== null ||
    row.sha256 === null ||
    row.storage_status !== 'local' ||
    row.local_path === null
  ) {
    throw new ManagedSvgAssetError('storage_conflict');
  }
  return {
    assetId: row.id,
    uri: row.uri,
    mediaType: MANAGED_SVG_MEDIA_TYPE,
    byteLength: row.size_bytes,
    sha256: row.sha256,
    localPath: row.local_path,
    createdAt: row.created_at,
  };
}

function assertCompatible(row: RegisteredManagedSvgAsset, facts: ManagedSvgAssetFacts): void {
  if (
    row.uri !== facts.uri ||
    row.mediaType !== facts.mediaType ||
    row.byteLength !== facts.byteLength ||
    row.sha256 !== facts.sha256 ||
    row.localPath !== facts.localPath
  ) {
    throw new ManagedSvgAssetError('storage_conflict');
  }
}

export function createSqliteManagedSvgAssetLedger(params: {
  readonly db: Database.Database;
  readonly createAssetId?: () => string;
}): ManagedSvgAssetLedgerPort {
  const insert = params.db.prepare(`
    INSERT OR IGNORE INTO assets (
      id, uri, media_type, size_bytes, width_px, height_px, sha256,
      storage_status, local_path, created_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'local', ?, ?)
  `);
  const findByUri = params.db.prepare<[string], ManagedSvgAssetRow>(`
    SELECT id, uri, media_type, size_bytes, width_px, height_px, sha256,
           storage_status, local_path, created_at
    FROM assets
    WHERE uri = ?
  `);
  const findById = params.db.prepare<[string], ManagedSvgAssetRow>(`
    SELECT id, uri, media_type, size_bytes, width_px, height_px, sha256,
           storage_status, local_path, created_at
    FROM assets
    WHERE id = ?
  `);
  const createAssetId = params.createAssetId ?? randomUUID;

  return {
    register(facts): RegisteredManagedSvgAsset {
      insert.run(
        createAssetId(),
        facts.uri,
        facts.mediaType,
        facts.byteLength,
        facts.sha256,
        facts.localPath,
        facts.createdAt
      );
      const row = findByUri.get(facts.uri);
      if (!row) throw new ManagedSvgAssetError('storage_conflict');
      const registered = toRegistered(row);
      assertCompatible(registered, facts);
      return registered;
    },
    findById(assetId): RegisteredManagedSvgAsset | null {
      const row = findById.get(assetId);
      return row ? toRegistered(row) : null;
    },
  };
}
