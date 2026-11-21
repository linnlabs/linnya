import type Database from 'better-sqlite3';

type RunActivityListener = (conversationId: string) => void;

const listenersByDatabase = new WeakMap<Database.Database, Set<RunActivityListener>>();

/**
 * runs 表的写入者在同一数据库连接上报告“这个对话的运行事实可能变了”。
 *
 * 只是失效通知：不带状态内容，读取方收到后重读 conversation activity。调用点可能仍在
 * SQLite 事务内，监听者不能同步读写数据库；事务回滚时也可能已经通知，多读一次无害。
 * 写入者固定在 run-registry、event-store 与 history-mutation 三处，由
 * `__tests__/runWriteOwnership.test.ts` 约束新的 runs 写入必须同时发出通知。
 */
export function notifyRunActivityChanged(db: Database.Database, conversationId: string): void {
  const listeners = listenersByDatabase.get(db);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(conversationId);
    } catch {
      // 展示侧观察者故障不能回滚或打断运行事实写入，其他观察者照常收到。
      continue;
    }
  }
}

export function subscribeRunActivity(db: Database.Database, listener: RunActivityListener): () => void {
  let listeners = listenersByDatabase.get(db);
  if (!listeners) {
    listeners = new Set();
    listenersByDatabase.set(db, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
