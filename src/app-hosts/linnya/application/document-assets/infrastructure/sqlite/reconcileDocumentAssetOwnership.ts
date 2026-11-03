import type Database from 'better-sqlite3';
import { registerDocumentAssetOwnership } from './registerDocumentAssetOwnership';

/** 调用方提交完整可达集合；关系与版本裁剪一起提交，不读取或删除物理字节。 */
export function reconcileDocumentAssetOwnership(input: { readonly database: Database.Database; readonly documentId: string; readonly assetIds: readonly string[]; readonly usageHint: string }): void {
  registerDocumentAssetOwnership(input);
  input.database.prepare('DELETE FROM document_asset_links WHERE document_node_id = ? AND asset_id NOT IN (SELECT value FROM json_each(?))')
    .run(input.documentId, JSON.stringify([...new Set(input.assetIds)]));
}
