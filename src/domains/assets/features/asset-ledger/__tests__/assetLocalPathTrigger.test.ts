import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSET_LEDGER_SCHEMAS } from '../infrastructure/sqlite/schemas/assetLedger.schema';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createLedger(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
  `);
  for (const statement of ASSET_LEDGER_SCHEMAS) db.exec(statement);
  return db;
}

describe('assets.local_path 触发器', () => {
  it('写入与改写都只接受相对 AppData Root 的持久路径', () => {
    const db = createLedger();
    const insert = db.prepare(`
      INSERT INTO assets (id, uri, storage_status, local_path, created_at)
      VALUES (?, ?, 'local', ?, 1)
    `);
    insert.run('relative', '/Resources/Attachments/relative.png', 'ConversationAttachments/v2/a.png');
    insert.run('remote', '/Resources/Attachments/remote.png', null);

    for (const [index, invalid] of [
      '',
      '/srv/linnya/ConversationAttachments/v2/a.png',
      'C:\\Linnya\\ConversationAttachments\\a.png',
      'C:/Linnya/a.png',
      'ConversationAttachments//a.png',
      'ConversationAttachments/./a.png',
      'ConversationAttachments/../a.png',
      '..',
      'ConversationAttachments/a.png/',
    ].entries()) {
      expect(
        () => insert.run(`invalid-${index}`, `/Resources/Attachments/invalid-${index}.png`, invalid),
        invalid,
      ).toThrow('assets.local_path must be a path relative to the AppData root');
    }

    expect(() => db.prepare("UPDATE assets SET local_path = '/tmp/a.png' WHERE id = 'relative'").run())
      .toThrow('assets.local_path must be a path relative to the AppData root');
    db.prepare("UPDATE assets SET local_path = 'ConversationAttachments/v2/b.png' WHERE id = 'relative'").run();
    expect(db.prepare('SELECT id, local_path FROM assets ORDER BY id').all()).toEqual([
      { id: 'relative', local_path: 'ConversationAttachments/v2/b.png' },
      { id: 'remote', local_path: null },
    ]);
  });
});
