import type Database from 'better-sqlite3';
import type { PluginId } from '@app/schemas';
import { PLUGIN_ACTIVE_VERSION_SCHEMA } from './plugin-state.schema';

export type PluginActiveVersionStatus = 'activating' | 'active' | 'failed';

interface PluginActiveVersionRow {
  readonly plugin_id: string;
  readonly active_version: string;
  readonly previous_version: string | null;
  readonly status: PluginActiveVersionStatus;
  readonly error: string | null;
  readonly updated_at: number;
}

export interface PluginActiveVersionRecord {
  readonly pluginId: PluginId;
  readonly activeVersion: string;
  readonly previousVersion: string | null;
  readonly status: PluginActiveVersionStatus;
  readonly error: string | null;
  readonly updatedAt: number;
}

export function ensurePluginActiveVersionTable(db: Database.Database): void {
  db.exec(PLUGIN_ACTIVE_VERSION_SCHEMA);
}

export class PluginActiveVersionService {
  constructor(private readonly db: Database.Database) {
    ensurePluginActiveVersionTable(db);
  }

  getRecord(pluginId: PluginId): PluginActiveVersionRecord | null {
    const row = this.db
      .prepare(`
        SELECT plugin_id, active_version, previous_version, status, error, updated_at
        FROM plugin_active_versions
        WHERE plugin_id = ?
      `)
      .get(pluginId) as PluginActiveVersionRow | undefined;
    return row ? toRecord(row) : null;
  }

  listRecords(): PluginActiveVersionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT plugin_id, active_version, previous_version, status, error, updated_at
        FROM plugin_active_versions
        ORDER BY plugin_id
      `)
      .all() as PluginActiveVersionRow[];
    return rows.map(toRecord);
  }

  markActivating(params: {
    readonly pluginId: PluginId;
    readonly activeVersion: string;
    readonly previousVersion: string | null;
  }): void {
    this.upsert({
      pluginId: params.pluginId,
      activeVersion: params.activeVersion,
      previousVersion: params.previousVersion,
      status: 'activating',
      error: null,
    });
  }

  markActive(params: {
    readonly pluginId: PluginId;
    readonly activeVersion: string;
    readonly previousVersion: string | null;
  }): void {
    this.upsert({
      pluginId: params.pluginId,
      activeVersion: params.activeVersion,
      previousVersion: params.previousVersion,
      status: 'active',
      error: null,
    });
  }

  markFailed(params: {
    readonly pluginId: PluginId;
    readonly activeVersion: string;
    readonly previousVersion: string | null;
    readonly error: string;
  }): void {
    this.upsert({
      pluginId: params.pluginId,
      activeVersion: params.activeVersion,
      previousVersion: params.previousVersion,
      status: 'failed',
      error: params.error,
    });
  }

  private upsert(params: {
    readonly pluginId: PluginId;
    readonly activeVersion: string;
    readonly previousVersion: string | null;
    readonly status: PluginActiveVersionStatus;
    readonly error: string | null;
  }): void {
    this.db
      .prepare(`
        INSERT INTO plugin_active_versions
          (plugin_id, active_version, previous_version, status, error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(plugin_id) DO UPDATE SET
          active_version = excluded.active_version,
          previous_version = excluded.previous_version,
          status = excluded.status,
          error = excluded.error,
          updated_at = excluded.updated_at
      `)
      .run(
        params.pluginId,
        params.activeVersion,
        params.previousVersion,
        params.status,
        params.error,
        Date.now(),
      );
  }
}

function toRecord(row: PluginActiveVersionRow): PluginActiveVersionRecord {
  return {
    pluginId: row.plugin_id,
    activeVersion: row.active_version,
    previousVersion: row.previous_version,
    status: row.status,
    error: row.error,
    updatedAt: row.updated_at,
  };
}
