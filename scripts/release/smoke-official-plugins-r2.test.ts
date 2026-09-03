import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { PLATFORM_PLUGIN_META } from '../../src/app-hosts/linnya/plugin-registry/builtin/platform-meta';
import { resolveDiskPluginUpgradePlan } from '../../src/electron-main/plugins/install/diskPluginUpgradePlan';
import { PluginStateService } from '../../src/features/plugins/infrastructure/sqlite/plugin-state.service';
import { isPluginUserRemoved, markPluginUserRemoved } from '../../src/features/plugins/install/functions/pluginRemovalMarker';
import { installPluginFromRemoteAndActivate } from '../../src/features/plugins/install/orchestration/installPluginFromRemoteAndActivate';
import { CORE_SCHEMAS } from '../../src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from '../../src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { parsePluginManifest, pluginMetaFromManifest } from '@app/schemas';
import { RENDERER_UI_VERSION } from '@linnya/renderer-ui/version';
import { officialPluginReleaseTargets } from './plugin-release-targets.mjs';

const appVersion = process.env.APP_VERSION ?? '0.0.38';
const runSmoke = process.env.LINNYA_R2_SMOKE === '1' ? it : it.skip;

interface LatestManifest {
  readonly version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildPluginEnvSuffix(pluginId: string): string {
  return pluginId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveLatestManifestUrl(pluginId: string): string {
  const suffix = buildPluginEnvSuffix(pluginId);
  const explicit = process.env[`LINNYA_PLUGIN_${suffix}_LATEST_URL`];
  if (explicit) return explicit;
  const rootUrl = process.env.LINNYA_PLUGIN_DOWNLOAD_ROOT_URL ?? 'https://download.linnyai.com/plugins';
  return `${rootUrl.replace(/\/+$/u, '')}/${pluginId}/latest.json`;
}

async function readLatestManifest(pluginId: string): Promise<LatestManifest> {
  const latestManifestUrl = resolveLatestManifestUrl(pluginId);
  const response = await fetch(latestManifestUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${pluginId} R2 smoke failed to fetch latest manifest: ${response.status}`);
  }
  const parsed: unknown = await response.json();
  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    throw new Error(`${pluginId} R2 smoke latest manifest must contain a string version`);
  }
  return { version: parsed.version };
}

function createPluginTables(db: Database.Database): void {
  for (const ddl of CORE_SCHEMAS) {
    db.exec(ddl);
  }
  for (const ddl of WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS) {
    db.exec(ddl);
  }

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
  `);
}

function readCount(db: Database.Database, sql: string, params: readonly unknown[] = []): number {
  const value: unknown = db.prepare(sql).pluck().get(...params);
  if (typeof value !== 'number') {
    throw new Error(`R2 smoke count query did not return a number: ${sql}`);
  }
  return value;
}

function readActiveVersion(userPluginRoot: string, pluginId: string): string | null {
  const activePath = path.join(userPluginRoot, pluginId, 'active.json');
  if (!fs.existsSync(activePath)) return null;

  const parsed: unknown = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    throw new Error(`${pluginId} active.json must contain a string version`);
  }
  return parsed.version;
}

function readSourceManifest(pluginId: string) {
  const manifestPath = path.join(process.cwd(), 'packages/plugins', pluginId, 'plugin.json');
  return parsePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
}

describe('Official plugin R2 release smoke', () => {
  runSmoke.each(officialPluginReleaseTargets)(
    '$id downloads, activates and migrates the public R2 artifact',
    async (target) => {
      const pluginId = target.id;
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `linnya-plugin-${pluginId}-r2-smoke-`));
      const userPluginRoot = path.join(tempRoot, 'plugins');
      const db = new Database(':memory:');
      const latestManifest = await readLatestManifest(pluginId);
      const sourceManifest = readSourceManifest(pluginId);
      const migrations = sourceManifest.migrations ?? [];
      const expectedSchemaVersion = migrations.at(-1)?.version ?? 0;
      const ownedTables = sourceManifest.ownedTables ?? [];

      try {
        createPluginTables(db);

        const knownPlugins = [
          PLATFORM_PLUGIN_META,
          pluginMetaFromManifest(sourceManifest, { builtin: true, required: false }),
        ];
        const stateService = new PluginStateService(db);
        stateService.ensureBuiltinInstalled(knownPlugins);
        stateService.setInstalled(pluginId, false, knownPlugins);
        stateService.setUserRemoved(pluginId, true);
        markPluginUserRemoved(userPluginRoot, pluginId, Date.now());

        const result = await installPluginFromRemoteAndActivate({
          db,
          userPluginRoot,
          pluginId,
          latestManifestUrl: resolveLatestManifestUrl(pluginId),
          appVersion,
          rendererUiVersion: RENDERER_UI_VERSION,
          knownPlugins,
          resolveUpgradePlan: resolveDiskPluginUpgradePlan,
        });

        const installedRecord = stateService.getInstalledRecord(pluginId);
        const migrationCount = readCount(
          db,
          'SELECT COUNT(*) FROM plugin_migrations WHERE plugin_id = ?',
          [pluginId],
        );
        const ownedTableCount = ownedTables.length === 0
          ? 0
          : readCount(
            db,
            `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (${ownedTables.map(() => '?').join(', ')})`,
            ownedTables,
          );

        expect(result).toMatchObject({
          status: 'installed',
          pluginId,
          version: latestManifest.version,
          restartRequired: true,
        });
        expect(installedRecord).toMatchObject({
          version: latestManifest.version,
          installed: true,
          userRemoved: false,
          schemaVersion: expectedSchemaVersion,
        });
        expect(stateService.getEnabledIds()).toContain(pluginId);
        expect(readActiveVersion(userPluginRoot, pluginId)).toBe(latestManifest.version);
        expect(isPluginUserRemoved(userPluginRoot, pluginId)).toBe(false);
        expect(migrationCount).toBe(migrations.length);
        expect(ownedTableCount).toBe(ownedTables.length);
      } finally {
        db.close();
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );
});
