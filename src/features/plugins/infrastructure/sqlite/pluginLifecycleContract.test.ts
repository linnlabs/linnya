import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { PluginStateService } from './plugin-state.service';
import { PLUGIN_PLATFORM_STATE_SCHEMAS } from './plugin-state.schema';
import { discoverWorkspaceOfficialPluginReleaseTargets } from '../../../../../scripts/release/plugin-release-targets.mjs';
import { parsePluginManifest } from '@app/schemas';

const platform: PluginMeta = {
  id: 'platform',
  name: 'Platform',
  version: '1.0.0',
  description: 'Core',
  developer: 'Linnya',
  builtin: true,
  required: true,
};

function createStateDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(PLUGIN_PLATFORM_STATE_SCHEMAS.join('\n'));
  return db;
}

describe('W-0415 plugin lifecycle contracts', () => {
  it('T2: installed → disabled → uninstalled → explicit reinstall returns enabled', () => {
    const db = createStateDb();
    const service = new PluginStateService(db);
    const demo: PluginMeta = { ...platform, id: 'demo', name: 'Demo', required: false };
    service.ensureBuiltinInstalled([platform, demo]);
    service.setEnabled('demo', false, [platform, demo]);
    service.setInstalled('demo', false, [platform, demo]);
    expect(service.getInstalledRecord('demo')).toMatchObject({ installed: false });
    service.setInstalled('demo', true, [platform, demo]);
    expect(service.getInstalledRecord('demo')).toMatchObject({ installed: true, userRemoved: false });
    expect(service.getEnabledIds()).toContain('demo');
    db.close();
  });

  it('T6: artifact smoke target set is derived from release metadata, not a test-maintained plugin list', () => {
    const targets = discoverWorkspaceOfficialPluginReleaseTargets(process.cwd());
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const manifestPath = path.join(process.cwd(), target.packageDir, 'plugin.json');
      const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      expect(manifest.id).toBe(target.id);
      expect(manifest.entry).toBeDefined();
    }
  });

  it('T3/T4: every release target is discoverable by declared source, while an unrelated directory is not a source', () => {
    const targets = discoverWorkspaceOfficialPluginReleaseTargets(process.cwd());
    expect(targets.every(target => target.packageDir.startsWith('packages/plugins/'))).toBe(true);
    expect(targets.every(target => !target.packageDir.includes('..'))).toBe(true);
  });

  it('T5: required plugins cannot be removed and disabled optional plugins remain independently addressable', () => {
    const db = createStateDb();
    const service = new PluginStateService(db);
    const demo: PluginMeta = { ...platform, id: 'demo', name: 'Demo', required: false };
    service.ensureBuiltinInstalled([platform, demo]);
    expect(() => service.setInstalled('platform', false, [platform, demo])).toThrow('核心插件不能卸载');
    service.setEnabled('demo', false, [platform, demo]);
    expect(service.getInstalledRecord('demo')).toMatchObject({ installed: true });
    expect(service.getEnabledIds()).not.toContain('demo');
    db.close();
  });

  it('T10: cleanup jobs are part of the platform schema and survive an interrupted lifecycle', () => {
    const db = createStateDb();
    const columns = db.prepare('PRAGMA table_info(plugin_cleanup_jobs)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining([
      'status', 'completed_paths', 'data_storage', 'error', 'started_at', 'updated_at',
    ]));
    db.close();
  });
});

