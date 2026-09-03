import type Database from 'better-sqlite3';
import {
  SlidesCliError,
  SlidesCliExitCode,
} from '../definitions/slidesCli';

/**
 * CLI 只读数据库入口。这里知道失败发生在数据库启动阶段，因此不能把它伪装成
 * 某一份演示文稿的查询失败，也不能向 stderr 泄漏工作区数据库路径。
 */
export function openSlidesCliDatabase(
  DatabaseConstructor: typeof Database,
  databasePath: string,
): Database.Database {
  try {
    const db = new DatabaseConstructor(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    db.pragma('foreign_keys = ON');
    return db;
  } catch {
    throw new SlidesCliError(
      'slides.cli.database_unavailable',
      SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
      'Workspace database could not be opened for reading',
    );
  }
}
