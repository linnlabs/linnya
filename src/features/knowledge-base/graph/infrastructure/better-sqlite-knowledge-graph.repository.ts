/**
 * @file better-sqlite-knowledge-graph.repository.ts
 *
 * @description
 * 软知识图谱仓储 - better-sqlite3 实现（workspace.sqlite）
 *
 * 关键设计：
 * - 不持有独立 DB 连接，通过 DatabaseService 获取统一实例（与 KB 元数据仓储对齐）；
 * - 幂等写入使用 ON CONFLICT(kb_id, id) DO UPDATE；
 * - 所有查询必须携带 kbId（跨 KB 隔离）。
 */

import type Database from 'better-sqlite3';
import { DatabaseService } from '../../../../electron-main/services/database';
import type {
  KnowledgeGraphDocStatusUpsertInput,
  KnowledgeGraphDocStatusRecord,
  KnowledgeGraphDocStatusValue,
  KnowledgeGraphEdgeDirection,
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphEdgeUpsertInput,
  KnowledgeGraphKbProgress,
  KnowledgeGraphNodeRecord,
  KnowledgeGraphNodeUpsertInput,
  KnowledgeGraphRepository,
  KnowledgeGraphVectorDocStatusRecord,
  KnowledgeGraphVectorDocStatusUpsertInput,
  KnowledgeGraphVectorDocStatusValue,
} from './knowledgeGraphRepository';

/**
 * better-sqlite3 版本的图谱仓储实现
 */
export class BetterSqliteKnowledgeGraphRepository implements KnowledgeGraphRepository {
  private readonly databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
    console.log('[BetterSqliteKnowledgeGraphRepository] 初始化完成');
  }

  private getDb(): Database.Database {
    return this.databaseService.getDb();
  }

  async upsertNodes(nodes: KnowledgeGraphNodeUpsertInput[]): Promise<void> {
    if (!Array.isArray(nodes) || nodes.length === 0) return;

    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;

    const stmt = db.prepare(`
      INSERT INTO knowledge_graph_nodes (
        kb_id,
        id,
        name,
        canonical_name,
        type,
        description,
        source_doc_id,
        source_block_id,
        created_at,
        updated_at
      ) VALUES (
        @kbId,
        @id,
        @name,
        @canonicalName,
        @type,
        @description,
        @sourceDocId,
        @sourceBlockId,
        @createdAtSeconds,
        @updatedAtSeconds
      )
      ON CONFLICT(kb_id, id) DO UPDATE SET
        name = excluded.name,
        canonical_name = excluded.canonical_name,
        type = excluded.type,
        description = excluded.description,
        source_doc_id = excluded.source_doc_id,
        source_block_id = excluded.source_block_id,
        updated_at = excluded.updated_at
    `);

    const transaction = db.transaction((rows: KnowledgeGraphNodeUpsertInput[]) => {
      for (const row of rows) {
        stmt.run({
          kbId: row.kbId,
          id: row.id,
          name: row.name,
          canonicalName: row.canonicalName,
          type: row.type ?? null,
          description: row.description ?? null,
          sourceDocId: row.sourceDocId ?? null,
          sourceBlockId: row.sourceBlockId ?? null,
          createdAtSeconds: nowSeconds,
          updatedAtSeconds: nowSeconds,
        });
      }
    });

    transaction(nodes);
  }

  async upsertEdges(edges: KnowledgeGraphEdgeUpsertInput[]): Promise<void> {
    if (!Array.isArray(edges) || edges.length === 0) return;

    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;

    const stmt = db.prepare(`
      INSERT INTO knowledge_graph_edges (
        kb_id,
        id,
        source_entity_id,
        target_entity_id,
        relation_type,
        statement,
        confidence,
        sentiment,
        time,
        evidence_doc_id,
        evidence_block_id,
        created_at,
        updated_at
      ) VALUES (
        @kbId,
        @id,
        @sourceEntityId,
        @targetEntityId,
        @relationType,
        @statement,
        @confidence,
        @sentiment,
        @time,
        @evidenceDocId,
        @evidenceBlockId,
        @createdAtSeconds,
        @updatedAtSeconds
      )
      ON CONFLICT(kb_id, id) DO UPDATE SET
        source_entity_id = excluded.source_entity_id,
        target_entity_id = excluded.target_entity_id,
        relation_type = excluded.relation_type,
        statement = excluded.statement,
        confidence = excluded.confidence,
        sentiment = excluded.sentiment,
        time = excluded.time,
        evidence_doc_id = excluded.evidence_doc_id,
        evidence_block_id = excluded.evidence_block_id,
        updated_at = excluded.updated_at
    `);

    const transaction = db.transaction((rows: KnowledgeGraphEdgeUpsertInput[]) => {
      for (const row of rows) {
        stmt.run({
          kbId: row.kbId,
          id: row.id,
          sourceEntityId: row.sourceEntityId,
          targetEntityId: row.targetEntityId,
          relationType: row.relationType,
          statement: row.statement ?? null,
          confidence: row.confidence ?? null,
          sentiment: row.sentiment ?? null,
          time: row.time ?? null,
          evidenceDocId: row.evidenceDocId ?? null,
          evidenceBlockId: row.evidenceBlockId ?? null,
          createdAtSeconds: nowSeconds,
          updatedAtSeconds: nowSeconds,
        });
      }
    });

    transaction(edges);
  }

  async getNodesByIds(kbId: string, ids: string[]): Promise<KnowledgeGraphNodeRecord[]> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const db = this.getDb();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        id,
        name,
        canonical_name as canonicalName,
        type,
        description,
        source_doc_id as sourceDocId,
        source_block_id as sourceBlockId,
        created_at as createdAtSeconds,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_nodes
      WHERE kb_id = ?
        AND id IN (${placeholders})
    `);
    const rows = stmt.all(kbId, ...ids) as KnowledgeGraphNodeRecord[];
    return rows;
  }

  async listEdgesByEvidence(kbId: string, docId: string, blockIds: string[]): Promise<KnowledgeGraphEdgeRecord[]> {
    if (!Array.isArray(blockIds) || blockIds.length === 0) return [];

    const db = this.getDb();
    const placeholders = blockIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        id,
        source_entity_id as sourceEntityId,
        target_entity_id as targetEntityId,
        relation_type as relationType,
        statement,
        confidence,
        sentiment,
        time,
        evidence_doc_id as evidenceDocId,
        evidence_block_id as evidenceBlockId,
        created_at as createdAtSeconds,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_edges
      WHERE kb_id = ?
        AND evidence_doc_id = ?
        AND evidence_block_id IN (${placeholders})
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(kbId, docId, ...blockIds) as KnowledgeGraphEdgeRecord[];
    return rows;
  }

  async listEdgesByEntity(
    kbId: string,
    entityId: string,
    direction: KnowledgeGraphEdgeDirection,
    limit?: number
  ): Promise<KnowledgeGraphEdgeRecord[]> {
    const db = this.getDb();

    const selectSql = `
      SELECT
        kb_id as kbId,
        id,
        source_entity_id as sourceEntityId,
        target_entity_id as targetEntityId,
        relation_type as relationType,
        statement,
        confidence,
        sentiment,
        time,
        evidence_doc_id as evidenceDocId,
        evidence_block_id as evidenceBlockId,
        created_at as createdAtSeconds,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_edges
      WHERE kb_id = ?
        AND __WHERE__
      ORDER BY created_at DESC
      __LIMIT__
    `;

    let whereClause: string;
    let params: [string, string] | [string, string, string];

    if (direction === 'out') {
      whereClause = 'source_entity_id = ?';
      params = [kbId, entityId];
    } else if (direction === 'in') {
      whereClause = 'target_entity_id = ?';
      params = [kbId, entityId];
    } else {
      whereClause = '(source_entity_id = ? OR target_entity_id = ?)';
      params = [kbId, entityId, entityId];
    }

    // 说明：limit 是“读路径边界”，用于避免超级节点导致的性能问题（不是防御性补丁）。
    const limitClause =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';

    const stmt = db.prepare(selectSql.replace('__WHERE__', whereClause).replace('__LIMIT__', limitClause));
    const rows = stmt.all(...params) as KnowledgeGraphEdgeRecord[];
    return rows;
  }

  async listNodesBySourceDocId(kbId: string, docId: string): Promise<KnowledgeGraphNodeRecord[]> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        id,
        name,
        canonical_name as canonicalName,
        type,
        description,
        source_doc_id as sourceDocId,
        source_block_id as sourceBlockId,
        created_at as createdAtSeconds,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_nodes
      WHERE kb_id = ? AND source_doc_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(kbId, docId) as KnowledgeGraphNodeRecord[];
  }

  async listEdgesByEvidenceDocId(kbId: string, docId: string): Promise<KnowledgeGraphEdgeRecord[]> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        id,
        source_entity_id as sourceEntityId,
        target_entity_id as targetEntityId,
        relation_type as relationType,
        statement,
        confidence,
        sentiment,
        time,
        evidence_doc_id as evidenceDocId,
        evidence_block_id as evidenceBlockId,
        created_at as createdAtSeconds,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_edges
      WHERE kb_id = ? AND evidence_doc_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(kbId, docId) as KnowledgeGraphEdgeRecord[];
  }

  async upsertDocStatus(input: KnowledgeGraphDocStatusUpsertInput): Promise<void> {
    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;

    const stmt = db.prepare(`
      INSERT INTO knowledge_graph_doc_status (
        kb_id,
        doc_id,
        chunk_count,
        done_chunks,
        status,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kb_id, doc_id) DO UPDATE SET
        chunk_count = excluded.chunk_count,
        done_chunks = excluded.done_chunks,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    stmt.run(input.kbId, input.docId, input.chunkCount, input.doneChunks, input.status, nowSeconds);
  }

  async getDocStatus(kbId: string, docId: string): Promise<KnowledgeGraphDocStatusRecord | undefined> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        doc_id as docId,
        chunk_count as chunkCount,
        done_chunks as doneChunks,
        status,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_doc_status
      WHERE kb_id = ? AND doc_id = ?
      LIMIT 1
    `);

    const row = stmt.get(kbId, docId) as KnowledgeGraphDocStatusRecord | undefined;
    return row;
  }

  async tryAcquireDocExtractionLock(
    kbId: string,
    docId: string,
    chunkCount: number,
    initialDoneChunks: number
  ): Promise<boolean> {
    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;

    /**
     * 利用 SQLite 的 ON CONFLICT DO UPDATE + WHERE 实现原子互斥：
     * - 行不存在：insert 成功（changes=1）
     * - 行存在且 status != 'running'：update 成功（changes=1）
     * - 行存在且 status == 'running'：WHERE 不满足，update 被跳过（changes=0）
     */
    const stmt = db.prepare(`
      INSERT INTO knowledge_graph_doc_status (
        kb_id,
        doc_id,
        chunk_count,
        done_chunks,
        status,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kb_id, doc_id) DO UPDATE SET
        chunk_count = excluded.chunk_count,
        done_chunks = excluded.done_chunks,
        status = excluded.status,
        updated_at = excluded.updated_at
      WHERE knowledge_graph_doc_status.status != 'running'
    `);

    const safeDoneChunks = Number.isFinite(initialDoneChunks) && initialDoneChunks > 0 ? initialDoneChunks : 0;
    const result = stmt.run(kbId, docId, chunkCount, safeDoneChunks, 'running', nowSeconds);
    return result.changes > 0;
  }

  async updateDocProgress(
    kbId: string,
    docId: string,
    doneChunks: number,
    status?: KnowledgeGraphDocStatusValue
  ): Promise<void> {
    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;

    const effectiveStatus = status ?? 'running';

    const stmt = db.prepare(`
      UPDATE knowledge_graph_doc_status
      SET done_chunks = ?, status = ?, updated_at = ?
      WHERE kb_id = ? AND doc_id = ?
    `);

    const result = stmt.run(doneChunks, effectiveStatus, nowSeconds, kbId, docId);
    if (result.changes === 0) {
      // 不允许静默写入：调用方必须先 upsertDocStatus 写入 chunk_count
      throw new Error(
        `[BetterSqliteKnowledgeGraphRepository] updateDocProgress failed: doc_status not found (kbId=${kbId}, docId=${docId})`
      );
    }
  }

  async getKbProgress(kbId: string): Promise<KnowledgeGraphKbProgress> {
    const db = this.getDb();
    /**
     * 端到端进度定义（根因修复）：
     * - 图谱构建并非“抽取完成”就结束，还包括“向量索引（embedding + Qdrant upsert）”；
     * - 因此 KB 级进度需要同时聚合两部分：
     *   - 抽取：chunk_count / done_chunks（来自 knowledge_graph_doc_status）
     *   - 索引：node+edge 的 point 数（来自 knowledge_graph_nodes/edges 的计数）与 done_units（来自 knowledge_graph_vector_doc_status）
     *
     * 注意：
     * - 索引总量不能只依赖 vector_doc_status（因为抽取完成到索引入队之间可能还没有该行），
     *   所以这里直接按图谱表实时统计 node/edge 数作为分母，避免“抽取完直接 100%”。
     */
    const stmt = db.prepare(`
      WITH doc AS (
        SELECT
          ds.doc_id as docId,
          ds.chunk_count as chunkCount,
          ds.done_chunks as doneChunks,
          ds.updated_at as dsUpdatedAt,
          COALESCE(nc.nodeCount, 0) as nodeCount,
          COALESCE(ec.edgeCount, 0) as edgeCount,
          v.status as vectorStatus,
          COALESCE(v.done_units, 0) as vectorDoneUnits,
          COALESCE(v.updated_at, 0) as vectorUpdatedAt
        FROM knowledge_graph_doc_status ds
        LEFT JOIN (
          SELECT kb_id, source_doc_id as doc_id, COUNT(1) as nodeCount
          FROM knowledge_graph_nodes
          WHERE kb_id = ?
          GROUP BY kb_id, source_doc_id
        ) nc
          ON nc.kb_id = ds.kb_id AND nc.doc_id = ds.doc_id
        LEFT JOIN (
          SELECT kb_id, evidence_doc_id as doc_id, COUNT(1) as edgeCount
          FROM knowledge_graph_edges
          WHERE kb_id = ?
          GROUP BY kb_id, evidence_doc_id
        ) ec
          ON ec.kb_id = ds.kb_id AND ec.doc_id = ds.doc_id
        LEFT JOIN knowledge_graph_vector_doc_status v
          ON v.kb_id = ds.kb_id AND v.doc_id = ds.doc_id
        WHERE ds.kb_id = ?
      )
      SELECT
        COALESCE(SUM(chunkCount), 0) as extractTotalUnits,
        COALESCE(SUM(doneChunks), 0) as extractDoneUnits,
        COALESCE(SUM(nodeCount + edgeCount), 0) as indexTotalUnits,
        COALESCE(SUM(
          CASE
            WHEN vectorStatus = 'completed' THEN (nodeCount + edgeCount)
            WHEN vectorStatus = 'running' THEN
              CASE
                WHEN vectorDoneUnits > (nodeCount + edgeCount) THEN (nodeCount + edgeCount)
                ELSE vectorDoneUnits
              END
            ELSE 0
          END
        ), 0) as indexDoneUnits,
        MAX(
          CASE
            WHEN vectorUpdatedAt > dsUpdatedAt THEN vectorUpdatedAt
            ELSE dsUpdatedAt
          END
        ) as updatedAtSeconds
      FROM doc
    `);

    const row = stmt.get(kbId, kbId, kbId) as {
      extractTotalUnits: number;
      extractDoneUnits: number;
      indexTotalUnits: number;
      indexDoneUnits: number;
      updatedAtSeconds: number | null;
    };

    const extractTotalUnits = typeof row?.extractTotalUnits === 'number' ? row.extractTotalUnits : 0;
    const extractDoneUnits = typeof row?.extractDoneUnits === 'number' ? row.extractDoneUnits : 0;
    const indexTotalUnits = typeof row?.indexTotalUnits === 'number' ? row.indexTotalUnits : 0;
    const indexDoneUnits = typeof row?.indexDoneUnits === 'number' ? row.indexDoneUnits : 0;
    const updatedAtSeconds = typeof row?.updatedAtSeconds === 'number' ? row.updatedAtSeconds : null;

    const totalUnits = extractTotalUnits + indexTotalUnits;
    const doneUnits = extractDoneUnits + indexDoneUnits;

    const progress = totalUnits === 0 ? 0 : doneUnits / totalUnits;

    return {
      kbId,
      totalUnits,
      doneUnits,
      progress,
      updatedAtSeconds,
    };
  }

  async upsertVectorDocStatus(input: KnowledgeGraphVectorDocStatusUpsertInput): Promise<void> {
    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;

    const stmt = db.prepare(`
      INSERT INTO knowledge_graph_vector_doc_status (
        kb_id,
        doc_id,
        embedding_model_id,
        node_count,
        edge_count,
        done_units,
        status,
        error_message,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kb_id, doc_id) DO UPDATE SET
        embedding_model_id = excluded.embedding_model_id,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count,
        done_units = excluded.done_units,
        status = excluded.status,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      input.kbId,
      input.docId,
      input.embeddingModelId,
      input.nodeCount,
      input.edgeCount,
      input.doneUnits,
      input.status,
      input.errorMessage ?? null,
      nowSeconds
    );
  }

  async updateVectorDocProgress(
    kbId: string,
    docId: string,
    doneUnits: number,
    status?: KnowledgeGraphVectorDocStatusValue
  ): Promise<void> {
    const db = this.getDb();
    const nowSeconds = Date.now() / 1000;
    const effectiveStatus = typeof status === 'string' ? status : undefined;

    const stmt = db.prepare(`
      UPDATE knowledge_graph_vector_doc_status
      SET
        done_units = ?,
        status = COALESCE(?, status),
        updated_at = ?
      WHERE kb_id = ? AND doc_id = ?
    `);

    const result = stmt.run(doneUnits, effectiveStatus ?? null, nowSeconds, kbId, docId);
    if (result.changes === 0) {
      // 不允许静默写入：调用方必须先 upsertVectorDocStatus 写入 node_count/edge_count
      throw new Error(
        `[BetterSqliteKnowledgeGraphRepository] updateVectorDocProgress failed: vector_doc_status not found (kbId=${kbId}, docId=${docId})`
      );
    }
  }

  async getVectorDocStatus(
    kbId: string,
    docId: string
  ): Promise<KnowledgeGraphVectorDocStatusRecord | undefined> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        doc_id as docId,
        embedding_model_id as embeddingModelId,
        node_count as nodeCount,
        edge_count as edgeCount,
        done_units as doneUnits,
        status,
        error_message as errorMessage,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_vector_doc_status
      WHERE kb_id = ? AND doc_id = ?
      LIMIT 1
    `);

    return stmt.get(kbId, docId) as KnowledgeGraphVectorDocStatusRecord | undefined;
  }

  async listVectorDocStatusByKb(kbId: string): Promise<KnowledgeGraphVectorDocStatusRecord[]> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT
        kb_id as kbId,
        doc_id as docId,
        embedding_model_id as embeddingModelId,
        node_count as nodeCount,
        edge_count as edgeCount,
        done_units as doneUnits,
        status,
        error_message as errorMessage,
        updated_at as updatedAtSeconds
      FROM knowledge_graph_vector_doc_status
      WHERE kb_id = ?
      ORDER BY updated_at DESC
    `);
    return stmt.all(kbId) as KnowledgeGraphVectorDocStatusRecord[];
  }

  async deleteGraphDataForDocument(
    kbId: string,
    docId: string
  ): Promise<{ deletedEdges: number; deletedDocStatus: number; deletedOrphanNodes: number }> {
    const db = this.getDb();

    /**
     * 关键一致性约束（根因修复）：
     * - 删除文档时，必须同步清理图谱表，否则会出现：
     *   1) KB 进度分母/分子仍包含已删除 doc
     *   2) Chunk-Driven 增强仍可能引用已删除 doc/block
     *
     * 清理顺序（强约束）：
     * 1) 删 edges（按 evidence_doc_id）
     * 2) 删 doc_status
     * 3) 删孤儿 nodes（仅保留仍被 edges 引用的节点）
     */

    const deleteEdgesStmt = db.prepare(`
      DELETE FROM knowledge_graph_edges
      WHERE kb_id = ? AND evidence_doc_id = ?
    `);

    const deleteDocStatusStmt = db.prepare(`
      DELETE FROM knowledge_graph_doc_status
      WHERE kb_id = ? AND doc_id = ?
    `);

    // 向量索引状态同样是 doc 级数据：删除 doc 时必须同步清理，否则会残留“已删除 doc 的索引状态”
    const deleteVectorDocStatusStmt = db.prepare(`
      DELETE FROM knowledge_graph_vector_doc_status
      WHERE kb_id = ? AND doc_id = ?
    `);

    const deleteOrphanNodesStmt = db.prepare(`
      DELETE FROM knowledge_graph_nodes
      WHERE kb_id = ?
        AND id NOT IN (
          SELECT source_entity_id FROM knowledge_graph_edges WHERE kb_id = ?
          UNION
          SELECT target_entity_id FROM knowledge_graph_edges WHERE kb_id = ?
        )
    `);

    const tx = db.transaction(() => {
      const deletedEdges = deleteEdgesStmt.run(kbId, docId).changes;
      const deletedDocStatus = deleteDocStatusStmt.run(kbId, docId).changes;
      // 仅用于一致性清理；不纳入返回统计，避免影响既有日志/测试语义
      deleteVectorDocStatusStmt.run(kbId, docId);
      const deletedOrphanNodes = deleteOrphanNodesStmt.run(kbId, kbId, kbId).changes;

      return { deletedEdges, deletedDocStatus, deletedOrphanNodes };
    });

    return tx();
  }

  async deleteDocStatusForDocument(kbId: string, docId: string): Promise<number> {
    const db = this.getDb();
    const stmt = db.prepare(`
      DELETE FROM knowledge_graph_doc_status
      WHERE kb_id = ? AND doc_id = ?
    `);
    return stmt.run(kbId, docId).changes;
  }

  async deleteGraphDataForKb(kbId: string): Promise<{
    deletedNodes: number;
    deletedEdges: number;
    deletedDocStatus: number;
    deletedVectorDocStatus: number;
    deletedIndexStatus: number;
  }> {
    const db = this.getDb();

    /**
     * 清理顺序（强约束）：
     * 1) edges（避免 nodes 的外部引用残留）
     * 2) nodes
     * 3) doc_status / vector_doc_status / index_status（进度与索引状态）
     *
     * 说明：
     * - 这里是“按 KB 全量清空”，因此不需要孤儿判断；
     * - 不删除 KB/Doc 元数据与 SoT，保证可重新抽取。
     */
    const deleteEdgesStmt = db.prepare(`
      DELETE FROM knowledge_graph_edges
      WHERE kb_id = ?
    `);
    const deleteNodesStmt = db.prepare(`
      DELETE FROM knowledge_graph_nodes
      WHERE kb_id = ?
    `);
    const deleteDocStatusStmt = db.prepare(`
      DELETE FROM knowledge_graph_doc_status
      WHERE kb_id = ?
    `);
    const deleteVectorDocStatusStmt = db.prepare(`
      DELETE FROM knowledge_graph_vector_doc_status
      WHERE kb_id = ?
    `);
    const deleteIndexStatusStmt = db.prepare(`
      DELETE FROM knowledge_graph_index_status
      WHERE kb_id = ?
    `);

    const tx = db.transaction(() => {
      const deletedEdges = deleteEdgesStmt.run(kbId).changes;
      const deletedNodes = deleteNodesStmt.run(kbId).changes;
      const deletedDocStatus = deleteDocStatusStmt.run(kbId).changes;
      const deletedVectorDocStatus = deleteVectorDocStatusStmt.run(kbId).changes;
      const deletedIndexStatus = deleteIndexStatusStmt.run(kbId).changes;
      return { deletedNodes, deletedEdges, deletedDocStatus, deletedVectorDocStatus, deletedIndexStatus };
    });

    return tx();
  }
}


