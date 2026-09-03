import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ASSET_LEDGER_SCHEMAS } from '../../asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import {
  ensureManagedImageStoreBinding,
  ManagedImageStoreBindingError,
  readManagedImageStoreBinding,
} from '../index';

describe('managed image store binding', () => {
  it('creates one durable identity and returns the same identity after restart', () => {
    const db = new Database(':memory:');
    db.exec(ASSET_LEDGER_SCHEMAS.join(';'));
    const storeId = 'd16f79d0-a724-4aef-8bc7-3c45ec350741';
    try {
      expect(ensureManagedImageStoreBinding({
        db,
        createStoreId: () => storeId,
        createdAt: 1,
      })).toEqual({ storeId });
      expect(ensureManagedImageStoreBinding({
        db,
        createStoreId: () => '5f719b53-a126-4d17-9f2c-2d445539f894',
        createdAt: 2,
      })).toEqual({ storeId });
      expect(readManagedImageStoreBinding(db)).toEqual({ storeId });
    } finally {
      db.close();
    }
  });

  it('rejects a missing or path-shaped persisted identity', () => {
    const db = new Database(':memory:');
    db.exec(ASSET_LEDGER_SCHEMAS.join(';'));
    try {
      expect(() => readManagedImageStoreBinding(db)).toThrowError(
        new ManagedImageStoreBindingError('binding_missing'),
      );
      db.prepare(`
        INSERT INTO asset_storage_bindings (storage_kind, storage_id, created_at)
        VALUES ('managed_image_v2', '../outside', 1)
      `).run();
      expect(() => readManagedImageStoreBinding(db)).toThrowError(
        new ManagedImageStoreBindingError('invalid_store_id'),
      );
    } finally {
      db.close();
    }
  });
});
