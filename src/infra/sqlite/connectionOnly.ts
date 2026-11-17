import Database from 'better-sqlite3';

export const DATABASE_BUSY_TIMEOUT_MS = 5000;

/** 主连接与 Worker 使用同一 pragma；必须在 schema 版本准入之后调用。 */
export function configureSqliteConnection(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
  db.pragma('journal_mode = WAL');
}

/** 不建表、不迁移、不运行插件 lifecycle，只接纳 Host 已初始化的数据库。 */
export function openInitializedSqliteConnection(input: {
  readonly databasePath: string;
  readonly schemaVersion: number;
}): Database.Database {
  const db = new Database(input.databasePath);
  try {
    const version: unknown = db.pragma('user_version', { simple: true });
    if (version !== input.schemaVersion) {
      throw new Error(
        `initializeConnectionOnly() 要求主进程先完成 initialize()：db user_version=${String(version)}，` +
          `app SCHEMA_VERSION=${input.schemaVersion}。worker 连接不得自行 bootstrap schema 或插件 lifecycle。`
      );
    }
    configureSqliteConnection(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
