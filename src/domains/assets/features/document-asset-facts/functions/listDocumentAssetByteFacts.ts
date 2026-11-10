import type Database from 'better-sqlite3';
import { DocumentAssetByteFactsSchema, type DocumentAssetByteFact } from '@app/schemas';

/** 读取当前连接的归属和真实登记值；缺失事实不能被当成零字节放过保留预算。 */
export function listDocumentAssetByteFacts(db: Database.Database, documentId: string, assetIds: readonly string[]): readonly DocumentAssetByteFact[] {
  const requested = [...new Set(assetIds)]; if (!requested.length) return [];
  const rows: unknown = db.prepare(`SELECT assets.id AS assetId, assets.size_bytes AS byteLength FROM assets JOIN document_asset_links ownership ON ownership.asset_id = assets.id WHERE ownership.document_node_id = ? AND assets.id IN (SELECT value FROM json_each(?))`).all(documentId, JSON.stringify(requested));
  const facts = DocumentAssetByteFactsSchema.parse(rows);
  if (facts.length !== requested.length) throw new Error('Document asset byte facts are missing or are not owned by this document.');
  return facts;
}
