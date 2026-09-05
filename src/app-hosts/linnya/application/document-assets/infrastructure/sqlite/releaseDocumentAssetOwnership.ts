import type Database from 'better-sqlite3';

export function releaseDocumentAssetOwnership(db: Database.Database, documentId: string, assetIds: readonly string[]): void {
  const remove = db.prepare('DELETE FROM document_asset_links WHERE document_node_id = ? AND asset_id = ?');
  db.transaction(() => {
    for (const assetId of assetIds) remove.run(documentId, assetId);
  })();
}
