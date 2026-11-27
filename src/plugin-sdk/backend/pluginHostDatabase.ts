import type Database from 'better-sqlite3';

/**
 * 插件交给 Host 门面的数据库连接，合同里只写成窄形状（PluginSqliteDatabaseLike）。
 * 需要在同一连接上建预编译语句和事务的 Host 能力（文档资产、配色最近用过）在这里收窄成 better-sqlite3 连接；
 * 不是时直接报错，不退回别的连接。
 */
function isPluginHostDatabase(value: unknown): value is Database.Database {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'prepare') === 'function' &&
    typeof Reflect.get(value, 'transaction') === 'function'
  );
}

export function requirePluginHostDatabase(value: unknown, capability: string): Database.Database {
  if (!isPluginHostDatabase(value)) {
    throw new Error(`${capability} requires a SQLite database.`);
  }
  return value;
}
