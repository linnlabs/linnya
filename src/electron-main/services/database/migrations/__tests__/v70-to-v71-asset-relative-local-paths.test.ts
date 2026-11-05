import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema';
import { migrateV70ToV71AssetRelativeLocalPaths } from '../v70-to-v71-asset-relative-local-paths';

const STORE_ID = '0f81bb43-dd9a-49e4-a3a1-bfb3bbb13ea7';
const SHA = 'ab'.repeat(32);
const RELATIVE = `ConversationAttachments/v2/stores/${STORE_ID}/content/ab/${SHA}.png`;
const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createV70Ledger(rows: ReadonlyArray<readonly [string, string | null]>): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
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
    )
  `);
  const insert = db.prepare(`
    INSERT INTO assets (id, uri, storage_status, local_path, created_at) VALUES (?, ?, 'local', ?, 1)
  `);
  for (const [id, localPath] of rows) insert.run(id, `/Resources/Attachments/${id}`, localPath);
  // 启动时表阶段先于迁移建立触发器；迁移写入的相对路径必须能通过它。
  db.exec('CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY); CREATE TABLE projects (id TEXT PRIMARY KEY);');
  for (const statement of ASSET_LEDGER_SCHEMAS) db.exec(statement);
  return db;
}

it('截取受管内容后缀，换掉任何绝对前缀与 Windows 分隔符', () => {
  const db = createV70Ledger([
    ['mac', `/opt/app-data/Linnya/${RELATIVE}`],
    ['dev-copy', `/srv/checkouts/other/_dev_data/${RELATIVE.replace('.png', '.webp')}`],
    ['windows', `D:\\LinnyaData\\Roaming\\Linnya\\${RELATIVE.replace(/\//g, '\\').replace('.png', '.jpg')}`],
    ['remote', null],
  ]);

  db.transaction(() => migrateV70ToV71AssetRelativeLocalPaths(db))();

  expect(db.prepare('SELECT id, local_path FROM assets ORDER BY id').all()).toEqual([
    { id: 'dev-copy', local_path: RELATIVE.replace('.png', '.webp') },
    { id: 'mac', local_path: RELATIVE },
    { id: 'remote', local_path: null },
    { id: 'windows', local_path: RELATIVE.replace('.png', '.jpg') },
  ]);
});

it('遇到不在受管内容目录内的行整体失败，随外层迁移事务回滚', () => {
  const legacyV1 = `/srv/linnya/ConversationAttachments/v1/content/ab/${SHA}.png`;
  const db = createV70Ledger([
    ['a-valid', `/srv/linnya/${RELATIVE}`],
    ['b-legacy', legacyV1],
  ]);

  expect(() => db.transaction(() => migrateV70ToV71AssetRelativeLocalPaths(db))())
    .toThrow('asset b-legacy');
  expect(db.prepare('SELECT id, local_path FROM assets ORDER BY id').all()).toEqual([
    { id: 'a-valid', local_path: `/srv/linnya/${RELATIVE}` },
    { id: 'b-legacy', local_path: legacyV1 },
  ]);
});
