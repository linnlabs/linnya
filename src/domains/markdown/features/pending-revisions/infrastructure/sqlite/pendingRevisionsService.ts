/**
 * @file pendingRevisionsService.ts
 * @description 块级 AI 修订意图服务 - 处理 Pending Revision 的 CRUD 操作
 *
 * 核心功能：
 * - 写入 / 覆盖某块的 pending revision（同一块只保留一条最新记录）
 * - 查询文档下所有 pending revisions
 * - 清理单个块或整个文档的 pending revisions
 *
 * 设计原则：
 * - 不修改 content_json，仅在 pending_revisions 表中存储 AI 建议
 * - 前端打开文档时读取 pending revisions，通过 Revision pipeline 应用
 * - 用户接受/拒绝修订后，由前端/IPC 调用清理方法
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { MarkdownPendingRevisionReader } from './markdownPendingRevisionReader';
import { createMarkdownReadDatabase } from '../../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import type {
  PendingRevision,
  PendingRevisionMetadata,
  PendingRevisionOperation,
  SetPendingRevisionParams,
} from '../../definitions/pendingRevision';

// ==================== 服务实现 ====================

export class PendingRevisionsService extends MarkdownPendingRevisionReader {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    super(createMarkdownReadDatabase(db));
    this.db = db;
  }

  /**
   * 写入或覆盖某块的 pending revision
   *
   * 若目标 (documentId, blockId) 已存在记录 → 覆盖 new_markdown、meta_json、updated_at
   * 若不存在 → 插入新记录，初始化 created_at
   *
   * @param params 写入参数
   * @returns 写入后的 pending revision 记录
   */
  setPendingRevision(params: SetPendingRevisionParams): PendingRevision {
    const { documentId, blockId, newMarkdown, source = 'ai', meta } = params;
    const now = Date.now();
    const metaJson = meta ? JSON.stringify(meta) : null;

    // 优先使用显式参数，兜底从 meta 解析
    const operation = params.operation ?? this.extractOperationFromMeta(meta) ?? null;

    const existingStmt = this.db.prepare(`
      SELECT id FROM markdown_block_pending_revisions
      WHERE document_node_id = ? AND target_block_id = ?
    `);
    const existing = existingStmt.get(documentId, blockId) as { id: string } | undefined;

    if (existing) {
      const updateStmt = this.db.prepare(`
        UPDATE markdown_block_pending_revisions
        SET new_markdown = ?, source = ?, operation = ?, meta_json = ?, updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(newMarkdown, source, operation, metaJson, now, existing.id);

      const saved = this.getPendingRevisionById(existing.id);
      if (!saved) {
        throw new Error(`Pending revision update was not persisted: ${existing.id}`);
      }
      return saved;
    } else {
      const id = uuidv4();
      const insertStmt = this.db.prepare(`
        INSERT INTO markdown_block_pending_revisions (
          id, document_node_id, target_block_id, new_markdown, source, operation, meta_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(id, documentId, blockId, newMarkdown, source, operation, metaJson, now);

      const saved = this.getPendingRevisionById(id);
      if (!saved) {
        throw new Error(`Pending revision insert was not persisted: ${id}`);
      }
      return saved;
    }
  }

  /** 从 meta 中提取 operation（兼容旧写入路径） */
  private extractOperationFromMeta(meta: PendingRevisionMetadata | undefined): PendingRevisionOperation | undefined {
    if (!meta) return undefined;
    const op = (meta as Record<string, unknown>).operation;
    return op === 'insert' || op === 'update' || op === 'delete' ? op : undefined;
  }

  /**
   * 清理指定块的 pending revision
   *
   * @param documentId 文档节点 ID
   * @param blockId 块 ID
   * @returns 删除的记录数
   */
  clearPendingRevision(documentId: string, blockId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM markdown_block_pending_revisions
      WHERE document_node_id = ? AND target_block_id = ?
    `);
    const result = stmt.run(documentId, blockId);
    return result.changes;
  }

  /**
   * 清理文档下所有 pending revisions
   *
   * @param documentId 文档节点 ID
   * @returns 删除的记录数
   */
  clearAllPendingRevisions(documentId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM markdown_block_pending_revisions
      WHERE document_node_id = ?
    `);
    const result = stmt.run(documentId);
    return result.changes;
  }

}
