import type Database from 'better-sqlite3';

export interface MindMapTsServiceManager {
  getServices(): {
    databaseService: {
      getDb(): Database.Database;
    } | null;
  };
}

function isMindMapTsServiceManager(value: unknown): value is MindMapTsServiceManager {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof Reflect.get(value, 'getServices') === 'function';
}

export function readMindMapTsServiceManager(value: unknown): MindMapTsServiceManager {
  if (!isMindMapTsServiceManager(value)) {
    throw new Error('MindMap IPC registrar requires TSServiceManager-like host object.');
  }

  return value;
}
