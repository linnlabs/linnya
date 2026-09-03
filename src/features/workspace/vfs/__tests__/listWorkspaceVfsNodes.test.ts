import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { listWorkspaceVfsNodes, type WorkspaceVfsDatabase, type WorkspaceVfsStatement } from '../orchestration/listWorkspaceVfsNodes';
import type { WorkspaceNodeRow } from '../definitions/workspaceVfsNode';
import { buildResourceLibraryTags } from '../functions/resourceLibraryRole';
import { ensureBuiltinBackendPluginsRegistered } from '../../../../app-hosts/linnya/plugin-registry/builtin';
import { backendPluginRegistry } from '../../../../app-hosts/linnya/plugin-registry/registry';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';

interface AssetRow {
  readonly id: string;
  readonly uri: string;
  readonly media_type: string | null;
  readonly size_bytes: number | null;
  readonly sha256: string | null;
  readonly storage_status: string;
  readonly local_path: string | null;
  readonly created_at: number;
}

interface ProjectAssetLinkRow {
  readonly project_id: string;
  readonly asset_id: string;
}

class FakeStatement implements WorkspaceVfsStatement {
  constructor(
    private readonly sql: string,
    private readonly db: FakeWorkspaceVfsDatabase,
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

    if (this.sql.includes('FROM assets')) {
      const [projectId] = params;
      const projectAssetIds = this.db.getProjectAssetIds(projectId);
      if (this.sql.includes('NOT (')) {
        return this.db.assets
          .filter((asset) =>
            projectAssetIds.has(asset.id) &&
            !(asset.media_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(asset.uri))
          )
          .sort((a, b) => b.created_at - a.created_at);
      }
      return this.db.assets
        .filter((asset) =>
          projectAssetIds.has(asset.id) &&
          (
            asset.media_type?.startsWith('image/') ||
            /\.(png|jpe?g|gif|webp|bmp)$/i.test(asset.uri)
          )
        )
        .sort((a, b) => b.created_at - a.created_at);
    }

    return [];
  }

  get(...params: readonly unknown[]): unknown {
    if (this.sql.includes('FROM workspace_nodes') && this.sql.includes('WHERE id = ?')) {
      const [id] = params;
      return this.db.nodes.find((node) => node.id === id && node.deleted_at === null);
    }
    return undefined;
  }

  run(...params: readonly unknown[]): unknown {
    if (this.sql.includes('INSERT INTO workspace_nodes')) {
      const [
        id,
        projectId,
        name,
        createdAt,
        updatedAt,
        tags,
      ] = params;

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

class FakeWorkspaceVfsDatabase implements WorkspaceVfsDatabase {
  readonly nodes: WorkspaceNodeRow[] = [];
  readonly assets: AssetRow[] = [];
  readonly projectAssetLinks: ProjectAssetLinkRow[] = [];

  prepare(sql: string): WorkspaceVfsStatement {
    return new FakeStatement(sql, this);
  }

  getProjectAssetIds(projectId: unknown): Set<string> {
    if (typeof projectId !== 'string') return new Set();
    return new Set(
      this.projectAssetLinks
        .filter((link) => link.project_id === projectId)
        .map((link) => link.asset_id),
    );
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
    const updatedAt = params.updatedAt ?? createdAt;
    this.nodes.push({
      id: params.id,
      project_id: params.projectId,
      parent_id: params.parentId ?? null,
      type: params.type,
      name: params.name,
      icon: null,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
      last_opened_at: null,
      access_count: 0,
      tags: params.tags ?? null,
    });
  }
}

let db: FakeWorkspaceVfsDatabase;
let tempDir: string;

function compareWorkspaceRows(a: WorkspaceNodeRow, b: WorkspaceNodeRow): number {
  const typeOrder = b.type.localeCompare(a.type);
  if (typeOrder !== 0) return typeOrder;
  return a.name.localeCompare(b.name);
}

describe('listWorkspaceVfsNodes', () => {
  beforeEach(async () => {
    ensureBuiltinBackendPluginsRegistered();
    if (!backendPluginRegistry.has('vfs-format-fixture')) {
      backendPluginRegistry.register({
        meta: {
          id: 'vfs-format-fixture',
          name: 'VFS Format Fixture',
          version: '1.0.0',
          description: 'Anonymous VFS format ownership fixture',
          developer: 'Fixture',
          builtin: false,
          ownedFileTypes: [{
            nodeType: 'plugin-document',
            extension: '.canvas',
            label: 'Plugin Canvas',
          }],
        },
        documentTypeHooks: [{
          docType: 'plugin-document',
          displayName: 'Plugin Canvas',
          systemViews: [
            { name: 'source.txt', viewKind: 'source' },
            { name: 'structure.md', viewKind: 'structure' },
          ],
        }],
      });
    }
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'vfs-format-fixture'],
      enabledPluginIds: ['platform', 'vfs-format-fixture'],
    });
    db = new FakeWorkspaceVfsDatabase();
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-vfs-'));
  });

  afterEach(async () => {
    clearPluginRuntimeStateForTests();
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('保留用户 workspace 树，空项目不默认显示资源库', async () => {
    db.insertNode({
      id: 'folder-1',
      projectId: 'project-1',
      type: 'folder',
      name: '用户文件夹',
    });
    db.insertNode({
      id: 'doc-1',
      projectId: 'project-1',
      parentId: 'folder-1',
      type: 'document',
      name: '混放文档.md',
    });
    db.insertNode({
      id: 'plugin-document-1',
      projectId: 'project-1',
      parentId: 'folder-1',
      type: 'plugin-document',
      name: '混放画布.canvas',
    });

    const root = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
    });

    expect(root.map((node) => node.name)).toEqual(['用户文件夹']);
    expect(root.find((node) => node.name === 'Resources')).toBeUndefined();

    const folderChildren = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      parentId: 'folder-1',
      generatedImagesDir: tempDir,
    });

    expect(folderChildren.map((node) => node.name).sort()).toEqual(['混放文档.md', '混放画布.canvas']);
  });

  it('插件文档保留协议文件名，同时给前端提供不带格式后缀的展示名', async () => {
    db.insertNode({
      id: 'plugin-document-1',
      projectId: 'project-1',
      type: 'plugin-document',
      name: '插件画布.canvas',
    });

    const root = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
    });

    expect(root).toHaveLength(1);
    expect(root[0]?.name).toBe('插件画布.canvas');
    expect(root[0]?.path).toBe('/插件画布.canvas');
    expect(root[0]?.display_name).toBe('插件画布');
  });

  it('历史资源库节点不再作为项目 VFS 节点暴露', async () => {
    db.insertNode({
      id: 'aaa-folder',
      projectId: 'project-1',
      type: 'folder',
      name: 'AAA 文件夹',
    });
    db.insertNode({
      id: 'resource-library',
      projectId: 'project-1',
      type: 'folder',
      name: '资源库',
      tags: buildResourceLibraryTags(),
    });
    db.insertNode({
      id: 'manual-folder',
      projectId: 'project-1',
      parentId: 'resource-library',
      type: 'folder',
      name: '手动素材',
    });

    const firstRoot = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
    });
    expect(firstRoot.map((node) => node.name)).toEqual(['AAA 文件夹']);
    expect(firstRoot.some((node) => node.source === 'resource_library')).toBe(false);
  });

  it('会话工作区图片不会进入项目 VFS', async () => {
    await fsp.writeFile(path.join(tempDir, 'generated_image.png'), 'png-bytes');

    const root = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
    });
    expect(root).toEqual([]);
  });

  it('project_asset_links 不再合成资源库 VFS 节点', async () => {
    db.insertNode({
      id: 'doc-project-1',
      projectId: 'project-1',
      type: 'document',
      name: '项目一.md',
    });
    db.insertNode({
      id: 'doc-project-2',
      projectId: 'project-2',
      type: 'document',
      name: '项目二.md',
    });
    db.assets.push(
      {
        id: 'asset-image-project-1',
        uri: 'asset://project-1-image.png',
        media_type: 'image/png',
        size_bytes: 10,
        sha256: null,
        storage_status: 'local',
        local_path: '/tmp/project-1-image.png',
        created_at: 2000,
      },
      {
        id: 'asset-file-project-1',
        uri: 'asset://project-1-brief.pdf',
        media_type: 'application/pdf',
        size_bytes: 20,
        sha256: null,
        storage_status: 'local',
        local_path: '/tmp/project-1-brief.pdf',
        created_at: 2001,
      },
      {
        id: 'asset-generated-project-1',
        uri: 'file:///tmp/project-1-generated.png',
        media_type: 'image/png',
        size_bytes: 40,
        sha256: null,
        storage_status: 'local',
        local_path: '/tmp/project-1-generated.png',
        created_at: 2003,
      },
      {
        id: 'asset-managed-image-project-1',
        uri: `/Resources/Attachments/aa/${'a'.repeat(64)}.png`,
        media_type: 'image/png',
        size_bytes: 50,
        sha256: 'a'.repeat(64),
        storage_status: 'local',
        local_path: `/tmp/ManagedAssets/v1/content/aa/${'a'.repeat(64)}.png`,
        created_at: 2004,
      },
      {
        id: 'asset-image-project-2',
        uri: 'asset://project-2-image.png',
        media_type: 'image/png',
        size_bytes: 30,
        sha256: null,
        storage_status: 'local',
        local_path: '/tmp/project-2-image.png',
        created_at: 2002,
      },
    );
    db.projectAssetLinks.push(
      { project_id: 'project-1', asset_id: 'asset-generated-project-1' },
      { project_id: 'project-1', asset_id: 'asset-managed-image-project-1' },
      { project_id: 'project-1', asset_id: 'asset-file-project-1' },
      { project_id: 'project-2', asset_id: 'asset-image-project-2' },
    );

    const root = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
    });
    expect(root.map((node) => node.name)).toEqual(['项目一.md']);
    expect(root.some((node) => node.source === 'resource_library')).toBe(false);
  });

  it('.linnya 系统视图默认不进入前端树，但可显式列出复合文档内部入口', async () => {
    db.insertNode({
      id: 'doc-1',
      projectId: 'project-1',
      type: 'document',
      name: '研究.md',
    });
    db.insertNode({
      id: 'plugin-document-1',
      projectId: 'project-1',
      type: 'plugin-document',
      name: '方案.canvas',
    });

    const defaultRoot = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
    });
    expect(defaultRoot.map((node) => node.name)).not.toContain('.linnya');

    const rootWithSystem = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      generatedImagesDir: tempDir,
      includeSystemNodes: true,
    });
    const systemRoot = rootWithSystem.find((node) => node.name === '.linnya');
    expect(systemRoot).toBeTruthy();
    if (!systemRoot) throw new Error('.linnya missing');

    const systemChildren = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      parentId: systemRoot.id,
      generatedImagesDir: tempDir,
    });
    expect(systemChildren.map((node) => node.name).sort()).toEqual(['protocol.md', 'views']);

    const views = systemChildren.find((node) => node.name === 'views');
    if (!views) throw new Error('views missing');
    const viewChildren = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      parentId: views.id,
      generatedImagesDir: tempDir,
    });
    const byInode = viewChildren.find((node) => node.name === 'by-inode');
    if (!byInode) throw new Error('by-inode missing');

    const inodeEntries = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      parentId: byInode.id,
      generatedImagesDir: tempDir,
    });
    expect(inodeEntries.map((node) => node.name).sort()).toEqual(['workspace:doc-1', 'workspace:plugin-document-1']);

    const pluginDocumentEntry = inodeEntries.find((node) => node.name === 'workspace:plugin-document-1');
    if (!pluginDocumentEntry) throw new Error('plugin document entry missing');
    const pluginDocumentViews = await listWorkspaceVfsNodes({
      db,
      projectId: 'project-1',
      parentId: pluginDocumentEntry.id,
      generatedImagesDir: tempDir,
    });
    expect(pluginDocumentViews.map((node) => node.name).sort()).toEqual(['source.txt', 'structure.md']);
  });
});
