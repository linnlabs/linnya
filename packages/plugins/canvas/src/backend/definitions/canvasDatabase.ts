import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';

export type CanvasDatabase = PluginSqliteDatabasePort;

export function isCanvasDatabase(value: unknown): value is CanvasDatabase {
  return (
    typeof value === 'object' &&
    value !== null &&
    'prepare' in value &&
    typeof value.prepare === 'function' &&
    'transaction' in value &&
    typeof value.transaction === 'function' &&
    'exec' in value &&
    typeof value.exec === 'function'
  );
}

export function requireCanvasDatabase(value: unknown): CanvasDatabase {
  if (!isCanvasDatabase(value)) throw new Error('Canvas 需要当前 Workspace 的数据库端口');
  return value;
}
