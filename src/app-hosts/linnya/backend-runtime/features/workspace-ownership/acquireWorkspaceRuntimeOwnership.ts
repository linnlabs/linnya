import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

class WorkspaceRuntimeOwnershipError extends Error {
  constructor(readonly cause: unknown) {
    super('Workspace 已有运行中的 Backend，不能启动第二个执行 owner');
    this.name = 'WorkspaceRuntimeOwnershipError';
  }
}

/**
 * 复用 SQLite 的跨进程 OS 文件锁，不保存业务数据、不以 PID/时间超时抢占活 owner。
 * 锁文件必须保留：unlink 会让两个进程锁住不同 inode，破坏互斥。
 */
export function acquireWorkspaceRuntimeOwnership(workspaceRoot: string): { release(): void } {
  mkdirSync(workspaceRoot, { recursive: true });
  const connection = new Database(join(workspaceRoot, '.runtime-owner.lock'), { timeout: 0 });
  try {
    connection.exec('BEGIN EXCLUSIVE');
  } catch (cause) {
    connection.close();
    throw new WorkspaceRuntimeOwnershipError(cause);
  }
  return {
    release() {
      if (connection.open) connection.close();
    },
  };
}
