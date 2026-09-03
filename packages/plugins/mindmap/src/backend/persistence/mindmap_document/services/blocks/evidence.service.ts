import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { CitationSourceType } from '@app/schemas';
import { isCitationSourceType } from '@app/schemas';
import { Logger } from '@plugin/backend/workspaceRuntime';

const logger = new Logger('MindMapEvidenceService');

export type MindMapEvidenceSourceType = CitationSourceType;

export interface CreateEvidenceParams {
  documentId: string;
  mindmapNodeId: string;
  sourceType: MindMapEvidenceSourceType;
  /**
   * 同源标识（跨来源统一规则）：
   * - knowledge_base: `${docId}#${blockId}`（或纯 docId，当没有 block 语义时）
   * - web: 规范化后的 URL
   * - manual: UUID（手动来源没有稳定外链）
   * - conversation_turn: 对话轮次唯一标识（如 turnId）
   */
  sourceId: string;
  ref?: string;
  title?: string;
  snippet?: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  note?: string;
  orderIndex?: number;
}

export interface UpdateEvidenceParams {
  id: string;
  ref?: string;
  title?: string;
  snippet?: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  note?: string;
  orderIndex?: number;
}

export interface MindMapEvidence {
  id: string;
  documentId: string;
  mindmapNodeId: string;
  sourceType: MindMapEvidenceSourceType;
  sourceId: string;
  ref?: string;
  title?: string;
  snippet?: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  orderIndex: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

type EvidenceRow = {
  id: string;
  document_id: string;
  mindmap_node_id: string;
  source_type: string;
  source_id: string;
  ref: string | null;
  title: string | null;
  snippet: string | null;
  url: string | null;
  authors: string | null; // JSON string
  date: string | null;
  container_title: string | null;
  order_index: number;
  note: string | null;
  deleted_at: number | null; // 软删除时间戳
  created_at: number;
  updated_at: number;
};

type UpdateEvidenceValues = {
  id: string;
  updated_at: number;
  ref?: string | null;
  title?: string | null;
  snippet?: string | null;
  url?: string | null;
  authors?: string | null;
  date?: string | null;
  containerTitle?: string | null;
  note?: string | null;
  orderIndex?: number;
};

export class MindMapEvidenceService {
  constructor(private readonly db: Database.Database) {}

  /**
   * 生成一个“文档内唯一”的短 ref。
   *
   * 语义约束：
   * - ref 用于 AI/导出等场景的短引用（例如 [@ab1234]），只要求在单个 mindmap 文档内唯一；
   * - 手动添加的证据默认 ref = NULL；
   * - 复制（clone）时若源证据有 ref，则为新证据生成新的 ref，避免冲突。
   */
  private generateUniqueRef(documentId: string, maxAttempts = 12): string {
    for (let i = 0; i < maxAttempts; i++) {
      // 8 位短码：4 bytes -> hex（碰撞概率极低，且生成成本小）
      const candidate = randomBytes(4).toString('hex');

      const exists = this.db
        .prepare<[string, string], { one: number }>(
          `
          SELECT 1 as one
          FROM mindmap_evidence
          WHERE document_id = ? AND ref = ?
          LIMIT 1
        `
        )
        .get(documentId, candidate);

      if (!exists) return candidate;
    }

    throw new Error('无法生成唯一 ref（重试次数耗尽）');
  }

  /**
   * 添加证据
   */
  addEvidence(params: CreateEvidenceParams): MindMapEvidence {
    const id = uuidv4();
    const now = Date.now();
    
    // 如果没有指定 orderIndex，则放在最后
    let orderIndex = params.orderIndex;
    if (orderIndex === undefined) {
      const maxOrder = this.db.prepare<[string, string], { max_order: number }>(`
        SELECT MAX(order_index) as max_order FROM mindmap_evidence 
        WHERE document_id = ? AND mindmap_node_id = ?
      `).get(params.documentId, params.mindmapNodeId);
      orderIndex = (maxOrder?.max_order ?? -1) + 1;
    }

    const ref = params.ref ?? null;
    if (ref) {
      const exists = this.db
        .prepare<[string, string], { one: number }>(
          `
          SELECT 1 as one
          FROM mindmap_evidence
          WHERE document_id = ? AND ref = ?
          LIMIT 1
        `
        )
        .get(params.documentId, ref);
      if (exists) {
        throw new Error(`ref 已存在（documentId=${params.documentId}, ref=${ref}）`);
      }
    }

    const row: EvidenceRow = {
      id,
      document_id: params.documentId,
      mindmap_node_id: params.mindmapNodeId,
      source_type: params.sourceType,
      source_id: params.sourceId,
      ref,
      title: params.title ?? null,
      snippet: params.snippet ?? null,
      url: params.url ?? null,
      authors: params.authors ? JSON.stringify(params.authors) : null,
      date: params.date ?? null,
      container_title: params.containerTitle ?? null,
      order_index: orderIndex,
      note: params.note ?? null,
      deleted_at: null, // 新增证据默认活跃
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO mindmap_evidence (
        id, document_id, mindmap_node_id, source_type, source_id, ref,
        title, snippet, url, authors, date, container_title, order_index, note, deleted_at,
        created_at, updated_at
      ) VALUES (
        @id, @document_id, @mindmap_node_id, @source_type, @source_id, @ref,
        @title, @snippet, @url, @authors, @date, @container_title, @order_index, @note, @deleted_at,
        @created_at, @updated_at
      )
    `).run(row);

    return this.mapRowToEntity(row);
  }

  /**
   * 更新证据
   */
  updateEvidence(params: UpdateEvidenceParams): void {
    const updates: string[] = [];
    const values: UpdateEvidenceValues = { id: params.id, updated_at: Date.now() };

    if (params.ref !== undefined) {
      const nextRef = params.ref ?? null;
      if (nextRef) {
        const docRow = this.db
          .prepare<[string], { document_id: string }>('SELECT document_id FROM mindmap_evidence WHERE id = ?')
          .get(params.id);
        if (!docRow) {
          throw new Error(`evidence 不存在（id=${params.id}）`);
        }

        const exists = this.db
          .prepare<[string, string, string], { one: number }>(
            `
            SELECT 1 as one
            FROM mindmap_evidence
            WHERE document_id = ? AND ref = ? AND id <> ?
            LIMIT 1
          `
          )
          .get(docRow.document_id, nextRef, params.id);
        if (exists) {
          throw new Error(`ref 已存在（documentId=${docRow.document_id}, ref=${nextRef}）`);
        }
      }

      updates.push('ref = @ref');
      values.ref = nextRef;
    }
    if (params.title !== undefined) {
      updates.push('title = @title');
      values.title = params.title ?? null;
    }
    if (params.snippet !== undefined) {
      updates.push('snippet = @snippet');
      values.snippet = params.snippet ?? null;
    }
    if (params.url !== undefined) {
      updates.push('url = @url');
      values.url = params.url ?? null;
    }
    if (params.authors !== undefined) {
      updates.push('authors = @authors');
      values.authors = JSON.stringify(params.authors);
    }
    if (params.date !== undefined) {
      updates.push('date = @date');
      values.date = params.date ?? null;
    }
    if (params.containerTitle !== undefined) {
      updates.push('container_title = @containerTitle');
      values.containerTitle = params.containerTitle ?? null;
    }
    if (params.note !== undefined) {
      updates.push('note = @note');
      values.note = params.note ?? null;
    }
    if (params.orderIndex !== undefined) {
      updates.push('order_index = @orderIndex');
      values.orderIndex = params.orderIndex;
    }

    updates.push('updated_at = @updated_at');

    if (updates.length === 1) return; // 只有 updated_at，没必要更

    this.db.prepare(`
      UPDATE mindmap_evidence 
      SET ${updates.join(', ')}
      WHERE id = @id
    `).run(values);
  }

  /**
   * 删除证据
   */
  removeEvidence(id: string): void {
    this.db.prepare('DELETE FROM mindmap_evidence WHERE id = ?').run(id);
  }

  /**
   * 获取节点的所有证据列表（默认只返回活跃证据，不含软删除）
   */
  listEvidences(documentId: string, nodeId: string, includeDeleted = false): MindMapEvidence[] {
    const whereClause = includeDeleted 
      ? 'WHERE document_id = ? AND mindmap_node_id = ?'
      : 'WHERE document_id = ? AND mindmap_node_id = ? AND deleted_at IS NULL';
    
    const rows = this.db.prepare<[string, string], EvidenceRow>(`
      SELECT * FROM mindmap_evidence 
      ${whereClause}
      ORDER BY order_index ASC, created_at ASC
    `).all(documentId, nodeId);

    return rows.map(this.mapRowToEntity);
  }

  /**
   * 批量获取证据数量 (用于节点 Badge，只统计活跃证据)
   */
  countEvidences(documentId: string, nodeIds: string[]): Record<string, number> {
    if (nodeIds.length === 0) return {};
    
    const placeholders = nodeIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT mindmap_node_id, COUNT(*) as count 
      FROM mindmap_evidence 
      WHERE document_id = ? AND mindmap_node_id IN (${placeholders}) AND deleted_at IS NULL
      GROUP BY mindmap_node_id
    `).all(documentId, ...nodeIds) as { mindmap_node_id: string; count: number }[];

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.mindmap_node_id] = row.count;
    }
    return result;
  }

  /**
   * 批量删除 (用于节点删除时清理)
   */
  batchRemoveByNodeIds(documentId: string, nodeIds: string[]): void {
    if (nodeIds.length === 0) return;

    // 分批处理，防止 SQL 语句过长 (SQLite limit 999 vars)
    const BATCH_SIZE = 500;
    const deleteStmt = this.db.prepare(`
      DELETE FROM mindmap_evidence 
      WHERE document_id = ? AND mindmap_node_id = ?
    `);

    // 优化：使用 transaction 
    const deleteMany = this.db.transaction((ids: string[]) => {
      for (const nodeId of ids) {
        deleteStmt.run(documentId, nodeId);
      }
    });

    deleteMany(nodeIds);
    logger.info(`Batch removed evidences for ${nodeIds.length} nodes in doc ${documentId}`);
  }

  /**
   * 克隆证据 (用于节点复制时迁移)
   * 将 sourceNodeId 的证据复制一份给 targetNodeId
   */
  cloneEvidence(documentId: string, sourceNodeId: string, targetNodeId: string): void {
    const sources = this.listEvidences(documentId, sourceNodeId);
    if (sources.length === 0) return;

    const now = Date.now();
    const insertStmt = this.db.prepare(`
      INSERT INTO mindmap_evidence (
        id, document_id, mindmap_node_id, source_type, source_id, ref,
        title, snippet, url, authors, date, container_title, order_index, note, deleted_at,
        created_at, updated_at
      ) VALUES (
        @id, @document_id, @mindmap_node_id, @source_type, @source_id, @ref,
        @title, @snippet, @url, @authors, @date, @container_title, @order_index, @note, @deleted_at,
        @created_at, @updated_at
      )
    `);

    const cloneMany = this.db.transaction((items: MindMapEvidence[]) => {
      for (const item of items) {
        const newRow: EvidenceRow = {
          id: uuidv4(),
          document_id: documentId,
          mindmap_node_id: targetNodeId,
          source_type: item.sourceType,
          source_id: item.sourceId,
          // ref 语义：文档内唯一短引用。复制时生成新 ref，避免唯一约束冲突。
          ref: item.ref ? this.generateUniqueRef(documentId) : null,
          title: item.title ?? null,
          snippet: item.snippet ?? null,
          url: item.url ?? null,
          authors: item.authors ? JSON.stringify(item.authors) : null,
          date: item.date ?? null,
          container_title: item.containerTitle ?? null,
          order_index: item.orderIndex,
          note: item.note ?? null, // 备注也复制
          deleted_at: null, // 克隆的证据默认活跃
          created_at: now,
          updated_at: now,
        };
        insertStmt.run(newRow);
      }
    });

    cloneMany(sources);
  }

  /**
   * 软删除（用于支持撤销/重做一致性）
   */
  softDeleteByNodeIds(documentId: string, nodeIds: string[]): void {
    if (nodeIds.length === 0) return;

    const now = Date.now();
    const softDeleteStmt = this.db.prepare(`
      UPDATE mindmap_evidence 
      SET deleted_at = ?, updated_at = ?
      WHERE document_id = ? AND mindmap_node_id = ? AND deleted_at IS NULL
    `);

    const softDeleteMany = this.db.transaction((ids: string[]) => {
      for (const nodeId of ids) {
        softDeleteStmt.run(now, now, documentId, nodeId);
      }
    });

    softDeleteMany(nodeIds);
    logger.info(`Soft deleted evidences for ${nodeIds.length} nodes in doc ${documentId}`);
  }

  /**
   * 恢复软删除（用于 undo 操作）
   */
  restoreSoftDeleted(documentId: string, nodeIds: string[]): void {
    if (nodeIds.length === 0) return;

    const now = Date.now();
    const restoreStmt = this.db.prepare(`
      UPDATE mindmap_evidence 
      SET deleted_at = NULL, updated_at = ?
      WHERE document_id = ? AND mindmap_node_id = ? AND deleted_at IS NOT NULL
    `);

    const restoreMany = this.db.transaction((ids: string[]) => {
      for (const nodeId of ids) {
        restoreStmt.run(now, documentId, nodeId);
      }
    });

    restoreMany(nodeIds);
    logger.info(`Restored soft deleted evidences for ${nodeIds.length} nodes in doc ${documentId}`);
  }

  /**
   * 移动证据（用于剪切粘贴）
   * 将 sourceNodeId 的所有证据迁移到 targetNodeId
   */
  moveEvidences(documentId: string, sourceNodeId: string, targetNodeId: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE mindmap_evidence 
      SET mindmap_node_id = ?, updated_at = ?
      WHERE document_id = ? AND mindmap_node_id = ? AND deleted_at IS NULL
    `).run(targetNodeId, now, documentId, sourceNodeId);
    
    logger.info(`Moved evidences from node ${sourceNodeId} to ${targetNodeId} in doc ${documentId}`);
  }

  /**
   * 清理过期软删除（定期任务用）
   * 删除超过指定时间（默认 24h）的软删除记录
   */
  cleanupSoftDeleted(olderThanMs = 24 * 60 * 60 * 1000): number {
    const threshold = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      DELETE FROM mindmap_evidence 
      WHERE deleted_at IS NOT NULL AND deleted_at < ?
    `).run(threshold);
    
    const deletedCount = result.changes;
    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} soft deleted evidences`);
    }
    return deletedCount;
  }

  private mapRowToEntity(row: EvidenceRow): MindMapEvidence {
    return {
      id: row.id,
      documentId: row.document_id,
      mindmapNodeId: row.mindmap_node_id,
      sourceType: parseMindMapEvidenceSourceType(row.source_type),
      sourceId: row.source_id,
      ref: row.ref ?? undefined,
      title: row.title ?? undefined,
      snippet: row.snippet ?? undefined,
      url: row.url ?? undefined,
      authors: row.authors ? JSON.parse(row.authors) : undefined,
      date: row.date ?? undefined,
      containerTitle: row.container_title ?? undefined,
      orderIndex: row.order_index,
      note: row.note ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function parseMindMapEvidenceSourceType(sourceType: string): MindMapEvidenceSourceType {
  if (isCitationSourceType(sourceType)) {
    return sourceType;
  }
  throw new Error(`[MindMapEvidenceService] 非法 sourceType: ${sourceType}`);
}
