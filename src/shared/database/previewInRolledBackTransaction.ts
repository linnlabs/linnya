import type Database from 'better-sqlite3';

const ROLLBACK = Symbol('preview rollback');

/**
 * 在事务里试做一次，拿到结果后整体回滚。预览和真实写入走同一份校验与写入代码，结果准确且不留痕迹。
 * `run` 自己抛出的错误照常抛给调用方。
 */
export function previewInRolledBackTransaction<T>(db: Database.Database, run: () => T): T {
  const holder: { result?: { readonly value: T } } = {};
  try {
    db.transaction(() => {
      holder.result = { value: run() };
      throw ROLLBACK;
    })();
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  if (!holder.result) throw new Error('Preview transaction finished without a result');
  return holder.result.value;
}
