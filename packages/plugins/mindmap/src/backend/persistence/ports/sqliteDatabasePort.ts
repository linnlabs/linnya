import type Database from 'better-sqlite3';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isMindMapSqliteDatabase(value: unknown): value is Database.Database {
  if (!isRecord(value)) return false;
  return typeof value.prepare === 'function' &&
    typeof value.exec === 'function' &&
    typeof value.transaction === 'function' &&
    typeof value.pragma === 'function';
}

export function readMindMapSqliteDatabase(value: unknown): Database.Database | null {
  return isMindMapSqliteDatabase(value) ? value : null;
}

export function requireMindMapSqliteDatabase(value: unknown, usage: string): Database.Database {
  const db = readMindMapSqliteDatabase(value);
  if (!db) {
    throw new Error(`MindMap ${usage} requires a SQLite database.`);
  }
  return db;
}
