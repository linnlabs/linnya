import type Database from 'better-sqlite3';
import type { DocumentAssetOwnershipPort } from '../../definitions/documentAssetOwnership';

export function createSqliteDocumentAssetOwnership(
  db: Database.Database
): DocumentAssetOwnershipPort {
  const insertOwnership = db.prepare(`
    INSERT OR IGNORE INTO document_asset_links (
      document_node_id, asset_id, usage_hint
    ) VALUES (?, ?, ?)
  `);
  const findOwnership = db.prepare<[string, string], { readonly found: 1 }>(`
    SELECT 1 AS found
    FROM document_asset_links
    WHERE document_node_id = ? AND asset_id = ?
  `);

  return {
    ensureOwnership(input): void {
      insertOwnership.run(input.documentId, input.assetId, input.usageHint);
    },
    hasOwnership(input): boolean {
      return findOwnership.get(input.documentId, input.assetId)?.found === 1;
    },
  };
}
