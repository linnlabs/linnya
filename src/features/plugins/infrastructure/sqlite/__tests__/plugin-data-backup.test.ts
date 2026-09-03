import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PluginDataBackup } from '../plugin-data-backup';

interface TableRow {
  name: string;
}

function listBackupTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '__backup_%' ORDER BY name")
    .all() as TableRow[];
  return rows.map((row) => row.name);
}

describe('PluginDataBackup', () => {
  let db: Database.Database;
  let backup: PluginDataBackup;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE plugin_owned (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO plugin_owned (id, value) VALUES ('row-1', 'before');
    `);
    backup = new PluginDataBackup(db);
  });

  afterEach(() => {
    db.close();
  });

  it('快照后可以恢复被修改的数据行', () => {
    const snapshot = backup.snapshot('demo', ['plugin_owned']);

    db.exec(`
      DELETE FROM plugin_owned;
      INSERT INTO plugin_owned (id, value) VALUES ('row-2', 'after');
    `);

    backup.restore(snapshot);

    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'before' },
    ]);
    backup.discard(snapshot);
    expect(listBackupTables(db)).toEqual([]);
  });

  it('discard 会清理影子表', () => {
    const snapshot = backup.snapshot('demo', ['plugin_owned']);

    expect(listBackupTables(db).length).toBe(1);
    backup.discard(snapshot);

    expect(listBackupTables(db)).toEqual([]);
  });

  it('ownedTables 为空时不创建影子表', () => {
    const snapshot = backup.snapshot('stateless', []);

    expect(snapshot.tables).toEqual([]);
    expect(listBackupTables(db)).toEqual([]);
    expect(() => backup.restore(snapshot)).not.toThrow();
    expect(() => backup.discard(snapshot)).not.toThrow();
  });

  it('ownedTables 声明的表不存在时 fail-fast，避免契约漂移被静默跳过', () => {
    expect(() => backup.snapshot('demo', ['plugin_owned', 'missing_owned'])).toThrow(
      '插件 ownedTables 声明的表不存在: demo/missing_owned',
    );
    expect(listBackupTables(db)).toEqual([]);
  });
});
