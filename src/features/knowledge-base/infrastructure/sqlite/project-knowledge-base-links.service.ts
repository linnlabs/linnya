/**
 * @file project-knowledge-base-links.service.ts
 * @description 项目与知识库关联关系管理服务
 * 
 * 功能 (What): 管理项目和知识库之间的多对多关联关系
 * 输入 (Input): 项目ID、知识库ID
 * 输出 (Output): 关联操作结果、关联列表
 * 副作用 (Side-effects): 读写 workspace.sqlite 的 project_knowledge_base_links 表
 * 
 * 核心能力：
 * - 创建/删除项目与知识库的关联
 * - 查询项目关联的所有知识库
 * - 查询知识库被哪些项目引用
 * - 强制校验：关联前确保项目和知识库都存在
 */

import type Database from 'better-sqlite3';
import { DatabaseService } from '../../../../electron-main/services/database';
import { BetterSqliteMetadataRepository } from './better-sqlite-metadata.repository';
import { KnowledgeBase } from '../../domain/knowledgeBase';
import type { ProjectKnowledgeBaseLink, ProjectInfo } from './project-knowledge-base-links.types';

/**
 * 项目-知识库关联管理服务
 */
export class ProjectKnowledgeBaseLinksService {
  private readonly databaseService: DatabaseService;
  private readonly metadataRepository: BetterSqliteMetadataRepository;

  constructor(
    databaseService: DatabaseService,
    metadataRepository: BetterSqliteMetadataRepository
  ) {
    this.databaseService = databaseService;
    this.metadataRepository = metadataRepository;
    console.log('[ProjectKnowledgeBaseLinksService] 初始化完成');
  }

  /**
   * 获取数据库实例
   */
  private getDb(): Database.Database {
    return this.databaseService.getDb();
  }

  /**
   * 关联知识库到项目
   * 
   * @param projectId 项目ID
   * @param kbId 知识库ID
   * @param role 角色（默认 read_write）
   * @throws 如果项目或知识库不存在
   */
  async linkKnowledgeBaseToProject(
    projectId: string,
    kbId: string,
    role: 'read_only' | 'read_write' = 'read_write'
  ): Promise<void> {
    const db = this.getDb();

    // 1. 校验项目是否存在
    const projectExists = db
      .prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(projectId);

    if (!projectExists) {
      throw new Error(`项目不存在: ${projectId}`);
    }

    // 2. 校验知识库是否存在
    const kb = await this.metadataRepository.getKnowledgeBaseById(kbId);
    if (!kb) {
      throw new Error(`知识库不存在: ${kbId}`);
    }

    // 3. 检查是否已存在关联
    const existingLink = db
      .prepare('SELECT * FROM project_knowledge_base_links WHERE project_id = ? AND kb_id = ?')
      .get(projectId, kbId);

    const now = Date.now();

    if (existingLink) {
      // 更新现有关联（幂等操作）
      db.prepare(`
        UPDATE project_knowledge_base_links
        SET role = ?, updated_at = ?
        WHERE project_id = ? AND kb_id = ?
      `).run(role, now, projectId, kbId);

      console.log(`[ProjectKnowledgeBaseLinksService] 更新关联: 项目 ${projectId} <-> 知识库 ${kbId}`);
    } else {
      // 创建新关联
      db.prepare(`
        INSERT INTO project_knowledge_base_links (project_id, kb_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(projectId, kbId, role, now, now);

      console.log(`[ProjectKnowledgeBaseLinksService] 创建关联: 项目 ${projectId} <-> 知识库 ${kbId}`);
    }
  }

  /**
   * 解除项目与知识库的关联
   * 
   * @param projectId 项目ID
   * @param kbId 知识库ID
   * @returns 是否成功删除
   */
  async unlinkKnowledgeBaseFromProject(
    projectId: string,
    kbId: string
  ): Promise<boolean> {
    const db = this.getDb();

    const result = db
      .prepare('DELETE FROM project_knowledge_base_links WHERE project_id = ? AND kb_id = ?')
      .run(projectId, kbId);

    const success = result.changes > 0;

    if (success) {
      console.log(`[ProjectKnowledgeBaseLinksService] 删除关联: 项目 ${projectId} <-> 知识库 ${kbId}`);
    } else {
      console.warn(`[ProjectKnowledgeBaseLinksService] 关联不存在: 项目 ${projectId} <-> 知识库 ${kbId}`);
    }

    return success;
  }

  /**
   * 获取项目关联的所有知识库ID列表
   * 
   * @param projectId 项目ID
   * @returns 知识库ID数组
   */
  async listKnowledgeBasesForProject(projectId: string): Promise<string[]> {
    const db = this.getDb();

    const rows = db
      .prepare('SELECT kb_id FROM project_knowledge_base_links WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as Array<{ kb_id: string }>;

    const kbIds = rows.map(row => row.kb_id);
    console.log(`[ProjectKnowledgeBaseLinksService] 项目 ${projectId} 关联了 ${kbIds.length} 个知识库`);

    return kbIds;
  }

  /**
   * 获取项目关联的所有知识库详细信息
   * 
   * @param projectId 项目ID
   * @returns 知识库对象数组
   */
  async listDetailedKnowledgeBasesForProject(projectId: string): Promise<KnowledgeBase[]> {
    const kbIds = await this.listKnowledgeBasesForProject(projectId);

    // 批量获取知识库详情
    const knowledgeBases: KnowledgeBase[] = [];
    for (const kbId of kbIds) {
      const kb = await this.metadataRepository.getKnowledgeBaseById(kbId);
      if (kb) {
        knowledgeBases.push(kb);
      } else {
        console.warn(`[ProjectKnowledgeBaseLinksService] 知识库 ${kbId} 不存在，但有关联记录（可能是脏数据）`);
      }
    }

    return knowledgeBases;
  }

  /**
   * 获取使用某个知识库的所有项目ID列表
   * 
   * @param kbId 知识库ID
   * @returns 项目ID数组
   */
  async listProjectsForKnowledgeBase(kbId: string): Promise<string[]> {
    const db = this.getDb();

    const rows = db
      .prepare('SELECT project_id FROM project_knowledge_base_links WHERE kb_id = ? ORDER BY created_at ASC')
      .all(kbId) as Array<{ project_id: string }>;

    const projectIds = rows.map(row => row.project_id);
    console.log(`[ProjectKnowledgeBaseLinksService] 知识库 ${kbId} 被 ${projectIds.length} 个项目引用`);

    return projectIds;
  }

  /**
   * 获取使用某个知识库的所有项目详细信息
   * 
   * @param kbId 知识库ID
   * @returns 项目信息数组
   */
  async listDetailedProjectsForKnowledgeBase(kbId: string): Promise<ProjectInfo[]> {
    const db = this.getDb();

    const rows = db.prepare(`
      SELECT p.id, p.name, p.description, p.icon
      FROM projects p
      INNER JOIN project_knowledge_base_links l ON p.id = l.project_id
      WHERE l.kb_id = ? AND p.deleted_at IS NULL
      ORDER BY l.created_at ASC
    `).all(kbId) as Array<{
      id: string;
      name: string;
      description: string | null;
      icon: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      icon: row.icon || undefined
    }));
  }

  /**
   * 获取项目与知识库的关联详情
   * 
   * @param projectId 项目ID
   * @param kbId 知识库ID
   * @returns 关联记录，如果不存在则返回 undefined
   */
  async getLinkDetail(
    projectId: string,
    kbId: string
  ): Promise<ProjectKnowledgeBaseLink | undefined> {
    const db = this.getDb();

    const row = db
      .prepare('SELECT * FROM project_knowledge_base_links WHERE project_id = ? AND kb_id = ?')
      .get(projectId, kbId) as {
        project_id: string;
        kb_id: string;
        role: string;
        created_at: number;
        updated_at: number;
      } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      projectId: row.project_id,
      kbId: row.kb_id,
      role: row.role as 'read_only' | 'read_write',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * 批量关联知识库到项目
   * 
   * @param projectId 项目ID
   * @param kbIds 知识库ID数组
   * @param role 角色（默认 read_write）
   * @returns 成功关联的数量
   */
  async linkMultipleKnowledgeBases(
    projectId: string,
    kbIds: string[],
    role: 'read_only' | 'read_write' = 'read_write'
  ): Promise<number> {
    let successCount = 0;

    for (const kbId of kbIds) {
      try {
        await this.linkKnowledgeBaseToProject(projectId, kbId, role);
        successCount++;
      } catch (error) {
        console.error(`[ProjectKnowledgeBaseLinksService] 关联失败 ${kbId}:`, error);
      }
    }

    console.log(`[ProjectKnowledgeBaseLinksService] 批量关联完成: ${successCount}/${kbIds.length}`);
    return successCount;
  }

  /**
   * 检查项目是否关联了某个知识库
   * 
   * @param projectId 项目ID
   * @param kbId 知识库ID
   * @returns 是否已关联
   */
  async isKnowledgeBaseLinkedToProject(
    projectId: string,
    kbId: string
  ): Promise<boolean> {
    const link = await this.getLinkDetail(projectId, kbId);
    return link !== undefined;
  }

  /**
   * 清理某个项目的所有知识库关联
   * 
   * @param projectId 项目ID
   * @returns 删除的关联数量
   */
  async clearProjectLinks(projectId: string): Promise<number> {
    const db = this.getDb();

    const result = db
      .prepare('DELETE FROM project_knowledge_base_links WHERE project_id = ?')
      .run(projectId);

    console.log(`[ProjectKnowledgeBaseLinksService] 清理项目 ${projectId} 的所有关联: ${result.changes} 条`);
    return result.changes;
  }

  /**
   * 清理某个知识库的所有项目关联
   * 
   * @param kbId 知识库ID
   * @returns 删除的关联数量
   */
  async clearKnowledgeBaseLinks(kbId: string): Promise<number> {
    const db = this.getDb();

    const result = db
      .prepare('DELETE FROM project_knowledge_base_links WHERE kb_id = ?')
      .run(kbId);

    console.log(`[ProjectKnowledgeBaseLinksService] 清理知识库 ${kbId} 的所有关联: ${result.changes} 条`);
    return result.changes;
  }
}

