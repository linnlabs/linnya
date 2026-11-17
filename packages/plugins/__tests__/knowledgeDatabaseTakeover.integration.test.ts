import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { PluginStateService } from 'src/features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginUpgradeRunner } from 'src/features/plugins/infrastructure/sqlite/plugin-upgrade.runner';
import { PLATFORM_PLUGIN_META } from 'src/app-hosts/linnya/plugin-registry/builtin/platform-meta';
import { knowledgeManifest, knowledgePluginMeta } from '../knowledge/src/shared/definitions/pluginMeta';
import { knowledgePluginMigrations } from '../knowledge/src/backend/database';
import { KNOWLEDGE_BASE_SCHEMAS, KNOWLEDGE_GRAPH_SCHEMAS } from '../knowledge/src/backend/database/schemas';

const knownPlugins = [PLATFORM_PLUGIN_META, knowledgePluginMeta];
const plan = {
  pluginId: knowledgePluginMeta.id, targetVersion: knowledgePluginMeta.version,
  compatMin: knowledgePluginMeta.compatMin,
  ownedTables: knowledgeManifest.ownedTables, migrations: knowledgePluginMigrations,
};

function adopt(db: Database.Database): void {
  new PluginStateService(db).ensureBuiltinInstalled(knownPlugins);
  const result = new PluginUpgradeRunner(db, { appVersion: '0.2.1' }).run(plan);
  expect(['upgraded', 'skipped']).toContain(result.status);
}

function rows(db: Database.Database): Record<string, unknown> {
  return Object.fromEntries(knowledgeManifest.ownedTables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
}

function structure(db: Database.Database): Record<string, unknown> {
  return Object.fromEntries(knowledgeManifest.ownedTables.map(table => [table, {
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db.prepare(`PRAGMA index_list(${table})`).all(),
  }]));
}

function seedFacts(db: Database.Database): void {
  db.exec(`
    INSERT INTO projects (id,name,created_at,updated_at) VALUES ('project-1','Retained project',1,1);
    INSERT INTO knowledge_bases (id,name,embedding_model_id,created_at) VALUES ('kb-1','Retained knowledge','model-before',1);
    INSERT INTO kb_documents (id,kb_id,filename,status,error_message,created_at)
      VALUES ('doc-1','kb-1','原件.pdf','failed','temporary provider failure','2026-11-17');
    INSERT INTO project_knowledge_base_links VALUES ('project-1','kb-1','read_write',1,1);
    INSERT INTO knowledge_graph_nodes (kb_id,id,name,canonical_name,source_doc_id,source_block_id,created_at)
      VALUES ('kb-1','node-1','Retained entity','retained','doc-1','block-1',1);
    INSERT INTO knowledge_graph_edges (kb_id,id,source_entity_id,target_entity_id,relation_type,evidence_doc_id,evidence_block_id,created_at)
      VALUES ('kb-1','edge-1','node-1','node-1','related','doc-1','block-1',1);
    INSERT INTO knowledge_graph_doc_status VALUES ('kb-1','doc-1',10,5,'running',1);
    INSERT INTO knowledge_graph_index_status VALUES ('kb-1',10,5,1);
    INSERT INTO knowledge_graph_vector_doc_status (kb_id,doc_id,embedding_model_id,node_count,edge_count,done_units,status,updated_at)
      VALUES ('kb-1','doc-1','model-before',1,1,1,'failed',1);
  `);
}

describe('knowledge database ownership transfer', () => {
  let directory: string;
  let service: DatabaseService;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'knowledge-takeover-'));
    service = new DatabaseService(join(directory, 'workspace.sqlite'));
    service.initialize();
  });
  afterEach(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });

  it('creates all eight tables through the plugin lifecycle, with no implicit Host installation', () => {
    const db = service.getDb();
    for (const table of knowledgeManifest.ownedTables) {
      expect(db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?').get(table)).toBeUndefined();
    }
    adopt(db);
    seedFacts(db);
    expect(Object.keys(rows(db))).toHaveLength(8);
    expect(db.prepare('SELECT embedding_space_id FROM knowledge_bases').get()).toEqual({ embedding_space_id: null });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT version FROM plugin_migrations WHERE plugin_id=?').all('knowledge')).toEqual([{ version: 1 }]);
  });

  it('runs historical v79 before adoption and preserves all rows, relationships and fresh column order across reopen', () => {
    const db = service.getDb();
    for (const ddl of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) db.exec(ddl);
    seedFacts(db);
    const before = rows(db);
    // 构造刚升级前的 v78 知识库形态；其余 Host 表仍由正式 DatabaseService 创建。
    db.exec('ALTER TABLE knowledge_bases DROP COLUMN embedding_space_id');
    db.pragma('user_version = 78');
    service.close();
    service.initialize({ lifecycleBootstrap: adopt });
    const upgraded = service.getDb();
    const after = rows(upgraded);
    expect(after).toEqual(before);
    const fresh = new DatabaseService(join(directory, 'fresh.sqlite'));
    try {
      fresh.initialize({ lifecycleBootstrap: adopt });
      expect(structure(upgraded)).toEqual(structure(fresh.getDb()));
    } finally { fresh.close(); }
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    expect(upgraded.pragma('integrity_check', { simple: true })).toBe('ok');
    service.close();
    service.initialize({ lifecycleBootstrap: adopt });
    expect(rows(service.getDb())).toEqual(after);
    expect(service.getDb().prepare('SELECT version FROM plugin_migrations WHERE plugin_id=?').all('knowledge')).toEqual([{ version: 1 }]);
  });

  it('migrates an installed disabled plugin without enabling it and retains facts across uninstall and reinstall', () => {
    const db = service.getDb();
    const state = new PluginStateService(db);
    state.ensureBuiltinInstalled(knownPlugins);
    state.setEnabled('knowledge', false, knownPlugins);
    adopt(db);
    seedFacts(db);
    const before = rows(db);
    expect(state.getEnabledIds()).not.toContain('knowledge');
    state.setInstalled('knowledge', false, knownPlugins);
    expect(new PluginUpgradeRunner(db, { appVersion: '0.2.1' }).run(plan)).toMatchObject({ status: 'skipped', reason: 'not-installed' });
    expect(rows(db)).toEqual(before);
    state.setInstalled('knowledge', true, knownPlugins);
    adopt(db);
    expect(rows(db)).toEqual(before);
    expect(state.getInstalledRecord('knowledge')).toMatchObject({ installed: true, schemaVersion: 1 });
  });

  it('rolls back interrupted takeover without removing existing data or recording a completed migration', () => {
    const db = service.getDb();
    for (const ddl of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) db.exec(ddl);
    seedFacts(db);
    const before = rows(db);
    new PluginStateService(db).ensureBuiltinInstalled(knownPlugins);
    const result = new PluginUpgradeRunner(db, { appVersion: '0.2.1' }).run({ ...plan, migrations: [{
      version: 1, description: 'Interrupted first takeover', up(database) {
        for (const migration of knowledgePluginMigrations) migration.up(database);
        database.exec("UPDATE knowledge_bases SET name='uncommitted'");
        throw new Error('simulated interrupted takeover');
      },
    }] });
    expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining('simulated interrupted takeover') });
    expect(rows(db)).toEqual(before);
    expect(db.prepare('SELECT version FROM plugin_migrations WHERE plugin_id=?').all('knowledge')).toEqual([]);
    adopt(db);
    expect(rows(db)).toEqual(before);
  });
});
