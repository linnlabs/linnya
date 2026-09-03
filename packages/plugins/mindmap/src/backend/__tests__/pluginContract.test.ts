import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import mindmapManifestJson from '../../../plugin.json';
import mindmapPackageJson from '../../../package.json';
import { parsePluginManifest } from '@app/schemas';
import {
  MINDMAP_DOCUMENT_TYPE,
  MINDMAP_FILE_EXTENSION,
  MINDMAP_OWNED_TABLES,
  MINDMAP_PLUGIN_META,
} from '@plugin/mindmap/shared';
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { PluginMigrationRunner } from 'src/features/plugins/infrastructure/sqlite/plugin-migration.runner';
import { mindmapBackendPlugin, mindmapPluginMigrations } from '../index';
import {
  MINDMAP_DOCUMENT_SCHEMAS,
  MINDMAP_EVIDENCE_SCHEMAS,
  mindmapToolManifest,
} from '../test-support';

type NamedToolConstructor = new () => { readonly name: string };

function instantiateToolNames(toolClasses: readonly NamedToolConstructor[] | undefined): readonly string[] {
  return (toolClasses ?? []).map(ToolClass => new ToolClass().name);
}

function listMigrationManifestEntries(
  migrations: readonly { readonly version: number; readonly description: string }[],
): Array<{ version: number; description: string }> {
  return migrations.map(({ version, description }) => ({ version, description }));
}

function createPluginRuntimeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0, installed_at INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0, compat_min TEXT,
      source TEXT NOT NULL DEFAULT 'builtin', user_removed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL, version INTEGER NOT NULL, applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, version)
    );
  `);
}

function listExistingTables(db: Database.Database): readonly string[] {
  const rows = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `).all();
  return rows.map(row => {
    const name = typeof row === 'object' && row !== null ? Reflect.get(row, 'name') : null;
    if (typeof name !== 'string') throw new Error('SQLite table catalog row is missing its name');
    return name;
  });
}

describe('Mindmap backend contribution contract', () => {
  it('keeps package metadata, manifest and backend contribution aligned', () => {
    const manifest = parsePluginManifest(mindmapManifestJson);

    expect(mindmapPackageJson.version).toBe(manifest.version);
    expect(MINDMAP_PLUGIN_META.version).toBe(manifest.version);
    expect(manifest.ownedFileTypes).toEqual([
      expect.objectContaining({
        nodeType: MINDMAP_DOCUMENT_TYPE,
        extension: MINDMAP_FILE_EXTENSION,
      }),
    ]);
    expect(MINDMAP_OWNED_TABLES).toEqual(manifest.ownedTables);
    expect(mindmapBackendPlugin.ownedTables).toEqual(manifest.ownedTables);
    expect(manifest.migrations).toEqual(listMigrationManifestEntries(mindmapPluginMigrations));
    expect(manifest.details.length).toBeGreaterThan(0);
    expect(manifest.releaseNotes?.length ?? 0).toBeGreaterThan(0);
    expect(manifest.agents?.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps registered tools and agent tool references aligned', () => {
    const registeredToolNames = [...instantiateToolNames(mindmapBackendPlugin.toolClasses)].sort();
    expect([...mindmapToolManifest.allNames].sort()).toEqual(registeredToolNames);

    const registeredToolNameSet = new Set(registeredToolNames);
    const agentToolNames = Object.values(mindmapToolManifest.agentTools)
      .flatMap(toolNames => [...toolNames]);
    expect(agentToolNames).toContain('list_files');
    for (const toolName of agentToolNames) {
      if (toolName.startsWith('mindmap_')) {
        expect(registeredToolNameSet.has(toolName)).toBe(true);
      }
    }
  });
});

describe('Mindmap database ownership contract', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginRuntimeTables(db);
  });

  afterEach(() => db.close());

  it('creates every owned table through the owner DDL contract', () => {
    for (const statement of [...MINDMAP_DOCUMENT_SCHEMAS, ...MINDMAP_EVIDENCE_SCHEMAS]) {
      db.exec(statement);
    }
    expect(listExistingTables(db)).toEqual(expect.arrayContaining([...MINDMAP_OWNED_TABLES]));
  });

  it('creates every owned table through plugin migrations on a clean host schema', () => {
    for (const statement of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS]) {
      db.exec(statement);
    }
    db.prepare(`
      INSERT INTO installed_plugins
        (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, source)
      VALUES (?, ?, ?, 1, 1, 0, 123, 0, 'builtin')
    `).run(mindmapBackendPlugin.meta.id, mindmapBackendPlugin.meta.version, mindmapBackendPlugin.meta.name);

    const result = new PluginMigrationRunner(db).run(
      mindmapBackendPlugin.meta.id,
      mindmapPluginMigrations,
    );

    expect(result.toVersion).toBe(
      mindmapPluginMigrations[mindmapPluginMigrations.length - 1]?.version ?? 0,
    );
    expect(listExistingTables(db)).toEqual(expect.arrayContaining([...MINDMAP_OWNED_TABLES]));
  });
});
