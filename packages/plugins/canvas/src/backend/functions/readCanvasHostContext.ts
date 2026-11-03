import { requireCanvasDatabase, type CanvasDatabase } from '../definitions/canvasDatabase';

function readDatabaseService(value: unknown): { getDb(): unknown } {
  if (typeof value !== 'object' || value === null || !('getDb' in value) || typeof value.getDb !== 'function') {
    throw new Error('Canvas 需要 Host 提供数据库服务');
  }
  const getDb = value.getDb;
  return { getDb: () => getDb.call(value) };
}

export function readCanvasHostDatabase(context: unknown): CanvasDatabase {
  if (typeof context !== 'object' || context === null || !('databaseService' in context)) throw new Error('Canvas 需要当前项目的 Host 上下文');
  return requireCanvasDatabase(readDatabaseService(context.databaseService).getDb());
}

export function readCanvasServiceManagerDatabase(value: unknown): CanvasDatabase {
  if (typeof value !== 'object' || value === null || !('getServices' in value) || typeof value.getServices !== 'function') {
    throw new Error('Canvas 需要 Host 服务入口');
  }
  const services: unknown = value.getServices();
  return readCanvasHostDatabase(services);
}
