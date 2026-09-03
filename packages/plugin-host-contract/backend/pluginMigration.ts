/**
 * 插件后端 schema migration 的窄契约。
 *
 * 迁移只暴露 SQLite 所需的最小能力，不暴露 host 的 DatabaseService。
 */
export interface PluginMigrationStatement {
  readonly get?: (...params: unknown[]) => unknown;
  readonly all?: (...params: unknown[]) => unknown[];
  readonly run?: (...params: unknown[]) => unknown;
}

export interface PluginMigrationDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => PluginMigrationStatement;
}

export interface PluginMigrationDefinition {
  readonly version: number;
  readonly description: string;
  readonly up: (db: PluginMigrationDatabase) => void;
}
