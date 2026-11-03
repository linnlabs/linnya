import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ASSET_LEDGER_SCHEMAS } from '../../asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { listDocumentAssetByteFacts, registerDocumentAssetOwnership, releaseDocumentAssetOwnership, reconcileDocumentAssetOwnership } from 'src/plugin-sdk/backend/documentAssetOwnership';
let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('a'), ('b')");
  for (const schema of ASSET_LEDGER_SCHEMAS) db.exec(schema);
  db.prepare('INSERT INTO assets(id, uri, storage_status, created_at, size_bytes) VALUES (?, ?, ?, ?, ?)').run('image', 'asset:image', 'local', 1, 4096);
});
afterEach(() => db.close());
it('reads only owned byte facts in the same transaction and rolls ownership changes back with history pruning', () => {
  const read = (documentId: string) => listDocumentAssetByteFacts({ database: db, documentId, assetIds: ['image', 'image'] });
  expect(() => read('a')).toThrow('missing');
  db.transaction(() => { registerDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: ['image'], usageHint: 'history' }); expect(read('a')).toEqual([{ assetId: 'image', byteLength: 4096 }]); })();
  db.transaction(() => registerDocumentAssetOwnership({ database: db, documentId: 'b', assetIds: ['image'], usageHint: 'content' }))();
  expect(() => db.transaction(() => { releaseDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: ['image'] }); throw new Error('prune failed'); })()).toThrow('prune failed');
  expect(read('a')).toHaveLength(1);
  releaseDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: ['image'] });
  expect(() => read('a')).toThrow('missing'); expect(read('b')).toHaveLength(1);
});
it('rejects incomplete byte facts instead of admitting a zero-size history asset', () => {
  db.transaction(() => registerDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: ['image'], usageHint: 'history' }))();
  db.prepare('UPDATE assets SET size_bytes = NULL WHERE id = ?').run('image');
  expect(() => listDocumentAssetByteFacts({ database: db, documentId: 'a', assetIds: ['image'] })).toThrow();
});

it('reconciles one document complete reachability set atomically while preserving shared ownership', () => {
  db.prepare('INSERT INTO assets(id, uri, storage_status, created_at, size_bytes) VALUES (?, ?, ?, ?, ?)').run('other', 'asset:other', 'local', 1, 2048);
  db.transaction(() => { registerDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: ['image', 'other'], usageHint: 'old' }); registerDocumentAssetOwnership({ database: db, documentId: 'b', assetIds: ['image'], usageHint: 'shared' }); })();
  expect(() => reconcileDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: [], usageHint: 'history' })).toThrow('transaction');
  expect(() => db.transaction(() => { reconcileDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: [], usageHint: 'history' }); throw new Error('history rollback'); })()).toThrow('rollback');
  expect(listDocumentAssetByteFacts({ database: db, documentId: 'a', assetIds: ['image', 'other'] })).toHaveLength(2);
  db.transaction(() => reconcileDocumentAssetOwnership({ database: db, documentId: 'a', assetIds: ['other'], usageHint: 'history' }))();
  expect(() => listDocumentAssetByteFacts({ database: db, documentId: 'a', assetIds: ['image'] })).toThrow();
  expect(listDocumentAssetByteFacts({ database: db, documentId: 'b', assetIds: ['image'] })).toHaveLength(1);
});
