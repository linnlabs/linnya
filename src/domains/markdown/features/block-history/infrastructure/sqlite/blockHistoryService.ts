/**
 * @file block-history.service.ts
 * @description 块级版本历史服务 - 处理 RootBlock 的版本管理
 *
 * 核心功能：
 * - 创建块版本快照（手动保存、AI 修订、恢复操作）
 * - 查询块的历史版本列表
 * - 恢复到指定版本
 *
 * 设计原则：
 * - 版本数据是外部快照，不影响 ProseMirror 编辑器的 schema
 * - 每个 RootBlock 独立管理版本，版本号从 1 开始递增
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { validateBlockHistoryContentJson } from '../../functions/validateBlockHistoryContentJson';

// ==================== 类型定义 ====================

/** 版本来源类型 */
export type BlockVersionOriginType = 'manual' | 'ai' | 'restore';

/** 版本元数据（AI 修订时的额外信息） */
export interface BlockVersionMetadata {
  /** AI 模型 ID */
  modelId?: string;
  /** 用户输入的 prompt */
  prompt?: string;
  /** Diff 统计 */
  diffStats?: {
    insertCount: number;
    deleteCount: number;
  };
  /** 恢复操作时，源版本 ID */
  restoredFromVersionId?: string;
}

/** 块版本记录（数据库行） */
export interface BlockVersion {
  id: string;
  document_node_id: string;
  target_block_id: string;
  block_type: string;
  version_number: number;
  content_json: string;
  origin_type: BlockVersionOriginType;
  origin_metadata: string | null;
  created_at: number;
}

/** 创建版本的参数 */
export interface CreateBlockVersionParams {
  documentNodeId: string;
  targetBlockId: string;
  blockType: string;
  contentJson: string;
  originType: BlockVersionOriginType;
  originMetadata?: BlockVersionMetadata;
}

// ==================== 服务实现 ====================

export class BlockHistoryService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 创建一个新的块版本
   * 版本号自动递增，基于该块已有的最大版本号
   */
  createVersion(params: CreateBlockVersionParams): BlockVersion {
    const normalizedContentJson = validateBlockHistoryContentJson(
      params.contentJson,
      params.targetBlockId,
    );
    const now = Date.now();
    const id = uuidv4();

    // 获取当前块的最大版本号
    const maxVersionStmt = this.db.prepare(`
      SELECT MAX(version_number) as max_version
      FROM markdown_block_versions
      WHERE document_node_id = ? AND target_block_id = ?
    `);
    const result = maxVersionStmt.get(
      params.documentNodeId,
      params.targetBlockId
    ) as { max_version: number | null };
    const nextVersion = (result.max_version ?? 0) + 1;

    // 插入新版本
    const insertStmt = this.db.prepare(`
      INSERT INTO markdown_block_versions (
        id, document_node_id, target_block_id, block_type,
        version_number, content_json, origin_type, origin_metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      id,
      params.documentNodeId,
      params.targetBlockId,
      params.blockType,
      nextVersion,
      normalizedContentJson,
      params.originType,
      params.originMetadata ? JSON.stringify(params.originMetadata) : null,
      now
    );

    return this.getVersion(id)!;
  }

  private validateStoredVersion(version: BlockVersion): BlockVersion {
    return {
      ...version,
      content_json: validateBlockHistoryContentJson(
        version.content_json,
        version.target_block_id,
      ),
    };
  }

  /**
   * 获取单个版本详情
   */
  getVersion(versionId: string): BlockVersion | null {
    const stmt = this.db.prepare(`
      SELECT * FROM markdown_block_versions WHERE id = ?
    `);
    const version = stmt.get(versionId) as BlockVersion | null;
    return version ? this.validateStoredVersion(version) : null;
  }

  /**
   * 列出某个块的所有历史版本（按版本号倒序）
   */
  listVersions(documentNodeId: string, targetBlockId: string): BlockVersion[] {
    const stmt = this.db.prepare(`
      SELECT * FROM markdown_block_versions
      WHERE document_node_id = ? AND target_block_id = ?
      ORDER BY version_number DESC
    `);
    const versions = stmt.all(documentNodeId, targetBlockId) as BlockVersion[];
    return versions.map((version) => this.validateStoredVersion(version));
  }

  /**
   * 获取某个块的最新版本
   */
  getLatestVersion(documentNodeId: string, targetBlockId: string): BlockVersion | null {
    const stmt = this.db.prepare(`
      SELECT * FROM markdown_block_versions
      WHERE document_node_id = ? AND target_block_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `);
    const version = stmt.get(documentNodeId, targetBlockId) as BlockVersion | null;
    return version ? this.validateStoredVersion(version) : null;
  }

  /**
   * 恢复到指定版本
   * 这会创建一条新的版本记录（origin_type = 'restore'），内容复制自目标版本
   */
  restoreVersion(
    documentNodeId: string,
    targetBlockId: string,
    sourceVersionId: string
  ): BlockVersion {
    // 获取源版本
    const sourceVersion = this.getVersion(sourceVersionId);
    if (!sourceVersion) {
      throw new Error(`Version not found: ${sourceVersionId}`);
    }

    // 验证版本属于正确的文档和块
    if (
      sourceVersion.document_node_id !== documentNodeId ||
      sourceVersion.target_block_id !== targetBlockId
    ) {
      throw new Error('Version does not belong to the specified document/block');
    }

    // 创建恢复版本
    return this.createVersion({
      documentNodeId,
      targetBlockId,
      blockType: sourceVersion.block_type,
      contentJson: sourceVersion.content_json,
      originType: 'restore',
      originMetadata: {
        restoredFromVersionId: sourceVersionId,
      },
    });
  }

  /**
   * 删除某个块的所有版本（用于块被删除时的清理）
   */
  deleteAllVersionsForBlock(documentNodeId: string, targetBlockId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM markdown_block_versions
      WHERE document_node_id = ? AND target_block_id = ?
    `);
    const result = stmt.run(documentNodeId, targetBlockId);
    return result.changes;
  }

  /**
   * 删除单个历史版本
   * 
   * 功能 (What):
   *  - 根据版本 ID 删除一条版本记录
   * 输入 (Input):
   *  - versionId: 要删除的版本记录主键 ID
   * 输出 (Output):
   *  - 返回受影响的行数（0 表示未找到对应记录）
   * 副作用 (Side-effects):
   *  - 修改 markdown_block_versions 表数据
   */
  deleteVersion(versionId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM markdown_block_versions
      WHERE id = ?
    `);
    const result = stmt.run(versionId);
    return result.changes;
  }

  /**
   * 获取某个块的版本数量
   */
  getVersionCount(documentNodeId: string, targetBlockId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM markdown_block_versions
      WHERE document_node_id = ? AND target_block_id = ?
    `);
    const result = stmt.get(documentNodeId, targetBlockId) as { count: number };
    return result.count;
  }

  /**
   * 解析版本元数据
   * 工具方法，将 origin_metadata JSON 字符串解析为对象
   */
  parseMetadata(version: BlockVersion): BlockVersionMetadata | null {
    if (!version.origin_metadata) {
      return null;
    }
    try {
      return JSON.parse(version.origin_metadata) as BlockVersionMetadata;
    } catch {
      return null;
    }
  }
}
