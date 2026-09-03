/**
 * @file workspace.ts
 * @description WorkspaceService - Electron 与插件调用方的 Workspace 兼容门面。
 *
 * 节点结构能力保留在门面内；项目生命周期、文档活动和项目统计委托给独立 feature。
 * 它不读取文档内部内容，节点职责包括：
 * - 创建、重命名、移动、删除节点
 * - 列出目录内容
 * - 查询节点信息
 * 
 * 特定类型节点的内部内容操作必须委托给对应 DocumentType provider。
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  createUniqueWorkspaceNodeCopyName,
  createUniqueWorkspaceNodeName,
} from '../../../features/workspace/functions/uniqueWorkspaceNodeName';
import {
  WorkspaceNodeNotFoundError,
  WorkspaceSiblingNameConflictError,
} from '../../../features/workspace/definitions/workspaceErrors';
import type { WorkspaceNode } from '../../../features/workspace/definitions/workspaceNode';
import type { WorkspaceMutationPublisher } from '../../../features/workspace/definitions/workspaceMutationPublisher';
import {
  createWorkspaceNodeCreatedEvent,
  createWorkspaceNodeDeletedEvent,
  createWorkspaceNodeMovedEvent,
  createWorkspaceNodeRenamedEvent,
  type WorkspaceMutationNodeSnapshot,
} from '../../../features/workspace/functions/createWorkspaceNodeMutationEvent';
import { moveWorkspaceNode } from '../../../features/workspace/node-move/orchestration/moveWorkspaceNode';
import type { RecentDocumentInfo } from '../../../features/workspace/document-activity/definitions/workspaceDocumentActivity';
import {
  listRecentWorkspaceDocuments,
  notifyWorkspaceDocumentOpened,
} from '../../../features/workspace/document-activity/orchestration/workspaceDocumentActivity';
import type { WorkspaceProject } from '../../../features/workspace/project-lifecycle/definitions/workspaceProject';
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  ensureDefaultWorkspaceProject,
  listWorkspaceProjects,
  updateWorkspaceProject,
} from '../../../features/workspace/project-lifecycle/orchestration/workspaceProjectLifecycle';
import type { ProjectCharStats } from '../../../features/workspace/project-stats/definitions/workspaceProjectStats';
import { readWorkspaceProjectCharStats } from '../../../features/workspace/project-stats/orchestration/readWorkspaceProjectCharStats';

export type { WorkspaceNode } from '../../../features/workspace/definitions/workspaceNode';
export type { RecentDocumentInfo } from '../../../features/workspace/document-activity/definitions/workspaceDocumentActivity';
export {
  DEFAULT_PROJECT_DESCRIPTION,
  DEFAULT_PROJECT_NAME,
  DEFAULT_PROJECT_SYSTEM_ROLE,
} from '../../../features/workspace/project-lifecycle/definitions/workspaceProject';
export type {
  ProjectSystemRole,
  WorkspaceProject,
} from '../../../features/workspace/project-lifecycle/definitions/workspaceProject';
export type { ProjectCharStats } from '../../../features/workspace/project-stats/definitions/workspaceProjectStats';

export interface WorkspaceServiceOptions {
  readonly mutationPublisher?: WorkspaceMutationPublisher;
}

interface WorkspaceNodeNameRow {
  id: string;
  name: string;
}

export class WorkspaceService {
  private readonly db: Database.Database;
  private readonly mutationPublisher?: WorkspaceMutationPublisher;

  constructor(db: Database.Database, options: WorkspaceServiceOptions = {}) {
    this.db = db;
    this.mutationPublisher = options.mutationPublisher;
  }

  /**
   * 获取单个节点
   */
  getNode(id: string): WorkspaceNode | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workspace_nodes
      WHERE id = ? AND deleted_at IS NULL
    `);
    return (stmt.get(id) as WorkspaceNode | undefined) ?? null;
  }

  private getNodeIncludingDeleted(id: string): WorkspaceNode | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workspace_nodes
      WHERE id = ?
    `);
    return (stmt.get(id) as WorkspaceNode | undefined) ?? null;
  }

  /**
   * 节点 mutation 可能发生在更大的同步事务中。
   * 因此事件延迟到下一个 macrotask，再按最终数据库状态确认一次，避免事务回滚后广播假事实。
   */
  private enqueueNodeMutationPublish(
    publish: () => void,
    isStillCurrent: () => boolean,
  ): void {
    if (!this.mutationPublisher) return;
    setTimeout(() => {
      if (!isStillCurrent()) return;
      publish();
    }, 0);
  }

  private publishNodeCreated(node: WorkspaceNode): void {
    const event = createWorkspaceNodeCreatedEvent(node);
    this.enqueueNodeMutationPublish(
      () => this.mutationPublisher?.publish(event),
      () => this.getNode(node.id) !== null,
    );
  }

  private publishNodeRenamed(node: WorkspaceNode, newName: string): void {
    const event = createWorkspaceNodeRenamedEvent(node, newName);
    this.enqueueNodeMutationPublish(
      () => this.mutationPublisher?.publish(event),
      () => this.getNode(node.id)?.name === newName,
    );
  }

  private publishNodeMoved(node: WorkspaceMutationNodeSnapshot, newParentId: string | null): void {
    const event = createWorkspaceNodeMovedEvent(node, newParentId);
    this.enqueueNodeMutationPublish(
      () => this.mutationPublisher?.publish(event),
      () => this.getNode(node.id)?.parent_id === newParentId,
    );
  }

  private publishNodeDeleted(node: WorkspaceNode, deletedNodeIds: readonly string[]): void {
    const event = createWorkspaceNodeDeletedEvent(node, deletedNodeIds);
    this.enqueueNodeMutationPublish(
      () => this.mutationPublisher?.publish(event),
      () => {
        const latest = this.getNodeIncludingDeleted(node.id);
        return latest !== null && latest.deleted_at !== null;
      },
    );
  }

  /**
   * 获取指定父节点下的所有子节点
   * @param parentId 父节点ID，null 表示根目录
   * @param projectId 项目ID，null 表示全局
   */
  getChildNodes(parentId: string | null, projectId: string | null): WorkspaceNode[] {
    if (parentId === null) {
      // 获取根节点
      const stmt = this.db.prepare(`
        SELECT * FROM workspace_nodes
        WHERE parent_id IS NULL AND project_id = ? AND deleted_at IS NULL
        ORDER BY type DESC, name ASC
      `);
      return stmt.all(projectId) as WorkspaceNode[];
    } else {
      // 获取子节点
      const stmt = this.db.prepare(`
        SELECT * FROM workspace_nodes
        WHERE parent_id = ? AND project_id = ? AND deleted_at IS NULL
        ORDER BY type DESC, name ASC
      `);
      return stmt.all(parentId, projectId) as WorkspaceNode[];
    }
  }

  /**
   * 获取同父级未删除节点名。
   *
   * 中文说明：
   * - SQLite 的 UNIQUE(..., deleted_at) 无法约束 NULL deleted_at；
   * - 所以服务层必须显式检查，数据库层再用部分唯一索引兜底。
   */
  private getSiblingNameRows(params: {
    projectId: string | null;
    parentId: string | null;
    excludeNodeId?: string;
  }): WorkspaceNodeNameRow[] {
    const rows = this.db.prepare(`
      SELECT id, name
      FROM workspace_nodes
      WHERE
        project_id IS ?
        AND parent_id IS ?
        AND deleted_at IS NULL
    `).all(params.projectId, params.parentId) as WorkspaceNodeNameRow[];

    if (!params.excludeNodeId) return rows;
    return rows.filter((row) => row.id !== params.excludeNodeId);
  }

  private assertSiblingNameAvailable(params: {
    projectId: string | null;
    parentId: string | null;
    name: string;
    excludeNodeId?: string;
  }): void {
    const hasConflict = this.getSiblingNameRows(params).some((row) => row.name === params.name);
    if (!hasConflict) return;

    throw new WorkspaceSiblingNameConflictError(params.name, params.projectId, params.parentId);
  }

  createAvailableSiblingName(params: {
    projectId: string | null;
    parentId: string | null;
    desiredName: string;
    excludeNodeId?: string;
  }): string {
    return createUniqueWorkspaceNodeName({
      desiredName: params.desiredName,
      existingNames: this.getSiblingNameRows(params).map((row) => row.name),
    });
  }

  createAvailableSiblingCopyName(params: {
    projectId: string | null;
    parentId: string | null;
    sourceName: string;
  }): string {
    return createUniqueWorkspaceNodeCopyName({
      sourceName: params.sourceName,
      existingNames: this.getSiblingNameRows(params).map((row) => row.name),
    });
  }

  /**
   * 创建新节点
   */
  createNode(params: {
    type: string;
    name: string;
    parentId?: string | null;
    projectId?: string | null;
    icon?: string | null;
  }): WorkspaceNode {
    const now = Date.now();
    const id = uuidv4();
    const projectId = params.projectId || null;
    const parentId = params.parentId || null;

    this.assertSiblingNameAvailable({
      projectId,
      parentId,
      name: params.name,
    });

    const stmt = this.db.prepare(`
      INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, icon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      projectId,
      parentId,
      params.type,
      params.name,
      params.icon || null,
      now,
      now
    );
    const node = this.getNode(id)!;
    this.publishNodeCreated(node);
    return node;
  }

  /**
   * 重命名节点
   */
  renameNode(id: string, newName: string): void {
    const now = Date.now();
    const node = this.getNode(id);
    if (!node) {
      throw new WorkspaceNodeNotFoundError(id);
    }

    this.assertSiblingNameAvailable({
      projectId: node.project_id,
      parentId: node.parent_id,
      name: newName,
      excludeNodeId: id,
    });

    const stmt = this.db.prepare(`
      UPDATE workspace_nodes
      SET name = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `);
    
    const result = stmt.run(newName, now, id);
    
    if (result.changes === 0) {
      throw new WorkspaceNodeNotFoundError(id);
    }
    this.publishNodeRenamed(node, newName);
  }

  /**
   * 移动节点到新的父节点
   */
  moveNode(id: string, newParentId: string | null): void {
    const node = moveWorkspaceNode({
      db: this.db,
      nodeId: id,
      newParentId,
    });
    this.publishNodeMoved(node, newParentId);
  }

  /**
   * 软删除节点
   */
  deleteNode(id: string): string[] {
    const now = Date.now();
    const node = this.getNode(id);
    if (!node) {
      throw new WorkspaceNodeNotFoundError(id);
    }

    // 中文说明：文件夹删除必须是完整子树语义。只标记文件夹会留下不可见但仍可
    // 被“最近文档”和 Agent 工具读取的孤儿 page，前端也无法可靠判断 active page 是否已删除。
    const deleteSubtree = this.db.transaction(() => {
      const rows = this.db.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id
          FROM workspace_nodes
          WHERE id = ? AND deleted_at IS NULL
          UNION ALL
          SELECT child.id
          FROM workspace_nodes child
          JOIN subtree parent ON child.parent_id = parent.id
          WHERE child.deleted_at IS NULL
        )
        SELECT id FROM subtree
      `).all(id) as Array<{ id: string }>;
      const deletedNodeIds = rows.map((row) => row.id);
      if (deletedNodeIds.length === 0) {
        throw new WorkspaceNodeNotFoundError(id);
      }

      this.db.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id
          FROM workspace_nodes
          WHERE id = ? AND deleted_at IS NULL
          UNION ALL
          SELECT child.id
          FROM workspace_nodes child
          JOIN subtree parent ON child.parent_id = parent.id
          WHERE child.deleted_at IS NULL
        )
        UPDATE workspace_nodes
        SET deleted_at = ?, updated_at = ?
        WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
      `).run(id, now, now);
      return deletedNodeIds;
    });

    const deletedNodeIds = deleteSubtree();
    this.publishNodeDeleted(node, deletedNodeIds);
    return deletedNodeIds;
  }

  /**
   * 获取按最近打开时间排序的文档列表
   * @param limit 最多返回的数量，默认 8
   * @param projectId 可选，仅返回属于该项目的文档（SQL 层过滤，避免 Tool 层分页不准确）
   */
  getRecentDocuments(limit = 8, projectId?: string | null): RecentDocumentInfo[] {
    return listRecentWorkspaceDocuments({ db: this.db, limit, projectId });
  }

  /**
   * 通知文档已被打开，更新其元数据
   */
  notifyDocumentOpened(id: string): void {
    notifyWorkspaceDocumentOpened({ db: this.db, nodeId: id });
  }

  /**
   * 获取项目级的字符统计（中文按字、英文按词）。
   * 
   * 实现说明：
   * - Markdown 文档：使用 document_versions.char_count 的最新版本；
   * - 插件文档类型：通过 DocumentTypeBackendHook 暴露自己的统计 SQL；
   * - 仅统计未删除节点，且限定在指定 project_id 下。
   */
  getProjectCharStats(projectId: string): ProjectCharStats {
    return readWorkspaceProjectCharStats({ db: this.db, projectId });
  }

  /**
   * 检查节点是否存在
   */
  nodeExists(id: string): boolean {
    const node = this.getNode(id);
    return node !== null;
  }

  /**
   * 根据路径查找节点（用于迁移期间的兼容性）
   * 注意：这是一个过渡方法，新代码应该使用基于ID的操作
   */
  findNodeByPath(name: string, parentId: string | null, projectId: string | null = null): WorkspaceNode | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workspace_nodes
      WHERE name = ? AND parent_id IS ? AND project_id IS ? AND deleted_at IS NULL
      LIMIT 1
    `);
    return (stmt.get(name, parentId, projectId) as WorkspaceNode | undefined) ?? null;
  }

  /**
   * 创建普通用户项目
   */
  createProject(name: string, description?: string): string {
    return createWorkspaceProject({ db: this.db, name, description });
  }

  /**
   * 确保默认项目存在。
   *
   * 中文说明：
   * - 默认项目是系统项目，身份由 projects.system_role 表达，不再依赖中文名称；
   * - 这个入口只给启动/空库初始化使用，普通创建项目不能伪造 system_role。
   */
  ensureDefaultProject(): string {
    return ensureDefaultWorkspaceProject(this.db);
  }

  /**
   * 更新项目信息
   */
  updateProject(projectId: string, updates: { name?: string; description?: string }): void {
    updateWorkspaceProject({ db: this.db, projectId, updates });
  }

  /**
   * 获取所有未删除的项目
   */
  getAllProjects(): WorkspaceProject[] {
    return listWorkspaceProjects(this.db);
  }

  /**
   * 创建文件夹（便捷方法）
   */
  createFolder(projectId: string, name: string, parentId: string | null = null): string {
    const node = this.createNode({
      type: 'folder',
      name,
      projectId,
      parentId,
    });
    return node.id;
  }

  /**
   * 创建文档节点（便捷方法）
   */
  createDocument(
    projectId: string,
    name: string,
    parentId: string | null = null,
    type: string = 'document'
  ): string {
    const node = this.createNode({
      type,
      name,
      projectId,
      parentId,
    });
    return node.id;
  }

  /**
   * 永久删除普通项目及其所有子节点
   * 
   * 实现说明：
   * - 直接从 projects 表中删除记录
   * - 依赖外键 ON DELETE CASCADE 自动删除 workspace_nodes 及其关联的文档等数据
   * - 使用事务确保原子性
   */
  deleteProject(projectId: string): void {
    deleteWorkspaceProject({ db: this.db, projectId });
  }
}
