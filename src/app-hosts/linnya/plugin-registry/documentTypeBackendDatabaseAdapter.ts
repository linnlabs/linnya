import type Database from 'better-sqlite3';
import type { DocumentTypeBackendDatabase } from '@plugin/backend/documentTypeBackendHook';

/**
 * 把主应用 SQLite 能力收窄到文档类型 hook 可见的稳定数据库合同。
 * 插件不能借结构类型偶然获得 better-sqlite3 的完整实例能力。
 */
export function adaptDocumentTypeBackendDatabase(
  db: Database.Database,
): DocumentTypeBackendDatabase {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get(...params) {
          return statement.get(...params);
        },
        all(...params) {
          return statement.all(...params);
        },
        run(...params) {
          return statement.run(...params);
        },
      };
    },
    transaction(fn) {
      const transaction = db.transaction(fn);
      return {
        immediate() {
          transaction.immediate();
        },
      };
    },
  };
}
