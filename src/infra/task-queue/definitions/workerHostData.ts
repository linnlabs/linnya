/** 与业务 job 分区，由 Host 覆盖注入；不是可由插件参数选择的数据库地址。 */
export interface WorkerHostData {
  readonly database: {
    readonly path: string;
    readonly schemaVersion: number;
  };
}

export const WORKER_HOST_DATA_KEY = '__linnyaWorkerHost';

export function readWorkerHostData(value: unknown): WorkerHostData {
  if (typeof value !== 'object' || value === null || !(WORKER_HOST_DATA_KEY in value)) {
    throw new Error('Worker 缺少 Host 数据库身份');
  }
  const host: unknown = value[WORKER_HOST_DATA_KEY];
  if (typeof host !== 'object' || host === null || !('database' in host)) {
    throw new Error('Worker Host 数据库身份无效');
  }
  const database = host.database;
  if (
    typeof database !== 'object' ||
    database === null ||
    !('path' in database) ||
    typeof database.path !== 'string' ||
    !database.path ||
    !('schemaVersion' in database) ||
    typeof database.schemaVersion !== 'number' ||
    !Number.isInteger(database.schemaVersion)
  ) {
    throw new Error('Worker Host 数据库身份无效');
  }
  return { database: { path: database.path, schemaVersion: database.schemaVersion } };
}
