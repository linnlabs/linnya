import type Database from 'better-sqlite3';

function isDocumentAssetDatabase(value: unknown): value is Database.Database {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'prepare') === 'function' &&
    typeof Reflect.get(value, 'transaction') === 'function'
  );
}

export function requireDocumentAssetDatabase(value: unknown): Database.Database {
  if (!isDocumentAssetDatabase(value)) {
    throw new Error('Document asset runtime requires a SQLite database.');
  }
  return value;
}
