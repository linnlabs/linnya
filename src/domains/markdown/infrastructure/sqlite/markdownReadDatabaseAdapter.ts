import type {
  MarkdownReadDatabase,
  MarkdownSqliteReadSource,
} from '../../definitions/markdownReadDatabase';

interface SqliteReadStatement {
  readonly get: (...params: readonly unknown[]) => unknown;
  readonly all: (...params: readonly unknown[]) => unknown[];
}

function isSqliteReadStatement(value: unknown): value is SqliteReadStatement {
  if (!value || typeof value !== 'object') return false;
  return 'get' in value
    && 'all' in value
    && typeof value.get === 'function'
    && typeof value.all === 'function';
}

function prepareReadStatement(source: MarkdownSqliteReadSource, sql: string): SqliteReadStatement {
  const statement = source.prepare(sql);
  if (!isSqliteReadStatement(statement)) {
    throw new Error('Markdown read database returned an invalid SQLite statement');
  }
  return statement;
}

/** 把宿主 SQLite statement API 收窄为 Markdown 只读 port。 */
export function createMarkdownReadDatabase(
  source: MarkdownSqliteReadSource,
): MarkdownReadDatabase {
  return {
    get: (sql, params) => prepareReadStatement(source, sql).get(...params),
    all: (sql, params) => prepareReadStatement(source, sql).all(...params),
  };
}
