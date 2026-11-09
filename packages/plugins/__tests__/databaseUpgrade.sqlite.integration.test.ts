import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { SCHEMA_VERSION } from 'src/electron-main/services/database/migrations';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { PluginStateService } from 'src/features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginUpgradeRunner } from 'src/features/plugins/infrastructure/sqlite/plugin-upgrade.runner';
import { SLIDES_PLUGIN_META, SLIDES_OWNED_TABLES } from '../slides/src/shared';
import { slidesPluginMigrations } from '../slides/src/backend/persistence/slidesPluginMigrations';

interface SchemaObject {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

function canonicalSql(sql: string | null): string | null {
  // 保留字符串字面量；只忽略注释、空白和 SQL 标识符的引号/大小写差异。
  return sql?.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[\w]+|[^\s]/g)
    ?.filter(token => !token.startsWith('--') && !token.startsWith('/*'))
    .map(token => token.startsWith("'") ? token : token.replace(/^["`\[]|["`\]]$/g, '').toLowerCase())
    .join(' ') ?? null;
}

function readStructure(db: Database.Database): Map<string, unknown> {
  const result = new Map<string, unknown>();
  // sqlite_sequence 是 SQLite 的数据账本；自动索引仍需比较，以覆盖 UNIQUE/主键约束。
  const objects = db.prepare<[], SchemaObject>(
    "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name != 'sqlite_sequence' ORDER BY type,name",
  ).all();
  for (const object of objects) {
    const key = `${object.type}:${object.name}`;
    const name = object.name.replaceAll('"', '""');
    result.set(key, {
      table: object.tbl_name,
      sql: canonicalSql(object.sql),
      ...(object.type === 'table' ? {
        columns: db.prepare(`PRAGMA table_xinfo("${name}")`).all(),
        foreignKeys: db.prepare(`PRAGMA foreign_key_list("${name}")`).all(),
      } : {}),
      ...(object.type === 'index' ? { columns: db.prepare(`PRAGMA index_xinfo("${name}")`).all() } : {}),
    });
  }
  return result;
}

function bootstrapSlides(db: Database.Database): void {
  new PluginStateService(db).ensureBuiltinInstalled([SLIDES_PLUGIN_META]);
  const result = new PluginUpgradeRunner(db, { appVersion: '0.1.0' }).run({
    pluginId: SLIDES_PLUGIN_META.id, targetVersion: SLIDES_PLUGIN_META.version,
    ownedTables: SLIDES_OWNED_TABLES, migrations: slidesPluginMigrations,
  });
  expect(['upgraded', 'skipped'], 'Slides lifecycle must complete').toContain(result.status);
}

const fixture = join(import.meta.dirname, 'fixtures/database-0.1.0/workspace.sqlite');

it('upgrades the released v68 database to the same complete structure as a fresh database and preserves synthetic facts', () => {
  expect(statSync(fixture).size).toBeLessThan(2 * 1024 * 1024);
  const original = new Database(fixture, { readonly: true });
  try {
    expect(original.pragma('user_version', { simple: true })).toBe(68);
    expect(original.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { original.close(); }
  const directory = mkdtempSync(join(tmpdir(), 'linnya-schema-upgrade-'));
  const fresh = new DatabaseService(join(directory, 'fresh.sqlite'));
  const upgraded = new DatabaseService(join(directory, 'upgraded.sqlite'));
  try {
    copyFileSync(fixture, join(directory, 'upgraded.sqlite'));
    fresh.initialize({ lifecycleBootstrap: bootstrapSlides });
    upgraded.initialize({ lifecycleBootstrap: bootstrapSlides });
    const db = upgraded.getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    const expected = readStructure(fresh.getDb());
    const actual = readStructure(db);
    expect([...actual.keys()], 'schema object inventory').toEqual([...expected.keys()]);
    for (const [name, structure] of expected) {
      expect(actual.get(name), `schema difference in ${name}`).toEqual(structure);
    }
    expect(db.prepare("SELECT name FROM projects WHERE id='fixture-project'").get())
      .toEqual({ name: 'Synthetic upgrade project' });
    expect(db.prepare('SELECT content_json FROM document_versions').get())
      .toMatchObject({ content_json: expect.stringContaining('Synthetic baseline') });
    expect(db.prepare('SELECT new_markdown,revision FROM markdown_block_pending_revisions').get())
      .toEqual({ new_markdown: 'Synthetic proposal', revision: 1 });
    expect(db.prepare('SELECT payload FROM events').get())
      .toEqual({ payload: '{"content":"Synthetic answer"}' });
    expect(db.prepare('SELECT payload_json FROM subrun_trace_items').get())
      .toEqual({ payload_json: '{"content":"Synthetic child answer"}' });
    expect(db.prepare('SELECT title,current_revision FROM presentation_documents').get())
      .toEqual({ title: 'Synthetic deck', current_revision: 2 });
    expect(db.prepare('SELECT source_checkpoint FROM presentation_revisions ORDER BY revision').all())
      .toHaveLength(2);
    for (const table of SLIDES_OWNED_TABLES) {
      const row = db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM "${table}"`).get();
      expect(row?.count, `preserved data in ${table}`).toBeGreaterThan(0);
    }
    expect(db.prepare('SELECT schema_version FROM installed_plugins WHERE plugin_id=?').get(SLIDES_PLUGIN_META.id))
      .toEqual({ schema_version: slidesPluginMigrations.at(-1)?.version });
    // 升级后的库直接可记行动账本，外键指向发行夹具里已有的项目与文档。
    const node = db.prepare<[], { id: string; type: string }>(
      "SELECT id, type FROM workspace_nodes WHERE project_id='fixture-project' AND type != 'folder' LIMIT 1",
    ).get();
    if (!node) throw new Error('Fixture must contain a document node');
    const ledger = createSqliteActionLedger(db);
    ledger.recorderFor(
      { kind: 'run', runId: 'fixture-run', rootRunId: 'fixture-run', parentRunId: null, conversationId: null, toolCallId: null },
      'coarse',
    ).record({ projectId: 'fixture-project', documentId: node.id, documentType: node.type, action: 'update' });
    expect(ledger.listDocumentChanges({ projectId: 'fixture-project', rootRunId: 'fixture-run', limit: 5 }).changes)
      .toEqual([expect.objectContaining({ documentId: node.id, actions: ['update'] })]);
    // 再打开一次，确保迁移后的账本与建表路径可重入且不会删除提议。
    upgraded.close();
    upgraded.initialize({ lifecycleBootstrap: bootstrapSlides });
    expect(readStructure(upgraded.getDb())).toEqual(actual);
    expect(upgraded.getDb().prepare('SELECT COUNT(*) AS count FROM markdown_block_pending_revisions').get())
      .toEqual({ count: 1 });
  } finally {
    fresh.close(); upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
