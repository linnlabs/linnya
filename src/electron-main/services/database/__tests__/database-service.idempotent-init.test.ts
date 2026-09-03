/**
 * @file database-service.idempotent-init.test.ts
 * @description DatabaseService.initialize() 不变量回归测试。
 *
 * 核心契约：
 *   兼容性判断先于任何 DDL；受支持基线内 createTables() 每次 init 都跑。
 *
 * 这把「新加 schema-provider 必须配对 migration」的双写要求消除掉了。
 * 本文件锁定四个不变量：
 * 1) 全新库：直接建立当前 schema
 * 2) 重复 init 同一文件：完全幂等，不破坏已有数据
 * 3) 基线外数据库：在 schema provider 和插件 lifecycle 写入前拒绝
 * 4) 当前版本缺 schema-provider 表：init 自动补建，插件 owned tables 不越界补建
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { DATABASE_BUSY_TIMEOUT_MS, DatabaseService } from '../../database';
import { HOST_SCHEMA_BASELINE_VERSION, SCHEMA_VERSION } from '../migrations';
import { PluginStateService } from '../../../../features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginUpgradeRunner } from '../../../../features/plugins/infrastructure/sqlite/plugin-upgrade.runner';

interface TableRow {
  name: string;
}

function listTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as TableRow[]
  ).map(r => r.name);
}

function listIndexes(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as TableRow[]
  ).map(r => r.name);
}

const TEST_PLUGIN_ID = 'database-lifecycle-test-plugin';
const TEST_PLUGIN_TABLE = 'database_test_plugin_records';
const TEST_PLUGIN_EVIDENCE_TABLE = 'database_test_plugin_evidence';
const TEST_PLUGIN_META: PluginMeta = {
  id: TEST_PLUGIN_ID,
  name: 'Database Lifecycle Test Plugin',
  version: '1.0.0',
  description: '验证 Host 与插件数据库所有权边界',
  developer: 'Linnya Test',
  builtin: true,
};

function bootstrapTestPluginLifecycle(db: Database.Database): void {
  new PluginStateService(db).ensureBuiltinInstalled([TEST_PLUGIN_META]);
  new PluginUpgradeRunner(db, { appVersion: '0.0.38' }).run({
    pluginId: TEST_PLUGIN_ID,
    targetVersion: TEST_PLUGIN_META.version,
    ownedTables: [TEST_PLUGIN_TABLE, TEST_PLUGIN_EVIDENCE_TABLE],
    migrations: [
      {
        version: 1,
        description: '创建测试插件主表',
        up: migrationDb =>
          migrationDb.exec(
            `CREATE TABLE ${TEST_PLUGIN_TABLE} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`
          ),
      },
      {
        version: 2,
        description: '创建测试插件证据表',
        up: migrationDb =>
          migrationDb.exec(
            `CREATE TABLE ${TEST_PLUGIN_EVIDENCE_TABLE} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`
          ),
      },
    ],
  });
}

function initializeWithTestPluginLifecycle(service: DatabaseService): void {
  service.initialize({
    lifecycleBootstrap: bootstrapTestPluginLifecycle,
  });
}

describe('DatabaseService.initialize() — createTables-always invariants', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-db-test-'));
    dbPath = path.join(tempDir, 'workspace.sqlite');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('bootstraps the current Host schema and applies a generic plugin lifecycle', () => {
    const svc = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(svc);

    const db = svc.getDb();

    const userVersion = db.pragma('user_version', { simple: true }) as number;
    expect(userVersion).toBe(SCHEMA_VERSION);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(DATABASE_BUSY_TIMEOUT_MS);

    const tables = listTables(db);
    // 抽样核心 provider 的代表性表，防止新增 provider 只注册却没有进入初始化路径。
    expect(tables).toEqual(
      expect.arrayContaining([
        'projects', // workspace
        'workspace_nodes',
        'asset_storage_bindings', // asset-ledger 与 AppData sidecar 的持久身份
        'agents',
        'conversations', // conversation
        'runs',
        'events',
        'conversation_ui_messages', // 可从 events 重建的 UI read model
        'conversation_citation_ref_claims', // Conversation 级 Citation 生产控制状态
        'conversation_directory_cleanup_jobs', // conversation-files 持久恢复屏障
        'conversation_command_approvals', // 简单命令的对话级批准记忆
        'engine_checkpoints', // checkpointer（曾经的漏配 case）
        'engine_telemetry', // telemetry（曾经的漏配 case）
        'knowledge_bases', // knowledge-base
        'knowledge_graph_nodes',
        'installed_plugins', // plugin lifecycle core state
        'plugin_migrations',
        'workspace_node_text_snapshots',
        TEST_PLUGIN_TABLE,
        TEST_PLUGIN_EVIDENCE_TABLE,
      ])
    );

    const testPlugin = db
      .prepare(
        `
        SELECT installed, builtin, source, schema_version
        FROM installed_plugins
        WHERE plugin_id = ?
      `
      )
      .get(TEST_PLUGIN_ID) as
      | { installed: number; builtin: number; source: string; schema_version: number }
      | undefined;
    expect(testPlugin).toEqual({
      installed: 1,
      builtin: 1,
      source: 'builtin',
      schema_version: 2,
    });

    expect(
      db
        .prepare(
          `
        SELECT plugin_id, version
        FROM plugin_migrations
        WHERE plugin_id = ?
        ORDER BY version
      `
        )
        .all(TEST_PLUGIN_ID)
    ).toEqual([
      { plugin_id: TEST_PLUGIN_ID, version: 1 },
      { plugin_id: TEST_PLUGIN_ID, version: 2 },
    ]);

    svc.close();
  });

  it('is fully idempotent: re-initializing the same file does not corrupt anything', () => {
    const svc1 = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(svc1);

    const db1 = svc1.getDb();
    db1.exec(
      "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES ('p-1', 'X', '', 1, 1)"
    );
    const tablesBefore = listTables(db1);
    const indexesBefore = listIndexes(db1);
    const versionBefore = db1.pragma('user_version', { simple: true }) as number;
    svc1.close();

    const svc2 = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(svc2);

    const db2 = svc2.getDb();
    expect(listTables(db2)).toEqual(tablesBefore);
    expect(listIndexes(db2)).toEqual(indexesBefore);
    expect(db2.pragma('user_version', { simple: true }) as number).toBe(versionBefore);

    const projects = db2.prepare("SELECT id FROM projects WHERE id = 'p-1'").all() as Array<{
      id: string;
    }>;
    expect(projects).toEqual([{ id: 'p-1' }]);
    expect(
      db2
        .prepare('SELECT version FROM plugin_migrations WHERE plugin_id = ? ORDER BY version')
        .all(TEST_PLUGIN_ID)
    ).toEqual([{ version: 1 }, { version: 2 }]);

    svc2.close();
  });

  it('migrates v61 subrun history without losing existing trace facts', () => {
    const bootstrap = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(bootstrap);
    const old = bootstrap.getDb();
    old.exec(`
      ALTER TABLE subrun_trace_runs ADD COLUMN child_run_id TEXT;
      INSERT INTO conversations (
        conversation_id,
        title,
        created_at,
        last_event_at
      ) VALUES ('conversation-migration', 'Migration', 1, 1);
      INSERT INTO subrun_trace_runs (
        subrun_id,
        conversation_id,
        turn_id,
        parent_tool_call_id,
        child_run_id,
        created_at
      ) VALUES (
        'subrun-migration',
        'conversation-migration',
        'turn-migration',
        'parent-call-migration',
        'subrun-migration',
        1
      );
      DROP TABLE subrun_trace_items;
      CREATE TABLE subrun_trace_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subrun_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN (
          'thought_complete',
          'tool_call_decision',
          'tool_output',
          'final_answer'
        )),
        timestamp INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(subrun_id) REFERENCES subrun_trace_runs(subrun_id) ON DELETE CASCADE
      );
      INSERT INTO subrun_trace_items (
        id,
        subrun_id,
        source_event_id,
        kind,
        timestamp,
        payload_json
      ) VALUES (
        7,
        'subrun-migration',
        'existing-final-answer',
        'final_answer',
        2,
        '{}'
      );
    `);
    old.pragma('user_version = 61');
    bootstrap.close();

    const migrated = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(migrated);
    const db = migrated.getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(
      db.prepare('SELECT id, source_event_id, kind FROM subrun_trace_items ORDER BY id').all()
    ).toEqual([
      {
        id: 7,
        source_event_id: 'existing-final-answer',
        kind: 'final_answer',
      },
    ]);
    expect(() =>
      db
        .prepare(
          `
      INSERT INTO subrun_trace_items (
        subrun_id,
        source_event_id,
        kind,
        timestamp,
        payload_json
      ) VALUES (?, ?, 'history_summary', ?, ?)
    `
        )
        .run('subrun-migration', 'new-history-summary', 3, '{}')
    ).not.toThrow();

    migrated.close();
  });

  it('rejects a pre-baseline database before applying host or plugin schemas', () => {
    const raw = new Database(dbPath);
    raw.exec('CREATE TABLE legacy_bootstrap_marker (id TEXT PRIMARY KEY);');
    raw.pragma(`user_version = ${HOST_SCHEMA_BASELINE_VERSION - 1}`);
    raw.close();

    const svc = new DatabaseService(dbPath);
    expect(() => initializeWithTestPluginLifecycle(svc)).toThrow(
      new RegExp(`早于当前支持的 Host Schema 基线 v${HOST_SCHEMA_BASELINE_VERSION}`)
    );
    expect(() => svc.getDb()).toThrow(/not initialized/i);

    const unchanged = new Database(dbPath);
    expect(listTables(unchanged)).toEqual(['legacy_bootstrap_marker']);
    expect(unchanged.pragma('user_version', { simple: true }) as number).toBe(
      HOST_SCHEMA_BASELINE_VERSION - 1
    );
    expect(unchanged.pragma('journal_mode', { simple: true })).toBe('delete');
    unchanged.close();
  });

  it('rejects a future database before applying host or plugin schemas', () => {
    const raw = new Database(dbPath);
    raw.exec('CREATE TABLE future_bootstrap_marker (id TEXT PRIMARY KEY);');
    raw.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();

    const svc = new DatabaseService(dbPath);
    expect(() => initializeWithTestPluginLifecycle(svc)).toThrow(
      new RegExp(`新于当前应用支持的 v${SCHEMA_VERSION}`)
    );
    expect(() => svc.getDb()).toThrow(/not initialized/i);

    const unchanged = new Database(dbPath);
    expect(listTables(unchanged)).toEqual(['future_bootstrap_marker']);
    expect(unchanged.pragma('user_version', { simple: true }) as number).toBe(SCHEMA_VERSION + 1);
    expect(unchanged.pragma('journal_mode', { simple: true })).toBe('delete');
    unchanged.close();
  });

  it('auto-heals a current database that is missing a host schema-provider table', () => {
    const svc1 = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(svc1);

    const before = svc1.getDb();
    expect(listTables(before)).toContain('engine_checkpoints');
    expect(listTables(before)).toContain('engine_telemetry');
    expect(listTables(before)).toContain('conversation_directory_cleanup_jobs');
    svc1.close();

    // 模拟当前库因中断或历史缺陷缺少幂等 provider 表。注意要在 raw 连接里 DROP，
    // 绕过 DatabaseService 的封装。
    const raw = new Database(dbPath);
    raw.exec('DROP TABLE engine_checkpoints');
    raw.exec('DROP TABLE engine_telemetry');
    raw.exec('DROP TABLE conversation_directory_cleanup_jobs');
    expect(listTables(raw)).not.toContain('engine_checkpoints');
    expect(listTables(raw)).not.toContain('engine_telemetry');
    expect(listTables(raw)).not.toContain('conversation_directory_cleanup_jobs');
    expect(raw.pragma('user_version', { simple: true }) as number).toBe(SCHEMA_VERSION);
    raw.close();

    // 再次 initialize：createTables-always 不变量保证缺失表被补建
    const svc2 = new DatabaseService(dbPath);
    expect(() => initializeWithTestPluginLifecycle(svc2)).not.toThrow();

    const healed = svc2.getDb();
    const tables = listTables(healed);
    expect(tables).toContain('engine_checkpoints');
    expect(tables).toContain('engine_telemetry');
    expect(tables).toContain('conversation_directory_cleanup_jobs');

    expect(() => {
      healed.prepare('SELECT COUNT(*) AS n FROM engine_checkpoints').get();
      healed.prepare('SELECT COUNT(*) AS n FROM engine_telemetry').get();
      healed.prepare('SELECT COUNT(*) AS n FROM conversation_directory_cleanup_jobs').get();
    }).not.toThrow();

    svc2.close();
  });

  it('does not auto-heal an already-migrated plugin table through host schema providers', () => {
    const svc1 = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(svc1);

    const before = svc1.getDb();
    expect(listTables(before)).toContain(TEST_PLUGIN_EVIDENCE_TABLE);
    svc1.close();

    const raw = new Database(dbPath);
    raw.exec(`DROP TABLE ${TEST_PLUGIN_EVIDENCE_TABLE}`);
    expect(listTables(raw)).not.toContain(TEST_PLUGIN_EVIDENCE_TABLE);
    expect(raw.pragma('user_version', { simple: true }) as number).toBe(SCHEMA_VERSION);
    raw.close();

    const svc2 = new DatabaseService(dbPath);
    expect(() => initializeWithTestPluginLifecycle(svc2)).not.toThrow();

    const healed = svc2.getDb();
    // 中文说明：插件表只能由 plugin migration 建/收养。这里 migration
    // 账本已经是最新，host schemaProvider 不应再偷偷补建插件表；
    // 表声明与真实 DDL 漂移应由 L-09 的 ownedTables 契约检查 fail-fast。
    expect(listTables(healed)).not.toContain(TEST_PLUGIN_EVIDENCE_TABLE);

    svc2.close();
  });
});

/**
 * F1-02：worker 专用轻量建连路径回归。
 *
 * 模型：两个独立 DatabaseService 实例打同一个 workspace.sqlite，对应"主进程 initialize() 之后
 * worker 用 initializeConnectionOnly() 接入同一文件"的真实拓扑（worker 线程是独立单例 + 独立连接）。
 *
 * 锁定不变量：
 * 1) 主进程已 initialize 后，connection-only 接入：pragma 一致、不改 schema、不动插件账本。
 * 2) 未初始化的库上 connection-only：抛时序契约错，且绝不自行 bootstrap（不建表、不跑插件 lifecycle）。
 */
describe('DatabaseService.initializeConnectionOnly() — worker lightweight connection', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-db-conn-test-'));
    dbPath = path.join(tempDir, 'workspace.sqlite');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('opens a connection with identical pragmas and does not mutate an already-initialized schema', () => {
    const main = new DatabaseService(dbPath);
    initializeWithTestPluginLifecycle(main);
    const tablesBefore = listTables(main.getDb());
    const indexesBefore = listIndexes(main.getDb());
    const versionBefore = main.getDb().pragma('user_version', { simple: true }) as number;
    const migrationsBefore = main
      .getDb()
      .prepare('SELECT plugin_id, version FROM plugin_migrations ORDER BY plugin_id, version')
      .all();
    main.close();

    const worker = new DatabaseService(dbPath);
    worker.initializeConnectionOnly();
    const wdb = worker.getDb();

    // pragma 必须和主进程连接一致（尤其 busy_timeout，F1-03）
    expect(wdb.pragma('busy_timeout', { simple: true })).toBe(DATABASE_BUSY_TIMEOUT_MS);
    expect(wdb.pragma('foreign_keys', { simple: true })).toBe(1);

    // 不得改动任何 schema / 版本 / 插件账本
    expect(listTables(wdb)).toEqual(tablesBefore);
    expect(listIndexes(wdb)).toEqual(indexesBefore);
    expect(wdb.pragma('user_version', { simple: true }) as number).toBe(versionBefore);
    expect(
      wdb
        .prepare('SELECT plugin_id, version FROM plugin_migrations ORDER BY plugin_id, version')
        .all()
    ).toEqual(migrationsBefore);

    worker.close();
  });

  it('throws on an uninitialized database instead of silently bootstrapping schema or plugin lifecycle', () => {
    // 全新文件，主进程从未 initialize()。worker 直连必须 fail-fast，不能自建表。
    const worker = new DatabaseService(dbPath);
    expect(() => worker.initializeConnectionOnly()).toThrow(
      /requires the main process|主进程先完成 initialize/i
    );

    // 断言绝对没有 bootstrap：用 raw 连接看库里没有任何业务表
    const raw = new Database(dbPath);
    expect(listTables(raw)).not.toContain('installed_plugins');
    expect(listTables(raw)).not.toContain('projects');
    expect(raw.pragma('user_version', { simple: true }) as number).toBe(0);
    raw.close();
  });
});
