/**
 * @file migrations/types.ts
 * @description Host Schema 增量迁移契约。
 */

import type Database from 'better-sqlite3';

export type MigrationFunction = (db: Database.Database) => void;

export interface HostSchemaMigration {
  readonly fromVersion: number;
  readonly migrate: MigrationFunction;
}
