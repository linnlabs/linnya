import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compareWithBaseline,
  extractStringTexts,
  findTableAccesses,
  isLowercaseSql,
  isSqlText,
  readBaseline,
  runPluginTableOwnershipRatchet,
  scanPluginTableAccess,
} from '../guards/plugin-table-ownership-ratchet';

function keys(sql: string): string[] {
  return findTableAccesses(sql).map(access => `${access.mode} ${access.table}`).sort();
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeFile(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

describe('plugin table ownership ratchet', () => {
  it('当前插件跨表访问与 baseline 精确一致', () => {
    expect(runPluginTableOwnershipRatchet()).toEqual({ added: [], removed: [], lowercaseSql: [] });
  });

  it('区分读取、写入、建表改表与外键引用；DELETE FROM 只算写入', () => {
    expect(keys(`
      INSERT INTO notes (id) SELECT n.id FROM workspace_nodes n LEFT JOIN projects p ON p.id = n.project_id
    `)).toEqual(['read projects', 'read workspace_nodes', 'write notes']);
    expect(keys('UPDATE OR IGNORE workspace_nodes SET updated_at = ? WHERE id = ?')).toEqual(['write workspace_nodes']);
    expect(keys('DELETE FROM snapshots WHERE id = ?')).toEqual(['write snapshots']);
    expect(keys('INSERT INTO t (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET id = excluded.id')).toEqual(['write t']);
    expect(keys(`
      CREATE TABLE IF NOT EXISTS cards (node_id TEXT REFERENCES "workspace_nodes"(id));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_x ON main.projects(id);
      CREATE TRIGGER trg AFTER UPDATE OF title ON workspace_nodes BEGIN SELECT 1; END;
      ALTER TABLE old_cards RENAME TO legacy_cards;
      DROP TABLE IF EXISTS gone;
    `)).toEqual([
      'reference workspace_nodes',
      'schema cards',
      'schema gone',
      'schema legacy_cards',
      'schema old_cards',
      'schema projects',
      'schema workspace_nodes',
    ]);
  });

  it('CTE 名、SQLite 内置表、注释和字符串常量不算表访问', () => {
    expect(keys(`
      WITH RECURSIVE tree(id) AS (SELECT id FROM own_nodes), picked AS (SELECT id FROM tree)
      SELECT j.value FROM picked, json_each(?) j
      -- FROM commented_out
      WHERE name != 'FROM quoted' AND EXISTS (SELECT 1 FROM sqlite_master) AND EXISTS (SELECT 1 FROM pragma_table_info('x'))
    `)).toEqual(['read own_nodes']);
  });

  it('拼接与插值都按整段读取，插值落在表名处记为动态表名', () => {
    const texts = extractStringTexts([
      "const a = 'SELECT id ' + 'FROM workspace_nodes';",
      'const b = `DELETE FROM ${table} WHERE id = ?`;',
      "const c = `SELECT * FROM own ${withNodes ? 'JOIN workspace_nodes wn ON wn.id = own.id' : ''}`;",
    ].join('\n'), 'sample.ts');
    const accesses = texts.filter(isSqlText).flatMap(text => findTableAccesses(text).map(access => `${access.mode} ${access.table}`));
    expect([...new Set(accesses)].sort()).toEqual(['read own', 'read workspace_nodes', 'write <dynamic>']);
  });

  it('小写 SQL 语句会被单独拦下，普通英文句子不会', () => {
    expect(isLowercaseSql('select id from workspace_nodes where id = ?')).toBe(true);
    expect(isLowercaseSql('update workspace_nodes set updated_at = ?')).toBe(true);
    expect(isLowercaseSql('update the deck from its source')).toBe(false);
    expect(isLowercaseSql('delete from list failed: ')).toBe(false);
  });

  it('新增条目违规，减少的条目提示收紧 baseline', () => {
    const current = [{ key: 'demo read workspace_nodes', files: ['a.ts'] }, { key: 'demo write projects', files: ['b.ts'] }];
    expect(compareWithBaseline(current, ['demo read workspace_nodes', 'demo reference projects'])).toEqual({
      added: [{ key: 'demo write projects', files: ['b.ts'] }],
      removed: ['demo reference projects'],
    });
  });

  it('baseline 拒绝重复和格式不对的条目', () => {
    expect(() => readBaseline('demo read a\ndemo read a\n')).toThrow('重复');
    expect(() => readBaseline('demo touch a\n')).toThrow('格式');
  });

  it('只扫描插件运行时源码，自有表和指向 Host 身份表的外键不计入', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-table-ratchet-'));
    temporaryRoots.push(root);
    writeFile(root, 'packages/plugins/demo/plugin.json', JSON.stringify({ id: 'demo', ownedTables: ['demo_cards'] }));
    writeFile(root, 'packages/plugins/demo/src/backend/repo.ts', [
      "export const read = 'SELECT c.id FROM demo_cards c JOIN workspace_nodes n ON n.id = c.node_id';",
      "export const write = 'INSERT INTO demo_cards (id) VALUES (?)';",
      "export const ddl = 'CREATE TABLE IF NOT EXISTS demo_cards (node_id TEXT REFERENCES workspace_nodes(id), other TEXT REFERENCES other_cards(id))';",
    ].join('\n'));
    writeFile(root, 'packages/plugins/demo/src/backend/__tests__/repo.test.ts', "const x = 'DELETE FROM projects';");
    writeFile(root, 'packages/plugins/demo/src/backend/repo.spec.ts', "const y = 'UPDATE projects SET name = ?';");
    writeFile(root, 'packages/plugins/demo/dev/tool.ts', "const z = 'SELECT * FROM projects';");

    expect(scanPluginTableAccess(root)).toEqual({
      accesses: [
        { key: 'demo read workspace_nodes', files: ['packages/plugins/demo/src/backend/repo.ts'] },
        { key: 'demo reference other_cards', files: ['packages/plugins/demo/src/backend/repo.ts'] },
      ],
      lowercaseSql: [],
    });
  });
});
