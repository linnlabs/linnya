import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  ProjectNotEmptyError,
  ProjectDeleteBlockedError,
} from '../../../definitions/projectErrors';

const ChangeCountSchema = z.number().int().nonnegative();

/** 必须在调用方事务中执行；抛错后整笔事务回滚，不允许提交关联记录的删除或解除绑定。 */
export function deleteEmptyProjectRecord(db: Database.Database, projectId: string): void {
  // DatabaseService 正式连接启用 foreign_keys。total_changes 包含 FK/trigger 的改动，
  // statement.changes 则不包含；否则会把 Conversation SET NULL 误判为仅删除项目一行。
  // 不读取其他 domain 或停用插件的表；归属关系由各 owner 的正式 FK 保持。
  const readChanges = db.prepare('SELECT total_changes()').pluck();
  const before = ChangeCountSchema.parse(readChanges.get());
  try {
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
    ) {
      throw new ProjectNotEmptyError(projectId);
    }
    // SQLite 将 RESTRICT 外键实现为 trigger；同类错误也可能是插件显式禁止删除。
    // 只报告被持久化规则阻止，不解析英文错误消息来猜测是哪种业务内容。
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_TRIGGER') {
      throw new ProjectDeleteBlockedError(projectId);
    }
    throw error;
  }
  if (ChangeCountSchema.parse(readChanges.get()) - before !== 1) {
    throw new ProjectNotEmptyError(projectId);
  }
}
