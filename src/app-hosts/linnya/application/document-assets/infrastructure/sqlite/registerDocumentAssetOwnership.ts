import type Database from 'better-sqlite3';
import { createSqliteDocumentAssetOwnership } from './createSqliteDocumentAssetOwnership';

export function registerDocumentAssetOwnership(input: {
  readonly database: Database.Database; readonly documentId: string;
  readonly assetIds: readonly string[]; readonly usageHint: string;
}): void {
  if (!input.database.inTransaction) throw new Error('Document asset ownership must join the content transaction');
  const ownership = createSqliteDocumentAssetOwnership(input.database);
  for (const assetId of new Set(input.assetIds)) {
    ownership.ensureOwnership({ documentId: input.documentId, assetId, usageHint: input.usageHint });
  }
}
