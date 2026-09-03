import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { PluginStateService } from '../../../infrastructure/sqlite/plugin-state.service';
import { isPluginUserRemoved } from '../../functions/pluginRemovalMarker';
import { uninstallPluginLifecycle } from '../uninstallPluginLifecycle';

const platformMeta: PluginMeta = {
  id: 'platform',
  name: 'Platform',
  version: '1.0.0',
  description: 'Core',
  developer: 'Linnya',
  builtin: true,
  required: true,
};

const mindmapMeta: PluginMeta = {
  id: 'mindmap',
  name: 'Mindmap',
  version: '1.0.0',
  description: 'Mindmap plugin',
  developer: 'Linnya',
  builtin: true,
};

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-uninstall-lifecycle-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createPluginTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0,
      compat_min TEXT,
      source TEXT NOT NULL DEFAULT 'builtin',
      user_removed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE enabled_plugins (
      plugin_id TEXT PRIMARY KEY,
      enabled_at INTEGER NOT NULL,
      FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
    );

    CREATE TABLE mindmap_versions (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `);
}

describe('uninstallPluginLifecycle', () => {
  let db: Database.Database;
  let userPluginRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginTables(db);
    const stateService = new PluginStateService(db);
    stateService.ensureBuiltinInstalled([platformMeta, mindmapMeta]);
    db.prepare("INSERT INTO mindmap_versions (id, payload) VALUES ('doc-1', 'kept')").run();

    userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    writeJson(path.join(userPluginRoot, 'mindmap/1.0.0/plugin.json'), {
      id: 'mindmap',
      version: '1.0.0',
      name: 'Mindmap',
      description: 'Mindmap plugin',
      developer: 'Linnya',
      details: ['Mindmap plugin details'],
      entry: { backend: './dist/backend/index.cjs' },
    });
  });

  afterEach(() => {
    db.close();
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('marks builtin plugin removed and invalidates its runtime files without deleting plugin data', () => {
    const result = uninstallPluginLifecycle({
      db,
      userPluginRoot,
      pluginId: 'mindmap',
      knownPlugins: [platformMeta, mindmapMeta],
    });

    expect(result).toMatchObject({
      status: 'uninstalled',
      pluginId: 'mindmap',
      removedActivePointer: true,
      userDataPreserved: true,
    });
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/active.json'))).toBe(false);
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/1.0.0'))).toBe(false);
    expect(isPluginUserRemoved(userPluginRoot, 'mindmap')).toBe(true);
    expect(new PluginStateService(db).getInstalledRecord('mindmap')).toMatchObject({
      installed: false,
      userRemoved: true,
    });
    expect(db.prepare('SELECT id, payload FROM mindmap_versions').all()).toEqual([
      { id: 'doc-1', payload: 'kept' },
    ]);
  });

  it('rejects required plugins through the same lifecycle guard', () => {
    const result = uninstallPluginLifecycle({
      db,
      userPluginRoot,
      pluginId: 'platform',
      knownPlugins: [platformMeta, mindmapMeta],
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'platform',
    });
    if (result.status !== 'failed') {
      throw new Error('expected uninstall to fail');
    }
    expect(result.error).toContain('核心插件不能卸载');
  });
});
