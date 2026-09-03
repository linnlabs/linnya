import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceVfsNode } from 'src/features/workspace/vfs/orchestration/readWorkspaceVfsNode';
import { searchWorkspaceVfsNodes } from 'src/features/workspace/vfs/orchestration/searchWorkspaceVfsNodes';
import type { WorkspaceNodeRow } from 'src/features/workspace/vfs/definitions/workspaceVfsNode';
import {
  listWorkspaceVfsNodes,
  type WorkspaceVfsDatabase,
  type WorkspaceVfsNodeTypeAccessPolicy,
  type WorkspaceVfsStatement,
} from 'src/features/workspace/vfs/orchestration/listWorkspaceVfsNodes';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { mindmapBackendPlugin } from '@plugin/mindmap/backend';
import { slidesBackendPlugin } from '@plugin/slides/backend';
import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';

interface ConversationRow {
  readonly conversation_id: string;
  readonly title: string | null;
}

interface VersionRow {
  readonly id: string;
  readonly node_id: string;
  readonly version_number: number;
  readonly content_json: string;
  readonly checkpoint_seq?: number | null;
  readonly char_count?: number;
  readonly created_at?: number;
  readonly author_id?: string | null;
}

interface TextSnapshotRow {
  readonly node_id: string;
  readonly content_type: string;
  readonly text: string;
  readonly source_plugin_id: string | null;
  readonly source_node_type: string | null;
  readonly updated_at: number;
}

interface PendingRevisionRow {
  readonly id: string;
  readonly document_node_id: string;
  readonly target_block_id: string;
  readonly new_markdown: string;
  readonly source: 'ai' | 'user' | 'tool';
  readonly operation: 'insert' | 'update' | 'delete' | null;
  readonly meta_json: string | null;
  readonly created_at: number;
  readonly updated_at: number | null;
}

interface PresentationVersionRow {
  readonly node_id: string;
  readonly current_revision_id: string;
  readonly current_revision: number;
  readonly deck_source: string;
  readonly title: string;
  readonly slide_count: number;
}

interface PresentationDraftRow {
  readonly node_id: string;
  readonly deck_source: string;
  readonly source_hash: string;
  readonly base_revision_id: string;
  readonly base_revision: number;
  readonly last_error_summary: string | null;
  readonly last_error_kind: string | null;
  readonly updated_at: number;
}

class FakeStatement implements WorkspaceVfsStatement {
  constructor(
    private readonly sql: string,
    private readonly db: FakeVfsDatabase,
  ) {}

  all(...params: readonly unknown[]): unknown[] {
    if (this.sql.includes('FROM workspace_nodes') && this.sql.includes("type = 'folder'")) {
      const [projectId] = params;
      return this.db.nodes.filter((node) =>
        node.project_id === projectId &&
        node.type === 'folder' &&
        node.deleted_at === null
      );
    }

    if (this.sql.includes('FROM workspace_nodes') && this.sql.includes('type IN (')) {
      const [projectId, ...typeParams] = params;
      const nodeTypes = typeParams.filter((param): param is string => typeof param === 'string');
      const effectiveNodeTypes = nodeTypes.length > 0
        ? nodeTypes
        : ['document'];
      return this.db.nodes
        .filter((node) =>
          node.project_id === projectId &&
          effectiveNodeTypes.includes(node.type) &&
          node.deleted_at === null
        )
        .sort(compareWorkspaceRows);
    }

    if (this.sql.includes('FROM workspace_nodes') && this.sql.includes('parent_id IS NULL')) {
      const [projectId] = params;
      return this.db.nodes
        .filter((node) =>
          node.project_id === projectId &&
          node.parent_id === null &&
          node.deleted_at === null
        )
        .sort(compareWorkspaceRows);
    }

    if (this.sql.includes('FROM workspace_nodes') && this.sql.includes('parent_id = ?')) {
      const [parentId, projectId] = params;
      return this.db.nodes
        .filter((node) =>
          node.project_id === projectId &&
          node.parent_id === parentId &&
          node.deleted_at === null
        )
        .sort(compareWorkspaceRows);
    }

    if (this.sql.includes('FROM markdown_block_pending_revisions')) {
      const [documentNodeId] = params;
      return this.db.pendingRevisions
        .filter((revision) => revision.document_node_id === documentNodeId)
        .sort((a, b) => a.created_at - b.created_at);
    }

    return [];
  }

  get(...params: readonly unknown[]): unknown {
    if (this.sql.includes('FROM workspace_nodes') && this.sql.includes('WHERE id = ?')) {
      const [id] = params;
      return this.db.nodes.find((node) => node.id === id && node.deleted_at === null);
    }

    if (this.sql.includes('FROM document_versions')) {
      const [nodeId] = params;
      return latestByNodeId(this.db.documentVersions, nodeId);
    }

    if (this.sql.includes('FROM mindmap_versions')) {
      const [nodeId] = params;
      return latestByNodeId(this.db.mindmapVersions, nodeId);
    }

    if (this.sql.includes('FROM workspace_node_text_snapshots')) {
      const [nodeId] = params;
      return this.db.textSnapshots.find((snapshot) => snapshot.node_id === nodeId);
    }

    if (this.sql.includes('FROM presentation_documents')) {
      const [nodeId] = params;
      return this.db.presentationVersions.find((presentation) => presentation.node_id === nodeId);
    }

    if (this.sql.includes('FROM presentation_drafts')) {
      const [nodeId] = params;
      return this.db.presentationDrafts.find((draft) => draft.node_id === nodeId);
    }

    return undefined;
  }

  run(...params: readonly unknown[]): unknown {
    if (this.sql.includes('INSERT INTO workspace_nodes')) {
      const [id, projectId, name, createdAt, updatedAt, tags] = params;
      if (
        typeof id !== 'string' ||
        typeof projectId !== 'string' ||
        typeof name !== 'string' ||
        typeof createdAt !== 'number' ||
        typeof updatedAt !== 'number' ||
        typeof tags !== 'string'
      ) {
        throw new Error('invalid insert params');
      }
      this.db.insertNode({
        id,
        projectId,
        type: 'folder',
        name,
        createdAt,
        updatedAt,
        tags,
      });
    }
    return { changes: 1 };
  }
}

class FakeVfsDatabase implements WorkspaceVfsDatabase {
  readonly nodes: WorkspaceNodeRow[] = [];
  readonly documentVersions: VersionRow[] = [];
  readonly mindmapVersions: VersionRow[] = [];
  readonly presentationVersions: PresentationVersionRow[] = [];
  readonly presentationDrafts: PresentationDraftRow[] = [];
  readonly pendingRevisions: PendingRevisionRow[] = [];
  readonly textSnapshots: TextSnapshotRow[] = [];
  readonly conversations: ConversationRow[] = [];

  prepare(sql: string): WorkspaceVfsStatement {
    return new FakeStatement(sql, this);
  }

  insertNode(params: {
    id: string;
    projectId: string;
    parentId?: string | null;
    type: string;
    name: string;
    tags?: string | null;
    createdAt?: number;
    updatedAt?: number;
  }): void {
    const createdAt = params.createdAt ?? 1000;
    this.nodes.push({
      id: params.id,
      project_id: params.projectId,
      parent_id: params.parentId ?? null,
      type: params.type,
      name: params.name,
      icon: null,
      created_at: createdAt,
      updated_at: params.updatedAt ?? createdAt,
      deleted_at: null,
      last_opened_at: null,
      access_count: 0,
      tags: params.tags ?? null,
    });
  }

  saveTextSnapshot(params: {
    readonly nodeId: string;
    readonly contentType: string;
    readonly text: string;
    readonly sourcePluginId: string | null;
    readonly sourceNodeType: string | null;
    readonly updatedAt: number;
  }): void {
    this.textSnapshots.push({
      node_id: params.nodeId,
      content_type: params.contentType,
      text: params.text,
      source_plugin_id: params.sourcePluginId,
      source_node_type: params.sourceNodeType,
      updated_at: params.updatedAt,
    });
  }
}

function compareWorkspaceRows(a: WorkspaceNodeRow, b: WorkspaceNodeRow): number {
  const typeOrder = b.type.localeCompare(a.type);
  if (typeOrder !== 0) return typeOrder;
  return a.name.localeCompare(b.name);
}

function latestByNodeId<T extends { readonly node_id: string; readonly version_number: number }>(
  rows: readonly T[],
  nodeId: unknown,
): T | undefined {
  return rows
    .filter((row) => row.node_id === nodeId)
    .sort((a, b) => b.version_number - a.version_number)[0];
}

function markdownDocFromBlocks(blocks: readonly { readonly id: string; readonly text: string }[]): string {
  return JSON.stringify({
    type: 'doc',
    content: blocks.map((block) => ({
      type: 'rootBlock',
      attrs: { id: block.id },
      content: [
        {
          type: 'paragraphBlock',
          content: block.text.length > 0 ? [{ type: 'text', text: block.text }] : [],
        },
      ],
    })),
  });
}

function markdownDoc(text: string): string {
  return markdownDocFromBlocks([{ id: 'block-1', text }]);
}

let db: FakeVfsDatabase;

// 这里只组合 VFS 所需的公开插件契约。CLI、worker、sandbox 等能力有各自的
// Host 信任来源和专项测试，不能因为读取文档而顺带注册整套插件运行面。
const workspaceVfsPluginContributions = [
  {
    meta: mindmapBackendPlugin.meta,
    documentTypeHooks: mindmapBackendPlugin.documentTypeHooks,
  },
  {
    meta: slidesBackendPlugin.meta,
    documentTypeHooks: slidesBackendPlugin.documentTypeHooks,
  },
] satisfies readonly PluginBackendContribution[];

const denyMindmapContentPolicy: WorkspaceVfsNodeTypeAccessPolicy = {
  canReadContent: (nodeType) => nodeType !== 'mindmap',
  buildDisabledMessage: (_nodeType, action) => `Mindmap disabled while trying to ${action}`,
};

const SLIDES_SOURCE_WITH_TWO_PAGES = [
  'const cover = createSlide();',
  'createText({ content: "统一路径层 Slides" });',
  'const detail = createSlide();',
  'createText({ content: "第二页" });',
  'compose({ title: "Deck", slides: [cover, detail] });',
].join('\n');

describe('readWorkspaceVfsNode / searchWorkspaceVfsNodes', () => {
  beforeEach(() => {
    ensureBuiltinBackendPluginsRegistered();
    for (const contribution of workspaceVfsPluginContributions) {
      if (!backendPluginRegistry.has(contribution.meta.id)) {
        backendPluginRegistry.register(contribution);
      }
    }
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'mindmap', 'slides'],
      enabledPluginIds: ['platform', 'mindmap', 'slides'],
    });
    db = new FakeVfsDatabase();

    db.insertNode({ id: 'folder-1', projectId: 'project-1', type: 'folder', name: '项目资料' });
    db.insertNode({ id: 'doc-1', projectId: 'project-1', parentId: 'folder-1', type: 'document', name: '研究.md' });
    db.insertNode({ id: 'mindmap-1', projectId: 'project-1', parentId: 'folder-1', type: 'mindmap', name: '路线图.mindmap' });
    db.insertNode({ id: 'slides-1', projectId: 'project-1', parentId: 'folder-1', type: 'presentation', name: '方案.slides' });

    db.documentVersions.push({
      id: 'doc-v1',
      node_id: 'doc-1',
      version_number: 1,
      content_json: markdownDoc('统一路径层可以读取 Markdown'),
      char_count: 16,
      created_at: 1000,
      author_id: null,
    });
    db.mindmapVersions.push({
      id: 'mindmap-v1',
      node_id: 'mindmap-1',
      version_number: 1,
      content_json: JSON.stringify({
        nodeData: {
          topic: '统一路径层',
          children: [{ topic: '读取 MindMap' }],
        },
      }),
    });
    db.saveTextSnapshot({
      nodeId: 'mindmap-1',
      contentType: 'text/markdown',
      text: '# 统一路径层\n\n- 读取 MindMap',
      sourcePluginId: 'mindmap',
      sourceNodeType: 'mindmap',
      updatedAt: 1000,
    });
    db.presentationVersions.push({
      node_id: 'slides-1',
      current_revision_id: 'slides-v1',
      current_revision: 1,
      deck_source: SLIDES_SOURCE_WITH_TWO_PAGES,
      title: '统一路径层 Slides',
      slide_count: 2,
    });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  it('按用户真实文件夹路径读取 Core 与公开插件文档', async () => {
    const markdown = await readWorkspaceVfsNode({ db, projectId: 'project-1', path: '/项目资料/研究.md' });
    expect(markdown).toMatchObject({ ok: true, contentType: 'text/markdown' });
    expect(markdown.ok ? markdown.text : '').toContain('统一路径层可以读取 Markdown');

    const mindmap = await readWorkspaceVfsNode({ db, projectId: 'project-1', path: '/项目资料/路线图.mindmap' });
    expect(mindmap.ok ? mindmap.text : '').toContain('读取 MindMap');

    const slides = await readWorkspaceVfsNode({ db, projectId: 'project-1', path: '/项目资料/方案.slides' });
    expect(slides.ok ? slides.text : '').toContain('统一路径层 Slides');
    expect(slides.ok ? slides.metadata : {}).toMatchObject({
      slideCount: 2,
      totalLines: 5,
      sourceOrigin: 'compiled',
    });
  });

  it('Slides 存在 pending draft 时读取 draft 作为 current source', async () => {
    const draftSource = SLIDES_SOURCE_WITH_TWO_PAGES.replace('统一路径层 Slides', '待修复 Draft Slides');
    db.presentationDrafts.push({
      node_id: 'slides-1',
      deck_source: draftSource,
      source_hash: 'draft-hash-1',
      base_revision_id: 'slides-v1',
      base_revision: 1,
      last_error_summary: 'Sandbox execution failed',
      last_error_kind: 'sandbox',
      updated_at: 2000,
    });

    const slides = await readWorkspaceVfsNode({ db, projectId: 'project-1', path: '/项目资料/方案.slides' });

    expect(slides.ok ? slides.text : '').toContain('待修复 Draft Slides');
    expect(slides.ok ? slides.text : '').not.toContain('统一路径层 Slides');
    expect(slides.ok ? slides.metadata : {}).toMatchObject({
      versionNumber: 1,
      versionId: 'slides-v1',
      sourceOrigin: 'draft',
      sourceKey: 'draft:draft-hash-1',
      draftStatus: {
        baseVersionId: 'slides-v1',
        baseVersionNumber: 1,
        errorKind: 'sandbox',
        errorSummary: 'Sandbox execution failed',
        updatedAt: 2000,
      },
    });
  });

  it('历史资源库虚拟路径不再解析为 Workspace 节点', async () => {
    for (const pathValue of [
      '/Resources/Shared Memory/研究会话/长期记忆.md',
      '/Resources/Generated Images/generated.png',
      '/Resources/Attachments/brief.md',
    ]) {
      const result = await readWorkspaceVfsNode({
        db,
        projectId: 'project-1',
        path: pathValue,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('跨类型搜索默认搜索可见内容', async () => {
    const result = await searchWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      pattern: '统一路径层',
      maxResults: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.matches.map((match) => match.node.name).sort()).toEqual([
      '方案.slides',
      '研究.md',
      '路线图.mindmap',
    ].sort());
  });

  it('节点类型访问策略保留 Mindmap 文件名，并通过 host 快照读取和搜索事实文本', async () => {
    const children = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      parentId: 'folder-1',
      nodeTypeAccessPolicy: denyMindmapContentPolicy,
    });
    expect(children.map((node) => node.name)).toContain('路线图.mindmap');

    const read = await readWorkspaceVfsNode({
      db,
      projectId: 'project-1',
      path: '/项目资料/路线图.mindmap',
      nodeTypeAccessPolicy: denyMindmapContentPolicy,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.text).toContain('读取 MindMap');
    expect(read.metadata?.view).toBe('workspace_node_text_snapshot');

    const search = await searchWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      pattern: '读取 MindMap',
      nodeTypeAccessPolicy: denyMindmapContentPolicy,
    });
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error(search.message);
    expect(search.matches.map((match) => match.node.name)).toContain('路线图.mindmap');
  });

  it('Markdown 读取和搜索返回 base + pending 合并后的当前视图', async () => {
    db.documentVersions[0] = {
      id: 'doc-v2',
      node_id: 'doc-1',
      version_number: 2,
      content_json: markdownDocFromBlocks([
        { id: 'block-1', text: '旧标题' },
        { id: 'block-2', text: '将被删除的段落' },
        { id: 'block-3', text: '' },
      ]),
      char_count: 13,
      created_at: 2000,
      author_id: null,
    };
    db.pendingRevisions.push(
      {
        id: 'pending-1',
        document_node_id: 'doc-1',
        target_block_id: 'block-1',
        new_markdown: '# 当前标题',
        source: 'ai',
        operation: 'update',
        meta_json: JSON.stringify({ operation: 'update' }),
        created_at: 10,
        updated_at: null,
      },
      {
        id: 'pending-2',
        document_node_id: 'doc-1',
        target_block_id: 'block-2',
        new_markdown: '',
        source: 'ai',
        operation: 'delete',
        meta_json: JSON.stringify({ operation: 'delete' }),
        created_at: 11,
        updated_at: null,
      },
      {
        id: 'pending-3',
        document_node_id: 'doc-1',
        target_block_id: 'block-3',
        new_markdown: '新插入的 pending 段落',
        source: 'ai',
        operation: 'insert',
        meta_json: JSON.stringify({ operation: 'insert', anchorBlockId: 'block-1' }),
        created_at: 12,
        updated_at: null,
      },
    );

    const read = await readWorkspaceVfsNode({
      db,
      projectId: 'project-1',
      path: '/项目资料/研究.md',
    });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.text).toContain('# 当前标题');
    expect(read.text).toContain('新插入的 pending 段落');
    expect(read.text).not.toContain('旧标题');
    expect(read.text).not.toContain('将被删除的段落');
    expect(read.metadata).toMatchObject({ view: 'current', pendingCount: 3 });

    const search = await searchWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      path: '/项目资料/研究.md',
      pattern: 'pending 段落',
    });
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error(search.message);
    expect(search.matches).toHaveLength(1);
    expect(search.matches[0]?.preview).toContain('pending 段落');
  });

  it('可通过 .linnya 系统路径读取复合文档内部只读视图', async () => {
    const protocol = await readWorkspaceVfsNode({
      db,
      projectId: 'project-1',
      path: '/.linnya/protocol.md',
    });
    expect(protocol.ok ? protocol.text : '').toContain('KnowledgeBase 不进入项目 VFS');

    const markdownContent = await readWorkspaceVfsNode({
      db,
      projectId: 'project-1',
      path: '/.linnya/views/by-inode/workspace:doc-1/content.md',
    });
    expect(markdownContent.ok ? markdownContent.text : '').toContain('统一路径层可以读取 Markdown');

    const slidesStructure = await readWorkspaceVfsNode({
      db,
      projectId: 'project-1',
      path: '/.linnya/views/by-inode/workspace:slides-1/structure.md',
    });
    expect(slidesStructure.ok ? slidesStructure.text : '').toContain('slide_count: 2');

    const search = await searchWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      path: '/.linnya/views/by-inode/workspace:slides-1',
      pattern: 'slide_count',
    });
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error(search.message);
    expect(search.matches.map((match) => match.node.name)).toContain('structure.md');
  });
});
