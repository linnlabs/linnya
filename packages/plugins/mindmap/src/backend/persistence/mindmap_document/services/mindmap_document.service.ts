import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { DocumentVersionListSchema } from '@app/schemas';
import { planDocumentVersionRetention } from '@plugin/backend/documentHistory';
import {
  type PluginWorkspaceDocumentUpdatedPayload,
  saveWorkspaceNodeTextSnapshot,
} from '@plugin/backend/workspaceRuntime';
import {
  MINDMAP_PLUGIN_META,
  normalizeMindmap,
  serializeMindmapToMarkdownOutline,
} from '@plugin/mindmap/shared';
import type { MindMapData, MindMapNodeData, MindMapTheme } from '@plugin/mindmap/shared';

export type { MindMapData } from '@plugin/mindmap/shared';

export interface CreateMindMapParams {
  projectId: string;
  parentId: string | null;
  name: string;
  content?: MindMapData;
}

export interface MindMapWorkspacePort {
  createNode(params: {
    type: string;
    name: string;
    projectId: string;
    parentId: string | null;
  }): { id: string; name: string; type?: string | null };
}

export interface MindMapDocumentServiceOptions {
  readonly publishDocumentUpdated?: (payload: PluginWorkspaceDocumentUpdatedPayload) => void;
}

export interface UpdateMindMapParams {
  documentId: string; // workspace_node_id
  content: MindMapData;
  /**
   * 期望的基线版本号（CAS / 乐观锁）。
   *
   * 中文说明：
   * - 该参数用于避免“读-改-写”过程中被并发写入覆盖；
   * - 当传入该值时，updateDocument 会在同一事务内读取当前最新版本号并做严格校验：
   *   - 若当前最新版本号 !== expectedBaseVersionNumber，则拒绝写入并抛错；
   * - MindMap 工具侧不要求调用方提供版本号：工具会自动读取最新版本号，并将其作为 expectedBaseVersionNumber 传入以完成 CAS 校验。
   */
  expectedBaseVersionNumber?: number;
  metadata?: {
    rootTopic?: string;
    themeName?: string;
    layoutType?: number;
    nodeCount?: number;
    viewport?: {
      x: number;
      y: number;
      scale: number;
    };
  };
}

type MindMapVersionRow = {
  id: string;
  node_id: string;
  version_number: number;
  content_json: string;
  root_topic: string | null;
  theme_name: string | null;
  layout_type: number | null;
  node_count: number | null;
  /** 当前版本所有节点 topic 的混合统计值（中文按字、英文按词） */
  char_count: number | null;
  viewport_x?: number | null;
  viewport_y?: number | null;
  viewport_scale?: number | null;
  created_at: number;
  updated_at: number;
};

interface WorkspaceProjectRow {
  project_id: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMindMapVersionRow(value: unknown): value is MindMapVersionRow {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' &&
    typeof value.node_id === 'string' &&
    typeof value.version_number === 'number' &&
    typeof value.content_json === 'string' &&
    (typeof value.root_topic === 'string' || value.root_topic === null) &&
    (typeof value.theme_name === 'string' || value.theme_name === null) &&
    (typeof value.layout_type === 'number' || value.layout_type === null) &&
    (typeof value.node_count === 'number' || value.node_count === null) &&
    (typeof value.char_count === 'number' || value.char_count === null) &&
    typeof value.created_at === 'number' &&
    typeof value.updated_at === 'number';
}

function parseMindMapContentJson(contentJson: string, fallbackName: string): MindMapData {
  try {
    const parsed: unknown = JSON.parse(contentJson);
    return normalizeMindmap(parsed, fallbackName);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`MindMap 内容 JSON 解析失败：${message}`);
  }
}

function readThemeName(theme: MindMapTheme | undefined): string | null {
  return typeof theme?.name === 'string' && theme.name.trim().length > 0 ? theme.name.trim() : null;
}

export class MindMapDocumentService {
  constructor(
    private readonly db: Database.Database,
    private readonly workspaceService: MindMapWorkspacePort,
    private readonly options: MindMapDocumentServiceOptions = {},
  ) {}

  private saveTextSnapshot(params: {
    readonly nodeId: string;
    readonly content: MindMapData;
    readonly updatedAt: number;
  }): void {
    saveWorkspaceNodeTextSnapshot({
      db: this.db,
      nodeId: params.nodeId,
      contentType: 'text/markdown',
      text: serializeMindmapToMarkdownOutline(params.content),
      sourcePluginId: MINDMAP_PLUGIN_META.id,
      sourceNodeType: 'mindmap',
      updatedAt: params.updatedAt,
    });
  }

  private readWorkspaceProjectRow(nodeId: string): WorkspaceProjectRow | null {
    const row = this.db.prepare(`
      SELECT project_id
      FROM workspace_nodes
      WHERE id = ? AND deleted_at IS NULL
    `).get(nodeId) as WorkspaceProjectRow | undefined;
    return row ?? null;
  }

  private hasVersionAtLeast(nodeId: string, versionNumber: number): boolean {
    const row = this.db.prepare(`
      SELECT MAX(version_number) AS maxVersion
      FROM mindmap_versions
      WHERE node_id = ?
    `).get(nodeId) as { maxVersion: number | null } | undefined;
    return (row?.maxVersion ?? 0) >= versionNumber;
  }

  private enqueueDocumentUpdated(nodeId: string, versionNumber: number): void {
    const publishDocumentUpdated = this.options.publishDocumentUpdated;
    if (!publishDocumentUpdated) return;

    setTimeout(() => {
      if (!this.hasVersionAtLeast(nodeId, versionNumber)) return;
      const row = this.readWorkspaceProjectRow(nodeId);
      if (!row) return;
      publishDocumentUpdated({
        projectId: row.project_id,
        documentId: nodeId,
        nodeType: 'mindmap',
        mutationKind: 'version',
        versionNumber,
      });
    }, 0);
  }

  /**
   * 创建思维导图文档
   */
  createDocument(params: CreateMindMapParams) {
    const { parentId, name, content, projectId } = params;

    const initialContent = content || this.getDefaultContent(name);
    const now = Date.now();
    const versionId = uuidv4();
    const normalizedContent = normalizeMindmap(initialContent, name);
    const charCount = this.countTopicChars(normalizedContent.nodeData);

    const createTx = this.db.transaction(() => {
      // 快照是 mindmap_versions 的派生文本投影，必须与首个结构版本同事务写入，避免 host 读到漂移事实。
      const node = this.workspaceService.createNode({
        type: 'mindmap',
        name,
        projectId,
        parentId: parentId ?? null,
      });

      this.db
        .prepare(`
          INSERT INTO mindmap_versions (
            id, node_id, version_number, content_json,
            root_topic, theme_name, layout_type, node_count,
            char_count,
            viewport_x, viewport_y, viewport_scale,
            created_at, updated_at
          ) VALUES (
            @id, @nodeId, @versionNumber, @contentJson,
            @rootTopic, @themeName, @layoutType, @nodeCount,
            @charCount,
            @viewportX, @viewportY, @viewportScale,
            @createdAt, @updatedAt
          )
        `)
        .run({
          id: versionId,
          nodeId: node.id,
          versionNumber: 1,
          contentJson: JSON.stringify(normalizedContent),
          rootTopic: normalizedContent.nodeData.topic,
          themeName: readThemeName(normalizedContent.theme) ?? 'default',
          layoutType: normalizedContent.direction,
          nodeCount: this.countNodes(normalizedContent.nodeData),
          charCount,
          viewportX: 0,
          viewportY: 0,
          viewportScale: 1,
          createdAt: now,
          updatedAt: now,
        });

      this.saveTextSnapshot({
        nodeId: node.id,
        content: normalizedContent,
        updatedAt: now,
      });

      return node;
    });

    const node = createTx.immediate();
    this.enqueueDocumentUpdated(node.id, 1);
    return node;
  }

  /**
   * 获取思维导图文档内容 (最新版本)
   */
  getDocument(nodeId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM mindmap_versions 
      WHERE node_id = @nodeId 
      ORDER BY version_number DESC 
      LIMIT 1
    `);
    // better-sqlite3 返回 unknown，必须先过行级守卫再读取字段，避免脏数据绕过类型边界。
    const doc: unknown = stmt.get({ nodeId });

    if (doc === undefined) {
      return null;
    }
    if (!isMindMapVersionRow(doc)) {
      throw new Error(`MindMap 版本记录结构异常：${nodeId}`);
    }

    const content = parseMindMapContentJson(doc.content_json, doc.root_topic ?? nodeId);

    return {
      id: doc.id,
      nodeId: doc.node_id,
      versionNumber: doc.version_number,
      content,
      metadata: {
        rootTopic: doc.root_topic,
        themeName: doc.theme_name,
        layoutType: doc.layout_type,
        nodeCount: doc.node_count,
        viewport: {
          x: doc.viewport_x ?? 0,
          y: doc.viewport_y ?? 0,
          scale: doc.viewport_scale ?? 1,
        },
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
      },
    };
  }

  /**
   * 更新思维导图文档
   */
  updateDocument(params: UpdateMindMapParams) {
    const { documentId, content, metadata, expectedBaseVersionNumber } = params;
    const now = Date.now();

    const versionId = uuidv4();
    let nextVersionNumber = 0;

    const normalizedContent = normalizeMindmap(content, content.nodeData.topic);
    const rootTopic = metadata?.rootTopic || normalizedContent.nodeData.topic;
    const themeName = metadata?.themeName || readThemeName(normalizedContent.theme);
    const layoutType = metadata?.layoutType ?? normalizedContent.direction;
    const nodeCount = metadata?.nodeCount || this.countNodes(normalizedContent.nodeData);
    const charCount = this.countTopicChars(normalizedContent.nodeData);
    const viewportX = metadata?.viewport?.x ?? 0;
    const viewportY = metadata?.viewport?.y ?? 0;
    const viewportScale = metadata?.viewport?.scale ?? 1;

    const writeTx = this.db.transaction(() => {
      // 中文说明：在同一事务内读取“当前最新版本”，并（可选）做 CAS 校验，避免读写竞态。
      // 使用 IMMEDIATE 事务模式（见 writeTx.immediate()）可以尽早申请写锁，降低“读到旧快照”的概率。
      const currentVersionStmt = this.db.prepare(`
        SELECT version_number FROM mindmap_versions
        WHERE node_id = @nodeId
        ORDER BY version_number DESC
        LIMIT 1
      `);
      const currentVersion = currentVersionStmt.get({ nodeId: documentId }) as
        | { version_number: number }
        | undefined;

      const currentVersionNumber = currentVersion?.version_number ?? 0;

      if (typeof expectedBaseVersionNumber === 'number' && Number.isFinite(expectedBaseVersionNumber)) {
        if (expectedBaseVersionNumber !== currentVersionNumber) {
          throw new Error(
            `版本冲突：期望基线版本 ${expectedBaseVersionNumber}，当前最新版本 ${currentVersionNumber}。请重新读取文档后再试。`
          );
        }
      }

      nextVersionNumber = currentVersionNumber + 1;

      this.db
        .prepare(`
          INSERT INTO mindmap_versions (
            id, node_id, version_number, content_json,
            root_topic, theme_name, layout_type, node_count,
            char_count,
            viewport_x, viewport_y, viewport_scale,
            created_at, updated_at
          ) VALUES (
            @id, @nodeId, @versionNumber, @contentJson,
            @rootTopic, @themeName, @layoutType, @nodeCount,
            @charCount,
            @viewportX, @viewportY, @viewportScale,
            @createdAt, @updatedAt
          )
        `)
        .run({
          id: versionId,
          nodeId: documentId,
          versionNumber: nextVersionNumber,
          contentJson: JSON.stringify(normalizedContent),
          rootTopic,
          themeName,
          layoutType,
          nodeCount,
          charCount,
          viewportX,
          viewportY,
          viewportScale,
          createdAt: now,
          updatedAt: now,
        });

      this.db
        .prepare(`
          UPDATE workspace_nodes 
          SET updated_at = @updatedAt 
          WHERE id = @id
        `)
        .run({
          id: documentId,
          updatedAt: now,
        });

      this.saveTextSnapshot({
        nodeId: documentId,
        content: normalizedContent,
        updatedAt: now,
      });

      // Host 只选择时间恢复点；插件始终拥有自己的表和删除事务。
      const rows = this.db.prepare<[string], { versionId: string; order: number; createdAt: number }>(`
        SELECT id AS versionId, version_number AS "order", created_at AS createdAt
        FROM mindmap_versions WHERE node_id = ? ORDER BY version_number DESC
      `).all(documentId);
      const versions = DocumentVersionListSchema.parse(rows.map((row, index) => ({
        ...row, isCurrent: index === 0,
      })));
      const plan = planDocumentVersionRetention(versions);
      const remove = this.db.prepare('DELETE FROM mindmap_versions WHERE node_id = ? AND id = ?');
      for (const id of plan.removeVersionIds) remove.run(documentId, id);
    });

    // 中文说明：
    // - 用 IMMEDIATE 事务尽早申请写锁，减少“读到旧版本→并发写入→再写”的竞态窗口。
    // - 若并发写入发生，CAS 校验会明确报错，引导上层重试。
    writeTx.immediate();
    this.enqueueDocumentUpdated(documentId, nextVersionNumber);

    return { versionId, versionNumber: nextVersionNumber };
  }

  private getDefaultContent(name: string): MindMapData {
    return {
      nodeData: {
        id: uuidv4(),
        topic: name,
        root: true,
        children: [],
      },
      arrows: [],
      summaries: [],
      direction: 1, // 0: 向左, 1: 向右, 2: 双侧
    };
  }

  private countNodes(node: MindMapNodeData): number {
    let count = 1;
    for (const child of node.children) {
      count += this.countNodes(child);
    }
    return count;
  }

  /**
   * 统计思维导图中所有节点 topic 文本的「统计单位」总数。
   * 规则与 Markdown 保持一致：
   * - 中文：按单个汉字计数；
   * - 英文：按单词数计数。
   */
  private countTopicChars(node: MindMapNodeData): number {
    let total = 0;

    total += this.measureTextUnits(node.topic);

    for (const child of node.children) {
      total += this.countTopicChars(child);
    }

    return total;
  }

  /**
   * 与 Markdown 文档统一的文本计数规则。
   */
  private measureTextUnits(text: string): number {
    const chineseMatches = text.match(/[\u4E00-\u9FFF]/g) ?? [];
    const chineseCount = chineseMatches.length;

    const englishMatches = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
    const englishWordCount = englishMatches.length;

    return chineseCount + englishWordCount;
  }
}
