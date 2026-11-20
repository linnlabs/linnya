import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginMeta } from '@app/schemas';
import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';

import { PluginStateService } from './plugin-state.service';
import { PLUGIN_PLATFORM_STATE_SCHEMAS } from './plugin-state.schema';
import { listOfficialPluginReleaseTargetIds } from '../../../../../scripts/release/plugin-release-targets.mjs';
import { PluginActiveVersionService } from './plugin-active-version.service';
import { installPluginFromBundledAndActivate } from '../../install/orchestration/installPluginFromBundledAndActivate';
import { uninstallPluginLifecycle } from '../../install/orchestration/uninstallPluginLifecycle';
import { activatePluginVersionWithMigrations } from '../../install/orchestration/activatePluginVersionWithMigrations';
import { isPluginUserRemoved } from '../../install/functions/pluginRemovalMarker';
import { seedBundledPlugins, stageBundledPluginForExplicitInstall } from '../../../../electron-main/plugins/loader/pluginRuntimeBootstrap';

const platform: PluginMeta = {
  id: 'platform',
  name: 'Platform',
  version: '1.0.0',
  description: 'Core',
  developer: 'Linnya',
  builtin: true,
  required: true,
};

function createStateDb(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  db.exec(PLUGIN_PLATFORM_STATE_SCHEMAS.join('\n'));
  return db;
}

const releaseTargets = listOfficialPluginReleaseTargetIds().map(id => ({ id }));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeArtifact(pluginDir: string, plugin: PluginMeta): void {
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    ...plugin, entry: { backend: './backend.cjs' }, details: ['Lifecycle fixture'],
  }));
  fs.writeFileSync(path.join(pluginDir, 'backend.cjs'), 'module.exports = {};');
  fs.writeFileSync(path.join(pluginDir, 'SHA512SUMS'), `fixture ${plugin.version}\n`);
}

describe('plugin lifecycle contracts', () => {
  it.each(releaseTargets)('$id: persists coherent install, removal, reinstall and migration rollback', ({ id }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-lifecycle-'));
    roots.push(root);
    const databasePath = path.join(root, 'workspace.sqlite');
    const bundledPluginRoot = path.join(root, 'bundled');
    const userPluginRoot = path.join(root, 'installed');
    const activePointer = path.join(userPluginRoot, id, 'active.json');
    const plugin: PluginMeta = { ...platform, id, name: id, required: false, dependsOn: [platform.id] };
    const knownPlugins = [platform, plugin];
    writeArtifact(path.join(bundledPluginRoot, id), plugin);
    const original = path.join(root, 'original.md');
    const index = path.join(root, 'index.bin');
    const firstMigration = vi.fn<PluginMigrationDefinition['up']>(db => {
      db.exec('CREATE TABLE plugin_owned (id TEXT PRIMARY KEY, payload TEXT)');
    });
    const migrations = [{ version: 1, description: 'Initial', up: firstMigration }];
    let db = createStateDb(databasePath);
    try {
      new PluginStateService(db).ensureBuiltinInstalled([platform]);
      const stageOptions = { pluginId: id, bundledPluginRoot, userPluginRoot };
      const install = () => installPluginFromBundledAndActivate({
        db, userPluginRoot, pluginId: id, appVersion: '1.0.0', knownPlugins,
        stageBundledPlugin: () => stageBundledPluginForExplicitInstall(stageOptions),
        resolveUpgradePlan: ({ version }) => ({ pluginId: id, targetVersion: version, ownedTables: ['plugin_owned'], migrations }),
      });
      const readState = () => new PluginStateService(db).listStates(knownPlugins).find(item => item.meta.id === id);
      const assertActive = (version: string) => {
        expect(new PluginStateService(db).getInstalledRecord(id)).toMatchObject({ installed: true, userRemoved: false, version });
        expect(new PluginActiveVersionService(db).getRecord(id)).toMatchObject({ activeVersion: version, status: 'active' });
        expect(JSON.parse(fs.readFileSync(activePointer, 'utf8'))).toMatchObject({ version });
        expect(isPluginUserRemoved(userPluginRoot, id)).toBe(false);
      };
      expect(readState()).toMatchObject({ state: 'missing', reason: '插件未安装' });
      expect(install()).toMatchObject({ status: 'installed' });
      assertActive('1.0.0');
      expect(readState()?.state).toBe('enabled');
      db.exec("INSERT INTO plugin_owned VALUES ('fixture', 'retained')");
      fs.writeFileSync(original, 'source bytes');
      fs.writeFileSync(index, 'index bytes');
      const indexIdentity = fs.statSync(index);
      const ledger = () => db.prepare('SELECT version, applied_at FROM plugin_migrations WHERE plugin_id = ? ORDER BY version').all(id);
      const beforeLedger = ledger();
      const state = new PluginStateService(db);
      state.setEnabled(id, false, knownPlugins);
      expect(readState()?.state).toBe('disabled');
      assertActive('1.0.0');
      state.setEnabled(id, true, knownPlugins);
      expect(readState()?.state).toBe('enabled');
      expect(uninstallPluginLifecycle({ db, userPluginRoot, pluginId: id, knownPlugins })).toMatchObject({ status: 'uninstalled', userDataPreserved: true });
      expect(new PluginActiveVersionService(db).getRecord(id)).toBeNull();
      expect(fs.existsSync(activePointer)).toBe(false);
      expect(isPluginUserRemoved(userPluginRoot, id)).toBe(true);
      db.close();
      db = new Database(databasePath);
      expect(seedBundledPlugins({ bundledPluginRoot, userPluginRoot })).toMatchObject([{ pluginId: id, status: 'skipped' }]);
      expect(fs.existsSync(path.join(userPluginRoot, id, '1.0.0'))).toBe(false);
      expect(readState()).toMatchObject({ state: 'missing', reason: '用户已卸载该插件' });
      expect(new PluginStateService(db).getInstalledRecord(id)).toMatchObject({ installed: false, userRemoved: true });
      expect(install()).toMatchObject({ status: 'installed' });
      expect(readState()?.state).toBe('enabled');
      assertActive('1.0.0');
      expect(db.prepare('SELECT * FROM plugin_owned').all()).toEqual([{ id: 'fixture', payload: 'retained' }]);
      expect(ledger()).toEqual(beforeLedger);
      expect(firstMigration).toHaveBeenCalledOnce();
      expect(fs.readFileSync(original, 'utf8')).toBe('source bytes');
      expect(fs.readFileSync(index, 'utf8')).toBe('index bytes');
      expect(fs.statSync(index)).toMatchObject({ ino: indexIdentity.ino, mtimeMs: indexIdentity.mtimeMs });

      const upgrade = (version: string, up: PluginMigrationDefinition['up'], migrationVersion: number) => {
        writeArtifact(path.join(userPluginRoot, id, version), { ...plugin, version });
        return activatePluginVersionWithMigrations({
          db, userPluginRoot, pluginId: id, version, appVersion: '1.0.0',
          upgradePlan: { pluginId: id, targetVersion: version, ownedTables: ['plugin_owned'], migrations: [
            ...migrations, { version: migrationVersion, description: 'Upgrade', up },
          ] },
        });
      };
      expect(upgrade('1.1.0', database => { database.exec("UPDATE plugin_owned SET payload = 'upgraded'"); }, 2))
        .toMatchObject({ status: 'activated', previousVersion: '1.0.0' });
      assertActive('1.1.0');
      expect(upgrade('1.2.0', database => {
        database.exec('DELETE FROM plugin_owned');
        throw new Error('fixture migration failure');
      }, 3)).toMatchObject({ status: 'failed', errorCode: 'migration-failed' });
      assertActive('1.1.0');
      expect(ledger()).toMatchObject([{ version: 1 }, { version: 2 }]);
      expect(db.prepare('SELECT * FROM plugin_owned').all()).toEqual([{ id: 'fixture', payload: 'upgraded' }]);
    } finally {
      db.close();
    }
  });

  it('protects required plugins while keeping optional plugins independently addressable', () => {
    const db = createStateDb(':memory:');
    const service = new PluginStateService(db);
    const demo: PluginMeta = { ...platform, id: 'demo', name: 'Demo', required: false };
    service.ensureBuiltinInstalled([platform, demo]);
    expect(() => service.setInstalled('platform', false, [platform, demo])).toThrow('核心插件不能卸载');
    service.setEnabled('demo', false, [platform, demo]);
    expect(service.getInstalledRecord('demo')).toMatchObject({ installed: true });
    expect(service.getEnabledIds()).not.toContain('demo');
    db.close();
  });
});

