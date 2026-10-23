import type Database from 'better-sqlite3';
import { bindMarkdownImageOwnership, MarkdownDocumentService } from 'src/domains/markdown';
import {
  createSqliteDocumentAssetOwnership,
  releaseDocumentAssetOwnership,
} from '../document-assets';

/** 所有持久化入口共享数据库作用域的窄归属 port，包括工具、Editor 和历史恢复。 */
export function bindMarkdownDocumentImageOwnership(db: Database.Database): void {
  const ownership = createSqliteDocumentAssetOwnership(db);
  bindMarkdownImageOwnership(db, {
    hasManagedImages(documentId) {
      return Boolean(
        db
          .prepare<
            [string],
            { found: number }
          >("SELECT 1 AS found FROM document_asset_links WHERE document_node_id = ? AND usage_hint = 'markdown-image' LIMIT 1")
          .get(documentId)
      );
    },
    reconcile(documentId, retainedAssetIds) {
      const retained = new Set(retainedAssetIds);
      for (const assetId of retained)
        ownership.ensureOwnership({ documentId, assetId, usageHint: 'markdown-image' });
      const links = db
        .prepare<
          [string],
          { asset_id: string }
        >("SELECT asset_id FROM document_asset_links WHERE document_node_id = ? AND usage_hint = 'markdown-image'")
        .all(documentId);
      // 只释放当前入口创建的归属；实际字节回收仍由 Asset GC 统一负责。
      releaseDocumentAssetOwnership(
        db,
        documentId,
        links.filter(link => !retained.has(link.asset_id)).map(link => link.asset_id)
      );
    },
  });
}

export function createMarkdownDocumentStore(db: Database.Database): MarkdownDocumentService {
  bindMarkdownDocumentImageOwnership(db);
  return new MarkdownDocumentService(db);
}
