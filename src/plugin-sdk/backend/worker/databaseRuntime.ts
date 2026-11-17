import { workerData } from 'node:worker_threads';
import type { PluginWorkerDatabase } from '@linnya/plugin-host-contract/backend/worker/databaseRuntime';
import { readWorkerHostData } from 'src/infra/task-queue/definitions/workerHostData';
import { openInitializedSqliteConnection } from 'src/infra/sqlite/connectionOnly';

export type { PluginWorkerDatabase } from '@linnya/plugin-host-contract/backend/worker/databaseRuntime';

/** 必须内联进 Worker artifact；不能依赖 Backend 主线程的临时 require hook。 */
export function openPluginWorkerDatabase(): PluginWorkerDatabase {
  const { database } = readWorkerHostData(workerData);
  const connection = openInitializedSqliteConnection({
    databasePath: database.path,
    schemaVersion: database.schemaVersion,
  });
  // 绑定方法但不交出整个 Database 对象；只关闭本 Worker 自己的连接。
  return Object.freeze({
    prepare: connection.prepare.bind(connection),
    transaction: connection.transaction.bind(connection),
    close: connection.close.bind(connection),
  });
}
