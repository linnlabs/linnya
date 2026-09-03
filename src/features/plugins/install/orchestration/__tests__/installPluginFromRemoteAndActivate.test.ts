import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { PluginStateService } from '../../../infrastructure/sqlite/plugin-state.service';
import { isPluginUserRemoved, markPluginUserRemoved } from '../../functions/pluginRemovalMarker';
import { installPluginFromRemoteAndActivate } from '../installPluginFromRemoteAndActivate';

const latestUrl = 'https://download.linnyai.com/plugins/mindmap/latest.json';
const artifactUrl = 'https://download.linnyai.com/plugins/mindmap/mindmap-1.1.0.zip';
const rendererUiRange = '^1.0.0';

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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-remote-install-'));
  tempRoots.push(tempRoot);
  return tempRoot;
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

    CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, version)
    );

    CREATE TABLE plugin_owned (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

async function createPluginZip(version: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('plugin.json', `${JSON.stringify({
    id: 'mindmap',
    version,
    name: 'Mindmap',
    description: 'Mindmap plugin',
    developer: 'Linnya',
    details: ['Mindmap plugin details'],
    entry: {
      backend: './dist/backend/index.cjs',
      renderer: './dist/renderer/index.js',
    },
    compat: { rendererUi: rendererUiRange },
  }, null, 2)}\n`);
  zip.file('dist/backend/index.cjs', 'module.exports.backendPlugin = {};');
  zip.file('dist/renderer/index.js', 'export const rendererPlugin = {};');
  return zip.generateAsync({ type: 'nodebuffer' });
}

function sha512Hex(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex');
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes.buffer;
}

function createFetch(zipBuffer: Buffer): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === latestUrl) {
      return new Response(JSON.stringify({
        version: '1.1.0',
        minApp: '0.0.36',
        rendererUi: rendererUiRange,
        url: artifactUrl,
        sha512: sha512Hex(zipBuffer),
      }));
    }
    if (url === artifactUrl) {
      return new Response(toArrayBuffer(zipBuffer));
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  };
}

function readActivePointer(userPluginRoot: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8')) as unknown;
}

function writeActivePointer(userPluginRoot: string, version: string): void {
  const activePath = path.join(userPluginRoot, 'mindmap/active.json');
  fs.mkdirSync(path.dirname(activePath), { recursive: true });
  fs.writeFileSync(activePath, `${JSON.stringify({ version }, null, 2)}\n`, 'utf8');
}

describe('installPluginFromRemoteAndActivate', () => {
  let db: Database.Database;
  let userPluginRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginTables(db);
    const stateService = new PluginStateService(db);
    stateService.ensureBuiltinInstalled([platformMeta, mindmapMeta]);
    stateService.setInstalled('mindmap', false, [platformMeta, mindmapMeta]);
    stateService.setUserRemoved('mindmap', true);
    db.exec(`
      UPDATE installed_plugins SET schema_version = 1 WHERE plugin_id = 'mindmap';
      INSERT INTO plugin_migrations (plugin_id, version, applied_at) VALUES ('mindmap', 1, 123);
      INSERT INTO plugin_owned (id, value) VALUES ('row-1', 'before');
    `);
    userPluginRoot = path.join(makeTempRoot(), 'plugins');
    markPluginUserRemoved(userPluginRoot, 'mindmap', 123);
  });

  afterEach(() => {
    db.close();
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('downloads, activates and re-enables a user-removed builtin plugin', async () => {
    const zipBuffer = await createPluginZip('1.1.0');

    const result = await installPluginFromRemoteAndActivate({
      db,
      userPluginRoot,
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      knownPlugins: [platformMeta, mindmapMeta],
      fetch: createFetch(zipBuffer),
      resolveUpgradePlan: ({ pluginId, version }) => ({
        pluginId,
        targetVersion: version,
        ownedTables: ['plugin_owned'],
        migrations: [
          { version: 1, description: 'already applied', up: () => {} },
          {
            version: 2,
            description: 'mark restored rows',
            up: (migrationDb) => {
              migrationDb.exec("UPDATE plugin_owned SET value = 'after-remote-install' WHERE id = 'row-1';");
            },
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'installed',
      pluginId: 'mindmap',
      version: '1.1.0',
      previousVersion: null,
      restartRequired: true,
    });
    expect(readActivePointer(userPluginRoot)).toEqual({ version: '1.1.0' });
    expect(isPluginUserRemoved(userPluginRoot, 'mindmap')).toBe(false);
    expect(new PluginStateService(db).getInstalledRecord('mindmap')).toMatchObject({
      installed: true,
      userRemoved: false,
      version: '1.1.0',
      schemaVersion: 2,
    });
    expect(new PluginStateService(db).getEnabledIds()).toContain('mindmap');
    expect(db.prepare("SELECT value FROM plugin_owned WHERE id = 'row-1'").get()).toEqual({
      value: 'after-remote-install',
    });
  });

  it('registers known builtin plugin before remote install when older database has no catalog row', async () => {
    db.prepare("DELETE FROM enabled_plugins WHERE plugin_id = 'mindmap'").run();
    db.prepare("DELETE FROM installed_plugins WHERE plugin_id = 'mindmap'").run();
    const zipBuffer = await createPluginZip('1.1.0');

    const result = await installPluginFromRemoteAndActivate({
      db,
      userPluginRoot,
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      knownPlugins: [platformMeta, mindmapMeta],
      fetch: createFetch(zipBuffer),
      resolveUpgradePlan: ({ pluginId, version }) => ({
        pluginId,
        targetVersion: version,
        ownedTables: ['plugin_owned'],
        migrations: [
          { version: 1, description: 'create schema', up: () => {} },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'installed',
      pluginId: 'mindmap',
      version: '1.1.0',
      previousVersion: null,
      restartRequired: true,
    });
    expect(new PluginStateService(db).getInstalledRecord('mindmap')).toMatchObject({
      installed: true,
      userRemoved: false,
      version: '1.1.0',
      schemaVersion: 1,
    });
    expect(new PluginStateService(db).getEnabledIds()).toContain('mindmap');
  });

  it('preserves disabled state when updating an installed plugin', async () => {
    const stateService = new PluginStateService(db);
    stateService.setInstalled('mindmap', true, [platformMeta, mindmapMeta]);
    stateService.setEnabled('mindmap', false, [platformMeta, mindmapMeta]);
    writeActivePointer(userPluginRoot, '1.0.0');
    const zipBuffer = await createPluginZip('1.1.0');

    const result = await installPluginFromRemoteAndActivate({
      db,
      userPluginRoot,
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      knownPlugins: [platformMeta, mindmapMeta],
      fetch: createFetch(zipBuffer),
      resolveUpgradePlan: ({ pluginId, version }) => ({
        pluginId,
        targetVersion: version,
        ownedTables: ['plugin_owned'],
        migrations: [
          { version: 1, description: 'already applied', up: () => {} },
          { version: 2, description: 'noop upgrade', up: () => {} },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'installed',
      pluginId: 'mindmap',
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    expect(new PluginStateService(db).getEnabledIds()).not.toContain('mindmap');
    expect(new PluginStateService(db).getInstalledRecord('mindmap')).toMatchObject({
      installed: true,
      version: '1.1.0',
      schemaVersion: 2,
    });
  });

  it('does not re-enable an installed disabled plugin when remote version is current', async () => {
    const stateService = new PluginStateService(db);
    stateService.setInstalled('mindmap', true, [platformMeta, mindmapMeta]);
    stateService.setEnabled('mindmap', false, [platformMeta, mindmapMeta]);
    db.prepare("UPDATE installed_plugins SET version = '1.1.0' WHERE plugin_id = 'mindmap'").run();
    writeActivePointer(userPluginRoot, '1.1.0');
    const zipBuffer = await createPluginZip('1.1.0');

    const result = await installPluginFromRemoteAndActivate({
      db,
      userPluginRoot,
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      knownPlugins: [platformMeta, mindmapMeta],
      fetch: createFetch(zipBuffer),
      resolveUpgradePlan: ({ pluginId, version }) => ({
        pluginId,
        targetVersion: version,
        ownedTables: ['plugin_owned'],
        migrations: [],
      }),
    });

    expect(result).toMatchObject({
      status: 'skipped',
      pluginId: 'mindmap',
      version: '1.1.0',
      reason: 'current',
    });
    expect(new PluginStateService(db).getEnabledIds()).not.toContain('mindmap');
  });

  it('restores missing state and removal marker when activation fails', async () => {
    const zipBuffer = await createPluginZip('1.1.0');

    const result = await installPluginFromRemoteAndActivate({
      db,
      userPluginRoot,
      pluginId: 'mindmap',
      latestManifestUrl: latestUrl,
      appVersion: '0.0.36',
      rendererUiVersion: '1.0.0',
      knownPlugins: [platformMeta, mindmapMeta],
      fetch: createFetch(zipBuffer),
      resolveUpgradePlan: ({ pluginId, version }) => ({
        pluginId,
        targetVersion: version,
        ownedTables: ['plugin_owned'],
        migrations: [
          { version: 1, description: 'already applied', up: () => {} },
          {
            version: 2,
            description: 'fail',
            up: () => {
              throw new Error('planned activation failure');
            },
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'mindmap',
      version: '1.1.0',
    });
    if (result.status !== 'failed') {
      throw new Error('expected remote install to fail');
    }
    expect(result.error).toContain('planned activation failure');
    expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/active.json'))).toBe(false);
    expect(isPluginUserRemoved(userPluginRoot, 'mindmap')).toBe(true);
    expect(new PluginStateService(db).getInstalledRecord('mindmap')).toMatchObject({
      installed: false,
      userRemoved: true,
      version: '1.0.0',
      schemaVersion: 1,
    });
    expect(db.prepare("SELECT value FROM plugin_owned WHERE id = 'row-1'").get()).toEqual({
      value: 'before',
    });
  });
});
