import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PluginDataBackup } from 'src/features/plugins/infrastructure/sqlite/plugin-data-backup';
import { PluginStateService } from 'src/features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginUpgradeRunner } from 'src/features/plugins/infrastructure/sqlite/plugin-upgrade.runner';
import { PLATFORM_PLUGIN_META } from 'src/app-hosts/linnya/plugin-registry/builtin/platform-meta';
import {
  SLIDES_BACKEND_AVAILABLE,
  slidesBackendPlugin,
} from '../index';
import { SLIDES_OWNED_TABLES, SLIDES_PLUGIN_META } from '@plugin/slides/shared';
import { PRESENTATION_HISTORY_SCHEMAS } from '../features/presentationSourceHistory';

interface TableNameRow {
  readonly name: string;
}
interface PresentationDocumentRow {
  readonly id: string;
  readonly title: string;
}
interface PresentationDraftRow {
  readonly node_id: string;
  readonly deck_source: string;
}
interface PresentationTemplateRow {
  readonly id: string;
  readonly name: string;
}

const EXPECTED_SLIDES_OWNED_TABLES = [
  'presentation_documents',
  'presentation_revisions',
  'presentation_drafts',
  'presentation_templates',
  'presentation_image_bindings',
  'presentation_svg_graphic_bindings',
  'presentation_revision_contexts',
  'presentation_revision_assets',
  'presentation_asset_releases',
] as const;

function createPluginRuntimeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0, installed_at INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0, compat_min TEXT,
      source TEXT NOT NULL DEFAULT 'builtin', user_removed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE enabled_plugins (
      plugin_id TEXT PRIMARY KEY, enabled_at INTEGER NOT NULL,
      FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
    );
    CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL, version INTEGER NOT NULL, applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, version)
    );
  `);
}

function createPresentationTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE TABLE presentation_documents (
      node_id TEXT PRIMARY KEY, current_revision_id TEXT NOT NULL, current_revision INTEGER NOT NULL,
      deck_source TEXT NOT NULL, source_hash TEXT NOT NULL, deck_spec_json TEXT NOT NULL,
      pptx_buffer BLOB NOT NULL, title TEXT NOT NULL, slide_count INTEGER NOT NULL, layout TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, author_id TEXT,
      FOREIGN KEY (node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (current_revision_id) REFERENCES presentation_revisions(id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE presentation_revisions (
      id TEXT PRIMARY KEY, node_id TEXT NOT NULL, revision INTEGER NOT NULL,
      parent_revision_id TEXT, base_source_hash TEXT, source_hash TEXT NOT NULL,
      storage_kind TEXT NOT NULL, source_checkpoint TEXT, source_patch TEXT,
      patch_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, author_id TEXT, origin TEXT NOT NULL,
      FOREIGN KEY (node_id) REFERENCES presentation_documents(node_id) ON DELETE CASCADE
    );
    CREATE TABLE presentation_drafts (
      node_id TEXT PRIMARY KEY, deck_source TEXT NOT NULL, source_hash TEXT NOT NULL,
      base_revision_id TEXT NOT NULL, base_revision INTEGER NOT NULL,
      last_error_summary TEXT, last_error_kind TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (node_id) REFERENCES presentation_documents(node_id) ON DELETE CASCADE
    );
    CREATE TABLE presentation_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, template_spec_json TEXT NOT NULL,
      source_pptx_buffer BLOB NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE presentation_image_bindings (
      presentation_id TEXT NOT NULL, source_identity TEXT NOT NULL,
      asset_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (presentation_id, source_identity),
      FOREIGN KEY (presentation_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
    );
    CREATE TABLE presentation_svg_graphic_bindings (
      presentation_id TEXT NOT NULL, source_identity TEXT NOT NULL,
      asset_id TEXT NOT NULL, content_hash TEXT NOT NULL, byte_length INTEGER NOT NULL,
      viewbox_width REAL NOT NULL, viewbox_height REAL NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (presentation_id, source_identity),
      FOREIGN KEY (presentation_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
    );
  `);
}

function seedPresentationRows(db: Database.Database): void {
  for (const ddl of PRESENTATION_HISTORY_SCHEMAS) db.exec(ddl);
  db.prepare(
    `INSERT INTO workspace_nodes (id, type, name, created_at, updated_at)
    VALUES ('slides-node-1', 'presentation', 'Before', 100, 100)`
  ).run();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO presentation_documents (
      node_id, current_revision_id, current_revision, deck_source, source_hash,
      deck_spec_json, pptx_buffer, title, slide_count, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, 100, 100)`
    ).run(
      'slides-node-1',
      'revision-1',
      'before source',
      'hash-before',
      '{"title":"Before","slides":[]}',
      Buffer.from('pptx'),
      'Before'
    );
    db.prepare(
      `INSERT INTO presentation_revisions (
      id, node_id, revision, source_hash, storage_kind, source_checkpoint,
      patch_bytes, created_at, origin
    ) VALUES (?, ?, 1, ?, 'checkpoint', ?, 0, 100, 'create')`
    ).run('revision-1', 'slides-node-1', 'hash-before', 'before source');
  })();
  db.exec(`
    INSERT INTO presentation_drafts (
      node_id, deck_source, source_hash, base_revision_id, base_revision, created_at, updated_at
    ) VALUES ('slides-node-1', 'draft before', 'draft-hash', 'revision-1', 1, 100, 100);
    INSERT INTO presentation_templates (
      id, name, description, template_spec_json, source_pptx_buffer, created_at, updated_at
    ) VALUES ('template-1', 'Template Before', 'before',
      '{"id":"template-1","name":"Template Before","slides":[]}', X'00', 100, 100);
    INSERT INTO presentation_image_bindings (
      presentation_id, source_identity, asset_id, created_at
    ) VALUES ('slides-node-1', 'local_path:/tmp/image.png', 'asset-1', 100);
    INSERT INTO presentation_svg_graphic_bindings (
      presentation_id, source_identity, asset_id, content_hash, byte_length,
      viewbox_width, viewbox_height, created_at
    ) VALUES ('slides-node-1', 'inline_svg:svg-hash', 'svg-asset-1', 'svg-hash', 128, 100, 50, 100);
  `);
}

function installSlidesPlugin(db: Database.Database): PluginStateService {
  const stateService = new PluginStateService(db);
  stateService.ensureBuiltinInstalled([PLATFORM_PLUGIN_META, SLIDES_PLUGIN_META]);
  return stateService;
}

function markSlidesSchemaVersion(db: Database.Database, version: number): void {
  db.prepare(
    `UPDATE installed_plugins SET version = ?, schema_version = ? WHERE plugin_id = 'slides'`
  ).run('0.9.0', version);
  db.prepare(
    `INSERT INTO plugin_migrations (plugin_id, version, applied_at) VALUES ('slides', ?, 123)`
  ).run(version);
}

function listBackupTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '__backup_%' ORDER BY name`
      )
      .all() as TableNameRow[]
  ).map(row => row.name);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return !!(db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as TableNameRow | undefined);
}

function readVersionRows(db: Database.Database): PresentationDocumentRow[] {
  return db
    .prepare('SELECT node_id AS id, title FROM presentation_documents ORDER BY node_id')
    .all() as PresentationDocumentRow[];
}

function readDraftRows(db: Database.Database): PresentationDraftRow[] {
  return db
    .prepare('SELECT node_id, deck_source FROM presentation_drafts ORDER BY node_id')
    .all() as PresentationDraftRow[];
}

function readTemplateRows(db: Database.Database): PresentationTemplateRow[] {
  return db
    .prepare('SELECT id, name FROM presentation_templates ORDER BY id')
    .all() as PresentationTemplateRow[];
}

describe('Slides DB ownership', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginRuntimeTables(db);
    createPresentationTables(db);
    seedPresentationRows(db);
    installSlidesPlugin(db);
  });

  afterEach(() => db.close());

  it('declares the current presentation tables as Slides-owned tables', () => {
    expect(SLIDES_BACKEND_AVAILABLE).toBe(true);
    expect(SLIDES_OWNED_TABLES).toEqual(EXPECTED_SLIDES_OWNED_TABLES);
    expect(slidesBackendPlugin?.ownedTables).toEqual(EXPECTED_SLIDES_OWNED_TABLES);
  });

  it('snapshots and restores all presentation tables through ownedTables', () => {
    const backup = new PluginDataBackup(db);
    const snapshot = backup.snapshot('slides', SLIDES_OWNED_TABLES);
    expect(snapshot.tables.map(table => table.sourceTable)).toEqual(EXPECTED_SLIDES_OWNED_TABLES);
    expect(listBackupTables(db)).toHaveLength(EXPECTED_SLIDES_OWNED_TABLES.length);

    db.transaction(() => {
      db.exec(
        'DELETE FROM presentation_svg_graphic_bindings; DELETE FROM presentation_image_bindings; DELETE FROM presentation_drafts; DELETE FROM presentation_revisions; DELETE FROM presentation_documents; DELETE FROM presentation_templates;'
      );
    })();
    db.transaction(() => backup.restore(snapshot))();

    expect(readVersionRows(db)).toEqual([{ id: 'slides-node-1', title: 'Before' }]);
    expect(readDraftRows(db)).toEqual([{ node_id: 'slides-node-1', deck_source: 'draft before' }]);
    expect(readTemplateRows(db)).toEqual([{ id: 'template-1', name: 'Template Before' }]);
    backup.discard(snapshot);
    expect(listBackupTables(db)).toEqual([]);
  });

  it('rolls back owned table mutations when a Slides upgrade fails', () => {
    markSlidesSchemaVersion(db, 1);
    const runner = new PluginUpgradeRunner(db, { appVersion: '0.0.38' });
    const result = runner.run({
      pluginId: 'slides',
      targetVersion: '1.0.0',
      compatMin: SLIDES_PLUGIN_META.compatMin,
      ownedTables: SLIDES_OWNED_TABLES,
      migrations: [
        { version: 1, description: 'already applied', up: () => {} },
        {
          version: 2,
          description: 'mutate presentation data then fail',
          up: migrationDb => {
            migrationDb.exec(`UPDATE presentation_documents SET title = 'During Upgrade' WHERE node_id = 'slides-node-1';
              UPDATE presentation_drafts SET deck_source = 'draft during upgrade' WHERE node_id = 'slides-node-1';
              DELETE FROM presentation_templates WHERE id = 'template-1';`);
            throw new Error('planned slides upgrade failure');
          },
        },
      ],
    });
    expect(result).toMatchObject({ status: 'failed', pluginId: 'slides' });
    expect(readVersionRows(db)).toEqual([{ id: 'slides-node-1', title: 'Before' }]);
    expect(readDraftRows(db)).toEqual([{ node_id: 'slides-node-1', deck_source: 'draft before' }]);
    expect(readTemplateRows(db)).toEqual([{ id: 'template-1', name: 'Template Before' }]);
    expect(listBackupTables(db)).toEqual([]);
  });

  it('keeps presentation tables and rows when Slides is disabled or uninstalled', () => {
    const stateService = new PluginStateService(db);
    stateService.setEnabled('slides', false, [PLATFORM_PLUGIN_META, SLIDES_PLUGIN_META]);
    expect(stateService.getInstalledRecord('slides')).toMatchObject({ installed: true });
    expect(readVersionRows(db)).toEqual([{ id: 'slides-node-1', title: 'Before' }]);
    stateService.setInstalled('slides', false, [PLATFORM_PLUGIN_META, SLIDES_PLUGIN_META]);
    expect(stateService.getInstalledRecord('slides')).toMatchObject({ installed: false });
    for (const tableName of SLIDES_OWNED_TABLES) {
      expect(tableExists(db, tableName)).toBe(true);
    }
    expect(readTemplateRows(db)).toEqual([{ id: 'template-1', name: 'Template Before' }]);
  });
});
