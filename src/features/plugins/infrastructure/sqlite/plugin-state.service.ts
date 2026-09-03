import type Database from 'better-sqlite3';
import type { PluginId, PluginMeta, PluginSource, PluginStateView } from '@app/schemas';

interface InstalledPluginRow {
  plugin_id: string;
  version: string;
  schema_version: number;
  compat_min: string | null;
  source: PluginSource;
  installed: number;
  builtin: number;
  required: number;
  user_removed: number;
}

export interface InstalledPluginRecord {
  pluginId: PluginId;
  version: string;
  schemaVersion: number;
  compatMin: string | null;
  source: PluginSource;
  installed: boolean;
  builtin: boolean;
  required: boolean;
  userRemoved: boolean;
}

interface PluginStateSnapshot {
  installed: ReadonlySet<PluginId>;
  enabled: ReadonlySet<PluginId>;
}

export class PluginStateService {
  constructor(private readonly db: Database.Database) {}

  getEnabledIds(): PluginId[] {
    const rows = this.db.prepare('SELECT plugin_id FROM enabled_plugins').all() as Array<{ plugin_id: string }>;
    return rows.map((row) => row.plugin_id);
  }

  getInstalledRecord(pluginId: PluginId): InstalledPluginRecord | null {
    const row = this.db
      .prepare(`
        SELECT plugin_id, version, schema_version, compat_min, source, installed, builtin, required, user_removed
        FROM installed_plugins
        WHERE plugin_id = ?
      `)
      .get(pluginId) as InstalledPluginRow | undefined;

    return row ? toInstalledPluginRecord(row) : null;
  }

  setInstalled(pluginId: PluginId, installed: boolean, knownPlugins: readonly PluginMeta[] = []): void {
    const row = this.db
      .prepare(`
        SELECT plugin_id, version, schema_version, compat_min, source, installed, builtin, required, user_removed
        FROM installed_plugins
        WHERE plugin_id = ?
      `)
      .get(pluginId) as InstalledPluginRow | undefined;

    if (!row) {
      throw new Error(`未知插件，不能安装/卸载: ${pluginId}`);
    }
    if (!installed && row.required === 1) {
      throw new Error(`核心插件不能卸载: ${pluginId}`);
    }
    if (installed) {
      this.assertDependenciesEnabled(pluginId, knownPlugins);
    } else {
      this.assertNoEnabledDependents(pluginId, knownPlugins, '卸载');
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE installed_plugins
          SET installed = ?,
              user_removed = CASE WHEN ? = 1 THEN 0 ELSE user_removed END
          WHERE plugin_id = ?
        `)
        .run(installed ? 1 : 0, installed ? 1 : 0, pluginId);

      if (installed) {
        this.db
          .prepare('INSERT OR IGNORE INTO enabled_plugins (plugin_id, enabled_at) VALUES (?, ?)')
          .run(pluginId, Date.now());
      } else {
        this.db.prepare('DELETE FROM enabled_plugins WHERE plugin_id = ?').run(pluginId);
      }
    });
    tx();
  }

  setEnabled(pluginId: PluginId, enabled: boolean, knownPlugins: readonly PluginMeta[] = []): void {
    const row = this.db
      .prepare(`
        SELECT plugin_id, version, schema_version, compat_min, source, installed, builtin, required, user_removed
        FROM installed_plugins
        WHERE plugin_id = ?
      `)
      .get(pluginId) as InstalledPluginRow | undefined;

    if (!row || row.installed !== 1) {
      throw new Error(`插件未安装，不能启用/禁用: ${pluginId}`);
    }
    if (!enabled && row.required === 1) {
      throw new Error(`核心插件不能禁用: ${pluginId}`);
    }
    if (enabled) {
      this.assertDependenciesEnabled(pluginId, knownPlugins);
    } else {
      this.assertNoEnabledDependents(pluginId, knownPlugins, '禁用');
    }

    if (enabled) {
      this.db
        .prepare('INSERT OR IGNORE INTO enabled_plugins (plugin_id, enabled_at) VALUES (?, ?)')
        .run(pluginId, Date.now());
    } else {
      this.db.prepare('DELETE FROM enabled_plugins WHERE plugin_id = ?').run(pluginId);
    }
  }

  ensureBuiltinInstalled(builtins: readonly PluginMeta[]): void {
    const insertInstalled = this.db.prepare(`
      INSERT OR IGNORE INTO installed_plugins
        (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, compat_min, source, user_removed)
      VALUES (?, ?, ?, 1, 1, ?, ?, 0, ?, 'builtin', 0)
    `);
    const updateMeta = this.db.prepare(`
      UPDATE installed_plugins
      SET name = ?,
          version = CASE
            WHEN installed = 1 AND user_removed = 0 THEN ?
            ELSE version
          END,
          builtin = 1,
          required = ?,
          compat_min = ?,
          source = 'builtin',
          installed = CASE WHEN ? = 1 THEN 1 ELSE installed END,
          user_removed = CASE WHEN ? = 1 THEN 0 ELSE user_removed END
      WHERE plugin_id = ?
    `);
    const insertEnabled = this.db.prepare(
      'INSERT OR IGNORE INTO enabled_plugins (plugin_id, enabled_at) VALUES (?, ?)'
    );

    const now = Date.now();
    const tx = this.db.transaction(() => {
      for (const builtin of builtins) {
        const required = builtin.required ? 1 : 0;
        const compatMin = builtin.compatMin ?? null;
        const result = insertInstalled.run(builtin.id, builtin.version, builtin.name, required, now, compatMin);
        updateMeta.run(builtin.name, builtin.version, required, compatMin, required, required, builtin.id);

        // 中文说明：非 required 内置插件只在首次登记时默认启用，避免用户禁用后重启又被恢复。
        if (result.changes > 0 || required === 1) {
          insertEnabled.run(builtin.id, now);
        }
      }
    });
    tx();
  }

  ensureKnownPluginRegistered(meta: PluginMeta): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO installed_plugins
        (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, compat_min, source, user_removed)
      VALUES (?, ?, ?, 0, ?, ?, ?, 0, ?, ?, 0)
    `);

    insert.run(
      meta.id,
      meta.version,
      meta.name,
      meta.builtin ? 1 : 0,
      meta.required ? 1 : 0,
      Date.now(),
      meta.compatMin ?? null,
      meta.builtin ? 'builtin' : 'remote',
    );
  }

  listStates(knownPlugins: readonly PluginMeta[]): PluginStateView[] {
    const enabled = new Set(this.getEnabledIds());
    const rows = this.db.prepare('SELECT plugin_id, installed, user_removed FROM installed_plugins').all() as Array<{
      plugin_id: string;
      installed: number;
      user_removed: number;
    }>;
    const recordsByPluginId = new Map(rows.map((row) => [row.plugin_id, row]));
    const installed = new Set(rows.filter((row) => row.installed === 1).map((row) => row.plugin_id));

    return knownPlugins.map((meta) => {
      if (!installed.has(meta.id)) {
        const record = recordsByPluginId.get(meta.id);
        const reason = record?.user_removed === 1 ? '用户已卸载该插件' : '插件未安装';
        return { meta, state: 'missing' as const, reason };
      }
      return { meta, state: enabled.has(meta.id) ? 'enabled' as const : 'disabled' as const };
    });
  }

  setUserRemoved(pluginId: PluginId, userRemoved: boolean): void {
    const result = this.db
      .prepare('UPDATE installed_plugins SET user_removed = ? WHERE plugin_id = ?')
      .run(userRemoved ? 1 : 0, pluginId);
    if (result.changes === 0) {
      throw new Error(`未知插件，不能更新用户移除标记: ${pluginId}`);
    }
  }

  private readSnapshot(): PluginStateSnapshot {
    const enabled = new Set(this.getEnabledIds());
    const rows = this.db.prepare('SELECT plugin_id, installed FROM installed_plugins').all() as Array<{
      plugin_id: string;
      installed: number;
    }>;
    const installed = new Set(rows.filter((row) => row.installed === 1).map((row) => row.plugin_id));
    return { installed, enabled };
  }

  private assertDependenciesEnabled(pluginId: PluginId, knownPlugins: readonly PluginMeta[]): void {
    const meta = knownPlugins.find((candidate) => candidate.id === pluginId);
    if (!meta) return;

    const snapshot = this.readSnapshot();
    const missing = (meta.dependsOn ?? []).filter((dependencyId) => !snapshot.installed.has(dependencyId));
    const disabled = (meta.dependsOn ?? []).filter((dependencyId) =>
      snapshot.installed.has(dependencyId) && !snapshot.enabled.has(dependencyId)
    );

    if (missing.length > 0 || disabled.length > 0) {
      throw new Error(
        `插件依赖未满足，不能启用/安装 ${pluginId}: missing=[${missing.join(',')}] disabled=[${disabled.join(',')}]`,
      );
    }
  }

  private assertNoEnabledDependents(
    pluginId: PluginId,
    knownPlugins: readonly PluginMeta[],
    action: '禁用' | '卸载',
  ): void {
    if (knownPlugins.length === 0) return;

    const snapshot = this.readSnapshot();
    const dependents = knownPlugins
      .filter((meta) => meta.dependsOn?.includes(pluginId))
      .filter((meta) => snapshot.enabled.has(meta.id))
      .map((meta) => meta.id);

    if (dependents.length > 0) {
      throw new Error(`插件 ${pluginId} 仍被已启用插件依赖，不能${action}: ${dependents.join(', ')}`);
    }
  }
}

function toInstalledPluginRecord(row: InstalledPluginRow): InstalledPluginRecord {
  return {
    pluginId: row.plugin_id,
    version: row.version,
    schemaVersion: row.schema_version,
    compatMin: row.compat_min,
    source: row.source,
    installed: row.installed === 1,
    builtin: row.builtin === 1,
    required: row.required === 1,
    userRemoved: row.user_removed === 1,
  };
}
