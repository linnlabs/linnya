import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { activatePluginVersionWithMigrations } from '../../../../features/plugins/install/orchestration/activatePluginVersionWithMigrations';
import { installPluginUpdateFromRemote } from '../../../../features/plugins/install/orchestration/installPluginUpdate';
import {
  bootstrapBuiltinPluginLifecycle,
  ensureBuiltinBackendPluginsRegistered,
  getRegisteredBackendPluginIpcChannels,
  registerRegisteredBackendPluginIpcHandlers,
  resetBackendPluginRegistrationForRuntimeChange,
} from '../../../../app-hosts/linnya/plugin-registry/builtin';
import {
  clearPluginRuntimeDatabaseForTests,
  clearPluginRuntimeStateForTests,
  setPluginRuntimeDatabase,
} from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  clearBackendPluginIpcHandlersForTest,
  invokeBackendPluginIpcHandler,
} from '@plugin/backend/pluginIpcRuntime';
import { loadBackendPluginsFromDisk } from '../diskPluginLoader';
import { listRendererPluginEntriesFromLayout } from '../rendererPluginEntries';
import { seedBundledPlugins } from '../pluginRuntimeBootstrap';
import { listOfficialPluginReleaseTargetIds } from '../../../../../scripts/release/plugin-release-targets.mjs';

const latestUrl = 'https://download.linnyai.com/plugins/mindmap/latest.json';
const artifactUrl = 'https://download.linnyai.com/plugins/mindmap/mindmap-1.1.0.zip';
const tempRoots: string[] = [];

const fakeTsServiceManager = {
  getServices: () => ({
    databaseService: {
      getDb: () => ({}) as never,
    },
  }),
};

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-runtime-scenarios-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createBackendContributionSource(
  pluginId: string,
  version: string,
  options: { readonly ipc?: boolean } = {},
): string {
  return `
    module.exports.backendPlugin = {
      meta: {
        id: '${pluginId}',
        name: '${pluginId}',
        version: '${version}',
        description: '${pluginId} plugin',
        developer: 'Linnya',
        builtin: false,
      },
      ownedTables: ['plugin_owned'],
      pluginMigrations: [
        { version: 1, description: 'baseline', up: function () {} },
      ],
      ${options.ipc === true ? `
      ipc: {
        channels: ['${pluginId}:version'],
        register: function (_serviceManager, registrar) {
          registrar('${pluginId}', '${pluginId}:version', function () {
            return { version: '${version}' };
          });
        },
      },
      ` : ''}
    };
  `;
}

function writePluginArtifact(
  pluginDir: string,
  pluginId: string,
  version: string,
  backendSource?: string,
  options: { readonly ipc?: boolean } = {},
): void {
  writeJson(path.join(pluginDir, 'plugin.json'), {
    id: pluginId,
    version,
    name: pluginId,
    description: `${pluginId} plugin`,
    developer: 'Linnya',
    details: [`${pluginId} plugin detail`],
    entry: {
      backend: './dist/backend/index.cjs',
      renderer: './dist/renderer/index.js',
    },
    compat: { rendererUi: '^1.0.0' },
  });
  fs.mkdirSync(path.join(pluginDir, 'dist/backend'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'dist/renderer/assets'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'dist/backend/index.cjs'),
    backendSource ?? createBackendContributionSource(pluginId, version, options),
    'utf8',
  );
  fs.writeFileSync(path.join(pluginDir, 'dist/renderer/index.js'), 'export const rendererPlugin = {};', 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'dist/renderer/assets/style.css'), '', 'utf8');
  writeJson(path.join(pluginDir, 'dist/renderer/renderer-stylesheets.json'), {
    schemaVersion: 1,
    stylesheets: ['assets/style.css'],
  });
}

function createPluginStateDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      required INTEGER NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0,
      compat_min TEXT,
      source TEXT NOT NULL DEFAULT 'remote',
      user_removed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, version)
    );

    CREATE TABLE enabled_plugins (
      plugin_id TEXT PRIMARY KEY,
      enabled_at INTEGER NOT NULL
    );

    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      last_opened_at INTEGER,
      access_count INTEGER DEFAULT 0,
      tags TEXT
    );

    CREATE TABLE workspace_node_text_snapshots (
      node_id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      text TEXT NOT NULL,
      source_plugin_id TEXT,
      source_node_type TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE plugin_owned (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT INTO installed_plugins
      (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, source)
    VALUES ('mindmap', '1.0.0', 'Mindmap', 1, 0, 0, 123, 1, 'remote');

    INSERT INTO plugin_migrations (plugin_id, version, applied_at)
    VALUES ('mindmap', 1, 123);

    INSERT INTO enabled_plugins (plugin_id, enabled_at)
    VALUES ('mindmap', 123);

    INSERT INTO plugin_owned (id, value)
    VALUES ('row-1', 'before');
  `);
  return db;
}

function createFreshPluginStateDatabase(): Database.Database {
  const db = createPluginStateDatabase();
  db.exec(`
    DELETE FROM plugin_migrations WHERE plugin_id = 'mindmap';
    DELETE FROM installed_plugins WHERE plugin_id = 'mindmap';
    DELETE FROM enabled_plugins WHERE plugin_id = 'mindmap';
  `);
  return db;
}

async function createPluginZip(version: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('plugin.json', `${JSON.stringify({
    id: 'mindmap',
    version,
    name: 'Mindmap',
    description: 'Mindmap plugin',
    developer: 'Linnya',
    details: ['Mindmap plugin detail'],
    entry: {
      backend: './dist/backend/index.cjs',
      renderer: './dist/renderer/index.js',
    },
    compat: { rendererUi: '^1.0.0' },
  }, null, 2)}\n`);
  zip.file('dist/backend/index.cjs', createBackendContributionSource('mindmap', version));
  zip.file('dist/renderer/index.js', 'export const rendererPlugin = {};');
  zip.file('dist/renderer/renderer-stylesheets.json', `${JSON.stringify({
    schemaVersion: 1,
    stylesheets: [],
  }, null, 2)}\n`);
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

function createFetch(routes: ReadonlyMap<string, () => Response>): typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routes.get(url);
    return route ? route() : new Response('not found', { status: 404, statusText: 'Not Found' });
  };
}

afterEach(() => {
  resetBackendPluginRegistrationForRuntimeChange();
  clearBackendPluginIpcHandlersForTest();
  clearPluginRuntimeStateForTests();
  clearPluginRuntimeDatabaseForTests();
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin runtime loading scenarios', () => {
  it('预置 seed 覆盖所有官方插件 release target，避免某个插件只进 known meta 不进 artifact 生命周期', () => {
    const tempRoot = makeTempRoot();
    const bundledPluginRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    const officialPluginIds = listOfficialPluginReleaseTargetIds();

    for (const pluginId of officialPluginIds) {
      writePluginArtifact(path.join(bundledPluginRoot, pluginId), pluginId, '1.0.0');
    }

    const seedResults = seedBundledPlugins({
      bundledPluginRoot,
      userPluginRoot,
    });

    expect(seedResults.map((result) => result.pluginId).sort()).toEqual([...officialPluginIds].sort());
    for (const pluginId of officialPluginIds) {
      expect(seedResults.find((result) => result.pluginId === pluginId)).toMatchObject({
        pluginId,
        version: '1.0.0',
        status: 'staged',
      });
      expect(fs.existsSync(path.join(userPluginRoot, pluginId, '1.0.0', 'plugin.json'))).toBe(true);
      expect(fs.existsSync(path.join(userPluginRoot, pluginId, 'active.json'))).toBe(false);
    }
  });

  it('全新安装断网首启时从预置 artifact stage，经 DB lifecycle 激活后发现 backend/renderer 入口', () => {
    const tempRoot = makeTempRoot();
    const bundledPluginRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writePluginArtifact(path.join(bundledPluginRoot, 'mindmap'), 'mindmap', '1.0.0');

    const previousPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
    const previousBundledPluginRoot = process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
    const previousBackendLoading = process.env.LINNYA_PLUGIN_BACKEND_LOADING;
    const db = createFreshPluginStateDatabase();
    try {
      process.env.LINNYA_PLUGIN_ROOT = userPluginRoot;
      process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = bundledPluginRoot;
      process.env.LINNYA_PLUGIN_BACKEND_LOADING = 'disk';
      const seedResults = seedBundledPlugins({
        bundledPluginRoot,
        userPluginRoot,
      });
      expect(seedResults).toMatchObject([{ pluginId: 'mindmap', version: '1.0.0', status: 'staged' }]);
      expect(fs.existsSync(path.join(userPluginRoot, 'mindmap/active.json'))).toBe(false);

      bootstrapBuiltinPluginLifecycle(db, '0.0.38');
      const backendPlugins = loadBackendPluginsFromDisk({
        pluginRoot: userPluginRoot,
        appVersion: '0.0.36',
      });
      const rendererEntries = listRendererPluginEntriesFromLayout({
        pluginRoot: userPluginRoot,
        enabledIds: new Set(['mindmap']),
      });

      expect(backendPlugins[0]?.contribution.meta).toMatchObject({ id: 'mindmap', version: '1.0.0' });
      expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))).toEqual({
        version: '1.0.0',
      });
      expect(rendererEntries).toEqual([
        expect.objectContaining({
          pluginId: 'mindmap',
          version: '1.0.0',
          rendererUiRange: '^1.0.0',
          entryUrl: 'plugin://mindmap/dist/renderer/index.js',
          cssUrls: ['plugin://mindmap/dist/renderer/assets/style.css'],
          sourceKind: 'active',
        }),
      ]);
    } finally {
      if (previousPluginRoot === undefined) {
        delete process.env.LINNYA_PLUGIN_ROOT;
      } else {
        process.env.LINNYA_PLUGIN_ROOT = previousPluginRoot;
      }
      if (previousBundledPluginRoot === undefined) {
        delete process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
      } else {
        process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = previousBundledPluginRoot;
      }
      if (previousBackendLoading === undefined) {
        delete process.env.LINNYA_PLUGIN_BACKEND_LOADING;
      } else {
        process.env.LINNYA_PLUGIN_BACKEND_LOADING = previousBackendLoading;
      }
      db.close();
    }
  });

  it('随包升级激活后记录 previousVersion，供后续加载失败回滚', () => {
    const tempRoot = makeTempRoot();
    const bundledPluginRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writePluginArtifact(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0');
    writePluginArtifact(path.join(bundledPluginRoot, 'mindmap'), 'mindmap', '1.1.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });

    const previousPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
    const previousBundledPluginRoot = process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
    const previousBackendLoading = process.env.LINNYA_PLUGIN_BACKEND_LOADING;
    const db = createPluginStateDatabase();
    try {
      process.env.LINNYA_PLUGIN_ROOT = userPluginRoot;
      process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = bundledPluginRoot;
      process.env.LINNYA_PLUGIN_BACKEND_LOADING = 'disk';
      const seedResults = seedBundledPlugins({
        bundledPluginRoot,
        userPluginRoot,
      });
      expect(seedResults).toMatchObject([{ pluginId: 'mindmap', version: '1.1.0', status: 'update-staged' }]);

      bootstrapBuiltinPluginLifecycle(db, '0.0.38');

      expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))).toEqual({
        version: '1.1.0',
        previousVersion: '1.0.0',
      });
    } finally {
      if (previousPluginRoot === undefined) {
        delete process.env.LINNYA_PLUGIN_ROOT;
      } else {
        process.env.LINNYA_PLUGIN_ROOT = previousPluginRoot;
      }
      if (previousBundledPluginRoot === undefined) {
        delete process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
      } else {
        process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = previousBundledPluginRoot;
      }
      if (previousBackendLoading === undefined) {
        delete process.env.LINNYA_PLUGIN_BACKEND_LOADING;
      } else {
        process.env.LINNYA_PLUGIN_BACKEND_LOADING = previousBackendLoading;
      }
      db.close();
    }
  });

  it('随包升级激活后重建 backend registry 和 IPC handler，避免继续调用旧版本', async () => {
    const tempRoot = makeTempRoot();
    const bundledPluginRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    writePluginArtifact(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0', undefined, { ipc: true });
    writePluginArtifact(path.join(bundledPluginRoot, 'mindmap'), 'mindmap', '1.1.0', undefined, { ipc: true });
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });

    const previousPluginRoot = process.env.LINNYA_PLUGIN_ROOT;
    const previousBundledPluginRoot = process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
    const previousBackendLoading = process.env.LINNYA_PLUGIN_BACKEND_LOADING;
    const db = createPluginStateDatabase();
    try {
      process.env.LINNYA_PLUGIN_ROOT = userPluginRoot;
      process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = bundledPluginRoot;
      process.env.LINNYA_PLUGIN_BACKEND_LOADING = 'disk';
      setPluginRuntimeDatabase(db);

      seedBundledPlugins({ bundledPluginRoot, userPluginRoot });
      resetBackendPluginRegistrationForRuntimeChange();
      ensureBuiltinBackendPluginsRegistered({ applicationVersion: '0.0.38' });
      expect(getRegisteredBackendPluginIpcChannels('mindmap')).toEqual(['mindmap:version']);
      // 中文说明：这个用例只验证 Mindmap 磁盘插件热切换。测试环境会让
      // 其他已注册插件可见，但它们的 IPC 依赖完整 workspace DB，
      // 不属于本用例关注面。
      db.prepare("DELETE FROM enabled_plugins WHERE plugin_id NOT IN ('platform', 'mindmap')").run();
      registerRegisteredBackendPluginIpcHandlers(fakeTsServiceManager);
      await expect(invokeBackendPluginIpcHandler('mindmap', 'mindmap:version', {}, {}))
        .resolves.toEqual({ version: '1.0.0' });

      bootstrapBuiltinPluginLifecycle(db, '0.0.38');
      db.prepare("DELETE FROM enabled_plugins WHERE plugin_id NOT IN ('platform', 'mindmap')").run();
      registerRegisteredBackendPluginIpcHandlers(fakeTsServiceManager);

      expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))).toEqual({
        version: '1.1.0',
        previousVersion: '1.0.0',
      });
      expect(getRegisteredBackendPluginIpcChannels('mindmap')).toEqual(['mindmap:version']);
      await expect(invokeBackendPluginIpcHandler('mindmap', 'mindmap:version', {}, {}))
        .resolves.toEqual({ version: '1.1.0' });
    } finally {
      if (previousPluginRoot === undefined) {
        delete process.env.LINNYA_PLUGIN_ROOT;
      } else {
        process.env.LINNYA_PLUGIN_ROOT = previousPluginRoot;
      }
      if (previousBundledPluginRoot === undefined) {
        delete process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
      } else {
        process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT = previousBundledPluginRoot;
      }
      if (previousBackendLoading === undefined) {
        delete process.env.LINNYA_PLUGIN_BACKEND_LOADING;
      } else {
        process.env.LINNYA_PLUGIN_BACKEND_LOADING = previousBackendLoading;
      }
      db.close();
    }
  });

  it('R2 升级下载校验后可激活新版本，并执行插件迁移', async () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    writePluginArtifact(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0');
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), { version: '1.0.0' });
    const zipBuffer = await createPluginZip('1.1.0');
    const fetcher = createFetch(new Map([
      [latestUrl, () => new Response(JSON.stringify({
        version: '1.1.0',
        minApp: '0.0.36',
        rendererUi: '^1.0.0',
        url: artifactUrl,
        sha512: sha512Hex(zipBuffer),
      }))],
      [artifactUrl, () => new Response(toArrayBuffer(zipBuffer))],
    ]));
    const db = createPluginStateDatabase();

    try {
      const installResult = await installPluginUpdateFromRemote({
        pluginId: 'mindmap',
        latestManifestUrl: latestUrl,
        userPluginRoot,
        appVersion: '0.0.36',
        rendererUiVersion: '1.0.0',
        fetch: fetcher,
      });
      const activationResult = activatePluginVersionWithMigrations({
        db,
        userPluginRoot,
        pluginId: 'mindmap',
        version: '1.1.0',
        appVersion: '0.0.36',
        upgradePlan: {
          pluginId: 'mindmap',
          targetVersion: '1.1.0',
          ownedTables: ['plugin_owned'],
          migrations: [
            { version: 1, description: 'already applied', up: () => {} },
            {
              version: 2,
              description: 'mark upgraded rows',
              up: (migrationDb) => {
                migrationDb.exec("UPDATE plugin_owned SET value = 'after-upgrade' WHERE id = 'row-1';");
              },
            },
          ],
        },
      });
      const loaded = loadBackendPluginsFromDisk({
        pluginRoot: userPluginRoot,
        appVersion: '0.0.36',
      });

      expect(installResult).toMatchObject({ status: 'staged', version: '1.1.0' });
      expect(activationResult).toMatchObject({ status: 'activated', version: '1.1.0' });
      expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))).toEqual({
        version: '1.1.0',
        previousVersion: '1.0.0',
      });
      expect(loaded[0]?.contribution.meta.version).toBe('1.1.0');
      expect(db.prepare("SELECT version, schema_version FROM installed_plugins WHERE plugin_id = 'mindmap'").get()).toEqual({
        version: '1.1.0',
        schema_version: 2,
      });
      expect(db.prepare("SELECT value FROM plugin_owned WHERE id = 'row-1'").get()).toEqual({
        value: 'after-upgrade',
      });
    } finally {
      db.close();
    }
  });

  it('坏 backend 版本启动失败时回滚 active 并加载旧版本', () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');
    writePluginArtifact(path.join(userPluginRoot, 'mindmap/1.0.0'), 'mindmap', '1.0.0');
    writePluginArtifact(
      path.join(userPluginRoot, 'mindmap/1.1.0'),
      'mindmap',
      '1.1.0',
      'throw new Error("broken backend");',
    );
    writeJson(path.join(userPluginRoot, 'mindmap/active.json'), {
      version: '1.1.0',
      previousVersion: '1.0.0',
    });

    const loaded = loadBackendPluginsFromDisk({
      pluginRoot: userPluginRoot,
      appVersion: '0.0.36',
    });

    expect(loaded[0]?.contribution.meta.version).toBe('1.0.0');
    expect(JSON.parse(fs.readFileSync(path.join(userPluginRoot, 'mindmap/active.json'), 'utf8'))).toEqual({
      version: '1.0.0',
    });
  });

  it('删掉插件目录后主应用侧发现结果为空，不抛异常', () => {
    const tempRoot = makeTempRoot();
    const userPluginRoot = path.join(tempRoot, 'plugins');

    expect(loadBackendPluginsFromDisk({ pluginRoot: userPluginRoot, appVersion: '0.0.36' })).toEqual([]);
    expect(listRendererPluginEntriesFromLayout({
      pluginRoot: userPluginRoot,
      enabledIds: new Set(['mindmap']),
    })).toEqual([]);
  });
});
