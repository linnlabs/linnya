import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  isManagedImageStoreId,
} from '../../../../shared/managed-image-storage';
import {
  MANAGED_IMAGE_STORAGE_KIND,
  ManagedImageStoreBindingError,
  type ManagedImageStoreBinding,
} from '../../definitions/managedImageStoreBinding';

interface StorageBindingRow {
  readonly storage_id: string;
}

function requireStoreId(storeId: string): string {
  if (!isManagedImageStoreId(storeId)) {
    throw new ManagedImageStoreBindingError('invalid_store_id');
  }
  return storeId;
}

export function ensureManagedImageStoreBinding(params: {
  readonly db: Database.Database;
  readonly createStoreId?: () => string;
  readonly createdAt?: number;
}): ManagedImageStoreBinding {
  return params.db.transaction((): ManagedImageStoreBinding => {
    const existing = params.db.prepare<[string], StorageBindingRow>(`
      SELECT storage_id
      FROM asset_storage_bindings
      WHERE storage_kind = ?
    `).get(MANAGED_IMAGE_STORAGE_KIND);
    if (existing) return { storeId: requireStoreId(existing.storage_id) };

    const storeId = requireStoreId((params.createStoreId ?? randomUUID)());
    params.db.prepare(`
      INSERT INTO asset_storage_bindings (storage_kind, storage_id, created_at)
      VALUES (?, ?, ?)
    `).run(MANAGED_IMAGE_STORAGE_KIND, storeId, params.createdAt ?? Date.now());
    return { storeId };
  })();
}

export function readManagedImageStoreBinding(
  db: Database.Database,
): ManagedImageStoreBinding {
  const row = db.prepare<[string], StorageBindingRow>(`
    SELECT storage_id
    FROM asset_storage_bindings
    WHERE storage_kind = ?
  `).get(MANAGED_IMAGE_STORAGE_KIND);
  if (!row) throw new ManagedImageStoreBindingError('binding_missing');
  return { storeId: requireStoreId(row.storage_id) };
}
