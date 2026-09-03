/**
 * @file better-sqlite-metadata.repository.ts
 * @description 知识库元数据仓储 - better-sqlite3 实现
 * 
 * 功能 (What): 使用 better-sqlite3 操作 workspace.sqlite 中的知识库元数据表
 * 输入 (Input): 通过依赖注入获取 DatabaseService
 * 输出 (Output): 实现 MetadataRepository 接口的所有方法
 * 副作用 (Side-effects): 读写 workspace.sqlite 的 knowledge_bases 和 kb_documents 表
 * 
 * 关键设计：
 * - 不持有独立的数据库连接，通过 DatabaseService 获取统一的 db 实例
 * - 所有操作在主进程串行执行，无需手工 reload/save
 * - 依赖 WAL 模式支持并发读
 */

import type Database from 'better-sqlite3';
import { MetadataRepository } from '../metadataRepository';
import { KnowledgeBase, createKnowledgeBase, DEFAULT_KB_CONFIG as DEFAULT_KB_DOMAIN_CONFIG } from '../../domain/knowledgeBase';
import {
  Document,
  DocumentParseDiagnostics,
  DocumentParseDiagnosticsSchema,
  DocumentStatus,
} from '../../domain/document';
import { DatabaseService } from '../../../../electron-main/services/database';

// 默认知识库配置
const DEFAULT_KB_CONFIG = {
  id: 'default',
  name: '默认知识库',
  description: '用于存储所有未分类文档的默认知识库。',
  tags: [] as string[],
  // 默认关闭图谱构建：需要用户显式开启
  enableGraphIndexing: false,
  embeddingModelId: DEFAULT_KB_DOMAIN_CONFIG.embeddingModelId,
  rerankModelId: DEFAULT_KB_DOMAIN_CONFIG.rerankModelId,
  pdfOcrModelId: DEFAULT_KB_DOMAIN_CONFIG.pdfOcrModelId,
  imageVisionModelId: DEFAULT_KB_DOMAIN_CONFIG.imageVisionModelId,
  visionModelId: DEFAULT_KB_DOMAIN_CONFIG.visionModelId,
  createdAt: Date.now() / 1000,
};

interface DocumentRow {
  id: string;
  kb_id: string;
  filename: string;
  file_size: number | null;
  status: string;
  error_message: string | null;
  parse_diagnostics_json?: string | null;
  created_at: string;
}

function parseDocumentDiagnostics(json: string | null | undefined): DocumentParseDiagnostics | null {
  if (!json) return null;

  try {
    const parsed = JSON.parse(json);
    const result = DocumentParseDiagnosticsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function mapDocumentRow(row: DocumentRow): Document {
  return {
    id: row.id,
    kbId: row.kb_id,
    filename: row.filename,
    fileSize: row.file_size || 0,
    status: row.status as DocumentStatus,
    errorMessage: row.error_message || undefined,
    createdAt: new Date(row.created_at).getTime() / 1000,
    updatedAt: new Date(row.created_at).getTime() / 1000,
    parseDiagnostics: parseDocumentDiagnostics(row.parse_diagnostics_json),
  };
}

function nullableModelId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function mapKnowledgeBaseModelFields(row: {
  pdf_ocr_model_id: string | null;
  image_vision_model_id: string | null;
  vision_model_id: string | null;
}): Pick<KnowledgeBase, 'pdfOcrModelId' | 'imageVisionModelId' | 'visionModelId'> {
  const legacyVisionModelId = nullableModelId(row.vision_model_id);

  return {
    // PDF OCR 只读取新字段。旧 vision_model_id 曾被历史默认污染，不能再当作“显式 PDF OCR 覆盖”。
    pdfOcrModelId: nullableModelId(row.pdf_ocr_model_id),
    imageVisionModelId: nullableModelId(row.image_vision_model_id) ?? legacyVisionModelId,
    visionModelId: legacyVisionModelId,
  };
}

/**
 * better-sqlite3 版本的元数据仓储实现
 */
export class BetterSqliteMetadataRepository implements MetadataRepository {
  private readonly databaseService: DatabaseService;

  /**
   * 构造函数
   * @param databaseService 数据库服务实例
   */
  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
    console.log('[BetterSqliteMetadataRepository] 初始化完成');
    
    // 确保默认知识库存在
    this.ensureDefaultKnowledgeBaseExists();
  }

  /**
   * 获取数据库实例
   */
  private getDb(): Database.Database {
    return this.databaseService.getDb();
  }

  /**
   * 确保默认知识库存在
   */
  private ensureDefaultKnowledgeBaseExists(): void {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT id FROM knowledge_bases WHERE id = ?');
      const result = stmt.get('default') as { id: string } | undefined;

      if (!result) {
        console.log('[BetterSqliteMetadataRepository] 未找到默认知识库，正在创建...');
        
        const insertStmt = db.prepare(`
          INSERT INTO knowledge_bases (
            id,
            name,
            description,
            embedding_model_id,
            rerank_model_id,
            pdf_ocr_model_id,
            image_vision_model_id,
            vision_model_id,
            tags_json,
            enable_graph_indexing,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        insertStmt.run(
          DEFAULT_KB_CONFIG.id,
          DEFAULT_KB_CONFIG.name,
          DEFAULT_KB_CONFIG.description,
          null,
          null,
          null,
          null,
          null,
          // 默认知识库初始无标签
          null,
          DEFAULT_KB_CONFIG.enableGraphIndexing ? 1 : 0,
          DEFAULT_KB_CONFIG.createdAt,
          DEFAULT_KB_CONFIG.createdAt
        );
        
        console.log('[BetterSqliteMetadataRepository] ✅ 默认知识库创建成功');
      } else {
        console.log('[BetterSqliteMetadataRepository] ✓ 默认知识库已存在');
      }
    } catch (error) {
      console.error('[BetterSqliteMetadataRepository] ❌ 创建默认知识库失败:', error);
      throw error;
    }
  }

  /**
   * 创建新的知识库
   */
  async createKnowledgeBase(kb: KnowledgeBase): Promise<KnowledgeBase> {
    try {
      const db = this.getDb();
      const createdAt = typeof kb.createdAt === 'string' 
        ? new Date(kb.createdAt).getTime() / 1000 
        : Date.now() / 1000;

      const stmt = db.prepare(`
        INSERT INTO knowledge_bases (
          id,
          name,
          description,
          embedding_model_id,
          rerank_model_id,
          pdf_ocr_model_id,
          image_vision_model_id,
          vision_model_id,
          tags_json,
          enable_graph_indexing,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        kb.id,
        kb.name,
        kb.description || null,
        null,
        null,
        null,
        null,
        null,
        Array.isArray(kb.tags) && kb.tags.length > 0 ? JSON.stringify(kb.tags) : null,
        // 默认关闭：只有显式 true 才写入 1
        kb.enableGraphIndexing === true ? 1 : 0,
        createdAt,
        createdAt
      );

      console.log(`[BetterSqliteMetadataRepository] ✅ 知识库创建成功: ${kb.name} (ID: ${kb.id})`);
      return kb;
    } catch (error) {
      console.error('[BetterSqliteMetadataRepository] ❌ 创建知识库失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有知识库
   */
  async getAllKnowledgeBases(): Promise<KnowledgeBase[]> {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM knowledge_bases ORDER BY created_at DESC');
      const rows = stmt.all() as Array<{
        id: string;
        name: string;
        description: string | null;
        embedding_model_id: string | null;
        rerank_model_id: string | null;
        pdf_ocr_model_id: string | null;
        image_vision_model_id: string | null;
        vision_model_id: string | null;
        tags_json: string | null;
        enable_graph_indexing?: number | null;
        created_at: number;
        updated_at: number | null;
      }>;

      const knowledgeBases = rows.map(row => {
        let tags: string[] = [];
        if (row.tags_json) {
          try {
            const parsed = JSON.parse(row.tags_json);
            if (Array.isArray(parsed)) {
              tags = parsed.filter((item): item is string => typeof item === 'string');
            }
          } catch (error) {
            console.error('[BetterSqliteMetadataRepository] ❌ 解析 knowledge_bases.tags_json 失败:', error);
          }
        }

        return {
          id: row.id,
          name: row.name,
          description: row.description || undefined,
          embeddingModelId: row.embedding_model_id || undefined,
          rerankModelId: row.rerank_model_id || undefined,
          ...mapKnowledgeBaseModelFields(row),
          // sqlite: 1/0 -> boolean（缺省/null 视为 false，默认关闭）
          enableGraphIndexing: row.enable_graph_indexing === 1 ? true : false,
          createdAt: new Date(row.created_at * 1000).toISOString(),
          updatedAt: new Date((row.updated_at || row.created_at) * 1000).toISOString(),
          tags
        };
      });

      console.log(`[BetterSqliteMetadataRepository] 📚 获取所有知识库成功，共 ${knowledgeBases.length} 个`);
      return knowledgeBases;
    } catch (error) {
      console.error('[BetterSqliteMetadataRepository] ❌ 获取所有知识库失败:', error);
      return [];
    }
  }

  /**
   * 获取指定知识库的文档数量（按 kbId 聚合）
   *
   * 说明：
   * - 只做 COUNT 聚合，返回 { [kbId]: count }；
   * - 这里不做“状态过滤”（completed/processing/failed 等），因为 UI 的“文档数”语义是“该知识库中存在多少文档记录”；
   * - 若调用方传入空数组，直接返回空对象；
   * - 若某个 kbId 没有任何文档记录，则不会出现在 SQL 结果中，调用方应自行按需补 0。
   */
  async getDocumentCountsByKnowledgeBaseIds(kbIds: string[]): Promise<Record<string, number>> {
    if (!Array.isArray(kbIds) || kbIds.length === 0) return {};

    try {
      const normalizedKbIds = Array.from(
        new Set(
          kbIds
            .filter((id) => typeof id === 'string')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        )
      );

      if (normalizedKbIds.length === 0) return {};

      const db = this.getDb();
      const placeholders = normalizedKbIds.map(() => '?').join(',');
      const stmt = db.prepare(
        `SELECT kb_id as kbId, COUNT(1) as cnt FROM kb_documents WHERE kb_id IN (${placeholders}) GROUP BY kb_id`
      );

      const rows = stmt.all(...normalizedKbIds) as Array<{ kbId: string; cnt: number }>;
      const result: Record<string, number> = {};
      for (const row of rows) {
        if (typeof row.kbId === 'string' && typeof row.cnt === 'number' && Number.isFinite(row.cnt)) {
          result[row.kbId] = row.cnt;
        }
      }
      return result;
    } catch (error) {
      console.error('[BetterSqliteMetadataRepository] ❌ 获取知识库文档数量失败:', error);
      return {};
    }
  }

  /**
   * 根据ID获取知识库
   */
  async getKnowledgeBaseById(kbId: string): Promise<KnowledgeBase | undefined> {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?');
      const row = stmt.get(kbId) as {
        id: string;
        name: string;
        description: string | null;
        embedding_model_id: string | null;
        rerank_model_id: string | null;
        pdf_ocr_model_id: string | null;
        image_vision_model_id: string | null;
        vision_model_id: string | null;
        tags_json: string | null;
        enable_graph_indexing?: number | null;
        created_at: number;
        updated_at: number | null;
      } | undefined;

      if (!row) return undefined;

      let tags: string[] = [];
      if (row.tags_json) {
        try {
          const parsed = JSON.parse(row.tags_json);
          if (Array.isArray(parsed)) {
            tags = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch (error) {
          console.error('[BetterSqliteMetadataRepository] ❌ 解析单个 knowledge_bases.tags_json 失败:', error);
        }
      }

      return {
        id: row.id,
        name: row.name,
        description: row.description || undefined,
        embeddingModelId: row.embedding_model_id || undefined,
        rerankModelId: row.rerank_model_id || undefined,
        ...mapKnowledgeBaseModelFields(row),
        // sqlite: 1/0 -> boolean（缺省/null 视为 false，默认关闭）
        enableGraphIndexing: row.enable_graph_indexing === 1 ? true : false,
        createdAt: new Date(row.created_at * 1000).toISOString(),
        updatedAt: new Date((row.updated_at || row.created_at) * 1000).toISOString(),
        tags
      };
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 获取知识库 ${kbId} 失败:`, error);
      return undefined;
    }
  }

  async getKnowledgeBaseEmbeddingProvenance(kbId: string): Promise<string | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT embedding_model_id FROM knowledge_bases WHERE id = ?').get(kbId) as
      | { embedding_model_id: string | null }
      | undefined;
    return nullableModelId(row?.embedding_model_id);
  }

  async setKnowledgeBaseEmbeddingProvenance(kbId: string, embeddingModelId: string): Promise<void> {
    const normalized = embeddingModelId.trim();
    if (normalized.length === 0) {
      throw new Error('embedding provenance 不能为空');
    }
    const db = this.getDb();
    const result = db.prepare(`
      UPDATE knowledge_bases
      SET embedding_model_id = ?, updated_at = ?
      WHERE id = ?
    `).run(normalized, Date.now() / 1000, kbId);
    if (result.changes === 0) {
      throw new Error(`写入知识库 embedding 出身失败：未找到知识库 ${kbId}`);
    }
  }

  /**
   * 删除知识库
   */
  async deleteKnowledgeBase(kbId: string): Promise<boolean> {
    try {
      if (kbId === 'default') {
        console.error('[BetterSqliteMetadataRepository] 🚫 不允许删除默认知识库');
        return false;
      }

      const db = this.getDb();
      const stmt = db.prepare('DELETE FROM knowledge_bases WHERE id = ?');
      const result = stmt.run(kbId);

      if (result.changes > 0) {
        console.log(`[BetterSqliteMetadataRepository] 🗑️ 知识库删除成功: ${kbId}`);
        return true;
      } else {
        console.warn(`[BetterSqliteMetadataRepository] ⚠️ 知识库不存在: ${kbId}`);
        return false;
      }
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 删除知识库 ${kbId} 失败:`, error);
      return false;
    }
  }

  /**
   * 更新知识库的基础信息 / 配置
   * 
   * 仅更新调用方显式提供的字段，未提供的字段保持不变。
   */
  async updateKnowledgeBase(
    kbId: string,
    payload: {
      name?: string;
      description?: string | null;
      embeddingModelId?: string | null;
      rerankModelId?: string | null;
      pdfOcrModelId?: string | null;
      imageVisionModelId?: string | null;
      visionModelId?: string | null;
      tags?: string[];
      enableGraphIndexing?: boolean;
    }
  ): Promise<void> {
    try {
      const db = this.getDb();

      // 构造动态 UPDATE 语句，避免无意义的写入
      const sets: string[] = [];
      // 参数类型收窄：避免 any（sqlite 绑定支持 string/number/null）
      const params: Array<string | number | null> = [];

      if (typeof payload.name === 'string') {
        sets.push('name = ?');
        params.push(payload.name);
      }

      if (payload.description !== undefined) {
        sets.push('description = ?');
        params.push(payload.description);
      }

      if (payload.embeddingModelId !== undefined) {
        sets.push('embedding_model_id = ?');
        params.push(payload.embeddingModelId);
      }

      if (payload.rerankModelId !== undefined) {
        sets.push('rerank_model_id = ?');
        params.push(payload.rerankModelId);
      }

      if (payload.pdfOcrModelId !== undefined) {
        sets.push('pdf_ocr_model_id = ?');
        params.push(payload.pdfOcrModelId);
      }

      if (payload.imageVisionModelId !== undefined) {
        sets.push('image_vision_model_id = ?');
        params.push(payload.imageVisionModelId);
      }

      if (payload.visionModelId !== undefined) {
        sets.push('vision_model_id = ?');
        params.push(payload.visionModelId);
      }

      if (payload.tags !== undefined) {
        const tagsJson =
          Array.isArray(payload.tags) && payload.tags.length > 0
            ? JSON.stringify(
                payload.tags.filter(
                  (t): t is string => typeof t === 'string' && t.trim().length > 0
                )
              )
            : null;
        sets.push('tags_json = ?');
        params.push(tagsJson);
      }

      if (payload.enableGraphIndexing !== undefined) {
        sets.push('enable_graph_indexing = ?');
        params.push(payload.enableGraphIndexing ? 1 : 0);
      }

      if (sets.length === 0) {
        console.log(
          '[BetterSqliteMetadataRepository] ⚠️ updateKnowledgeBase: 无字段需要更新，直接返回'
        );
        return;
      }

      // 更新时间
      const nowSeconds = Date.now() / 1000;
      sets.push('updated_at = ?');
      params.push(nowSeconds);

      params.push(kbId);

      const sql = `UPDATE knowledge_bases SET ${sets.join(', ')} WHERE id = ?`;
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);

      if (result.changes === 0) {
        console.warn(
          `[BetterSqliteMetadataRepository] ⚠️ updateKnowledgeBase: 未找到知识库 ${kbId}，无任何行被更新`
        );
      } else {
        console.log(
          `[BetterSqliteMetadataRepository] 🔄 知识库 ${kbId} 已更新: ${sets.join(', ')}`
        );
      }
    } catch (error) {
      console.error(
        '[BetterSqliteMetadataRepository] ❌ 更新知识库配置失败:',
        error
      );
      throw error;
    }
  }

  /**
   * 添加文档
   */
  async addDocument(doc: Document): Promise<Document> {
    try {
      const db = this.getDb();
      const createdAtStr = typeof doc.createdAt === 'number'
        ? new Date(doc.createdAt * 1000).toISOString()
        : new Date().toISOString();

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO kb_documents (
          id,
          kb_id,
          filename,
          file_size,
          status,
          error_message,
          parse_diagnostics_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        doc.id,
        doc.kbId,
        doc.filename,
        doc.fileSize || null,
        doc.status,
        doc.errorMessage || null,
        doc.parseDiagnostics ? JSON.stringify(doc.parseDiagnostics) : null,
        createdAtStr
      );

      console.log(`[BetterSqliteMetadataRepository] 📄 文档添加成功: ${doc.filename} (ID: ${doc.id})`);
      return doc;
    } catch (error) {
      console.error('[BetterSqliteMetadataRepository] ❌ 添加文档失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取文档
   */
  async getDocumentById(docId: string): Promise<Document | undefined> {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM kb_documents WHERE id = ?');
      const row = stmt.get(docId) as DocumentRow | undefined;

      if (!row) return undefined;

      return mapDocumentRow(row);
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 获取文档 ${docId} 失败:`, error);
      return undefined;
    }
  }

  /**
   * 获取知识库中的所有文档
   */
  async getDocumentsInKnowledgeBase(kbId: string): Promise<Document[]> {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM kb_documents WHERE kb_id = ? ORDER BY created_at DESC');
      const rows = stmt.all(kbId) as DocumentRow[];

      const documents = rows.map(mapDocumentRow);

      console.log(`[BetterSqliteMetadataRepository] 📚 获取知识库 ${kbId} 文档成功，共 ${documents.length} 个`);
      return documents;
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 获取知识库 ${kbId} 中的文档失败:`, error);
      return [];
    }
  }

  /**
   * 获取所有文档
   */
  async getAllDocuments(): Promise<Document[]> {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM kb_documents ORDER BY created_at DESC');
      const rows = stmt.all() as DocumentRow[];

      const documents = rows.map(mapDocumentRow);

      console.log(`[BetterSqliteMetadataRepository] 📚 获取所有文档成功，共 ${documents.length} 个`);
      return documents;
    } catch (error) {
      console.error('[BetterSqliteMetadataRepository] ❌ 获取所有文档失败:', error);
      return [];
    }
  }

  /**
   * 更新文档状态
   */
  async updateDocumentStatus(docId: string, status: DocumentStatus, errorMessage?: string): Promise<boolean> {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        UPDATE kb_documents
        SET status = ?, error_message = ?
        WHERE id = ?
      `);

      const result = stmt.run(status, errorMessage || null, docId);

      if (result.changes > 0) {
        console.log(`[BetterSqliteMetadataRepository] 🔄 文档状态更新成功: ${docId} -> ${status}`);
        return true;
      } else {
        console.warn(`[BetterSqliteMetadataRepository] ⚠️ 文档不存在，无法更新状态: ${docId}`);
        return false;
      }
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 更新文档 ${docId} 状态失败:`, error);
      return false;
    }
  }

  async updateDocumentParseDiagnostics(docId: string, diagnostics: DocumentParseDiagnostics): Promise<boolean> {
    try {
      const parsed = DocumentParseDiagnosticsSchema.safeParse(diagnostics);
      if (!parsed.success) {
        console.error(`[BetterSqliteMetadataRepository] ❌ 文档解析诊断非法: ${docId}`);
        return false;
      }

      const db = this.getDb();
      const stmt = db.prepare(`
        UPDATE kb_documents
        SET parse_diagnostics_json = ?
        WHERE id = ?
      `);

      const result = stmt.run(JSON.stringify(parsed.data), docId);

      if (result.changes > 0) {
        console.log(`[BetterSqliteMetadataRepository] 🔄 文档解析诊断更新成功: ${docId}`);
        return true;
      }

      console.warn(`[BetterSqliteMetadataRepository] ⚠️ 文档不存在，无法更新解析诊断: ${docId}`);
      return false;
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 更新文档 ${docId} 解析诊断失败:`, error);
      return false;
    }
  }

  /**
   * 删除文档
   */
  async deleteDocument(docId: string): Promise<boolean> {
    try {
      const db = this.getDb();
      const stmt = db.prepare('DELETE FROM kb_documents WHERE id = ?');
      const result = stmt.run(docId);

      if (result.changes > 0) {
        console.log(`[BetterSqliteMetadataRepository] 🗑️ 文档删除成功: ${docId}`);
        return true;
      } else {
        console.warn(`[BetterSqliteMetadataRepository] ⚠️ 文档不存在: ${docId}`);
        return false;
      }
    } catch (error) {
      console.error(`[BetterSqliteMetadataRepository] ❌ 删除文档 ${docId} 失败:`, error);
      return false;
    }
  }

  /**
   * 关闭数据库连接（无操作，由 DatabaseService 统一管理）
   */
  close(): void {
    console.log('[BetterSqliteMetadataRepository] close() called - no-op (managed by DatabaseService)');
  }
}
