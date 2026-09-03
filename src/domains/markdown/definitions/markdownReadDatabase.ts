/** Markdown 只读 provider 依赖的最小数据库端口。 */
export interface MarkdownReadDatabase {
  readonly get: (sql: string, params: readonly unknown[]) => unknown;
  readonly all: (sql: string, params: readonly unknown[]) => unknown[];
}

/** better-sqlite3 与测试数据库都可提供的最小 statement source。 */
export interface MarkdownSqliteReadSource {
  readonly prepare: (sql: string) => unknown;
}
