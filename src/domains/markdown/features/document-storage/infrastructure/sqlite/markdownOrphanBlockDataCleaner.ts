/**
 * @file markdownOrphanBlockDataCleaner.ts
 * @description 清理 Markdown 文档中“无对应块实体”的幽灵数据（pending / block history）。
 *
 * 设计目标：
 * - 不修改业务流程，将清理逻辑封装为独立服务，方便在维护脚本 / 管理工具中按需调用；
 * - 只依赖 Database 和文档服务（用于获取最新 content_json），不侵入具体工具调用方。
 */

import type Database from 'better-sqlite3';
import { getCurrentRootBlockIdSetFromDoc } from '../../../block-content';
import type { MarkdownDocumentService } from './markdownDocumentService';

export interface OrphanCleanupResult {
  removedPending: number;
  removedBlockVersions: number;
}

/**
 * Markdown 文档幽灵块数据清理服务。
 *
 * 用法示例：
 *
 * ```ts
 * const db = databaseService.getDb();
 * const markdownService = new MarkdownDocumentService(db);
 * const cleaner = new MarkdownOrphanBlockDataCleaner(db, markdownService);
 * cleaner.cleanupDocumentOrphans(documentNodeId);
 * ```
 */
export class MarkdownOrphanBlockDataCleaner {
  constructor(
    private readonly db: Database.Database,
    private readonly markdownService: MarkdownDocumentService
  ) {}

  /**
   * 清理指定文档下所有“无对应块实体”的卫星数据：
   * - pending revisions（markdown_block_pending_revisions）
   * - markdown_block_versions（块级历史版本）
   *
   * 返回每一类被删除的记录数量，便于日志与测试。
   */
  cleanupDocumentOrphans(documentNodeId: string): OrphanCleanupResult {
    const doc = this.markdownService.getDocument(documentNodeId);
    const liveBlockIds = getCurrentRootBlockIdSetFromDoc(doc);

    // 1. 清理 pending revisions：target_block_id 不在当前块集合中的记录
    let removedPending = 0;
    const pendings = this.markdownService.getPendingRevisions(documentNodeId);
    for (const rev of pendings) {
      if (!liveBlockIds.has(rev.target_block_id)) {
        removedPending += this.markdownService.clearPendingRevision(
          documentNodeId,
          rev.target_block_id
        );
      }
    }

    // 2. 清理块历史：markdown_block_versions 中 target_block_id 已不再存在的记录
    let removedBlockVersions = 0;
    const stmtVersions = this.db.prepare<
      unknown[],
      { id: string; target_block_id: string }
    >(`
      SELECT id, target_block_id
      FROM markdown_block_versions
      WHERE document_node_id = ?
    `);
    const versions = stmtVersions.all(documentNodeId);
    const deleteVersionStmt = this.db.prepare(`DELETE FROM markdown_block_versions WHERE id = ?`);
    for (const ver of versions) {
      if (!liveBlockIds.has(ver.target_block_id)) {
        const result = deleteVersionStmt.run(ver.id);
        removedBlockVersions += result.changes ?? 0;
      }
    }

    console.log(
      `[MarkdownOrphanBlockDataCleaner] cleanupDocumentOrphans: documentId=${documentNodeId}, ` +
        `pending=${removedPending}, blockVersions=${removedBlockVersions}`
    );

    return {
      removedPending,
      removedBlockVersions
    };
  }
}
