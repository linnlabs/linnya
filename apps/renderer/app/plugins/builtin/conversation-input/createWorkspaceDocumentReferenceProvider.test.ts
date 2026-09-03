import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import type { WorkspaceNode } from '@/domains/workspace/store';
import {
  createWorkspaceDocumentReferenceProvider,
  type WorkspaceDocumentReferenceProviderPorts,
} from './createWorkspaceDocumentReferenceProvider';

const DocumentIcon: Component = { name: 'DocumentIcon' };
const SheetIcon: Component = { name: 'SheetIcon' };

function node(input: Partial<WorkspaceNode> & Pick<WorkspaceNode, 'id' | 'name' | 'type'>): WorkspaceNode {
  return {
    projectId: 'project-1',
    parentId: null,
    isExpanded: false,
    depth: 0,
    ...input,
  };
}

function createPorts(
  tree: WorkspaceNode[],
  overrides: Partial<WorkspaceDocumentReferenceProviderPorts> = {},
): WorkspaceDocumentReferenceProviderPorts {
  const getRecentDocuments = vi.fn<WorkspaceDocumentReferenceProviderPorts['getRecentDocuments']>();
  getRecentDocuments.mockResolvedValue({ success: true, data: [] });
  return {
    getCurrentProjectId: () => 'project-1',
    getLoadedProjectTree: () => ({ projectId: 'project-1', nodes: tree }),
    getRecentDocuments,
    resolveDocumentType: (nodeType) => {
      if (nodeType === 'document') return { label: 'Document', icon: DocumentIcon };
      if (nodeType === 'sheet') return { label: 'Sheet', icon: SheetIcon };
      return null;
    },
    ...overrides,
  };
}

describe('createWorkspaceDocumentReferenceProvider', () => {
  it('按已加载树搜索可用文档类型，并构造稳定 VFS inode 引用', async () => {
    const ports = createPorts([
      node({
        id: 'folder-1',
        name: 'Plans',
        type: 'folder',
        children: [
          node({ id: 'doc-1', name: 'Roadmap', type: 'document', parentId: 'folder-1' }),
          node({ id: 'asset-1', name: 'Roadmap.png', type: 'asset_image', parentId: 'folder-1' }),
        ],
      }),
      node({ id: 'sheet-1', name: 'Budget', type: 'sheet' }),
    ]);
    const provider = createWorkspaceDocumentReferenceProvider(ports);

    const candidates = await provider.query({ keyword: 'road', limit: 10 });

    expect(candidates).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        label: 'Roadmap',
        description: 'Document',
        icon: DocumentIcon,
        score: 200,
      }),
    ]);
    expect(ports.getRecentDocuments).not.toHaveBeenCalled();
    expect(provider.resolveReference(candidates[0])).toEqual({
      pluginId: 'platform',
      kind: 'workspace-document',
      label: 'Roadmap',
      previewText: 'Roadmap',
      text: 'Workspace document reference: "Roadmap" (inode="workspace:doc-1"). Use read_file with this inode and view="document" to read the latest content before answering.',
      metadata: {
        documentId: 'doc-1',
        inode: 'workspace:doc-1',
        projectId: 'project-1',
        documentType: 'document',
      },
    });
  });

  it('空关键字优先返回当前项目最近文档，并与已加载树按 document id 去重', async () => {
    const getRecentDocuments = vi.fn<WorkspaceDocumentReferenceProviderPorts['getRecentDocuments']>();
    getRecentDocuments.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'sheet-1',
          name: 'Budget',
          project_id: 'project-1',
          parent_id: null,
          project_name: 'Project 1',
          last_opened_at: 20,
          updated_at: 20,
          access_count: 2,
          type: 'sheet',
        },
        {
          id: 'doc-2',
          name: 'Notes',
          project_id: 'project-1',
          parent_id: null,
          project_name: 'Project 1',
          last_opened_at: 10,
          updated_at: 10,
          access_count: 1,
          type: 'document',
        },
      ],
    });
    const ports = createPorts([
      node({ id: 'doc-1', name: 'Roadmap', type: 'document' }),
      node({ id: 'sheet-1', name: 'Budget', type: 'sheet' }),
    ], {
      getRecentDocuments,
    });
    const provider = createWorkspaceDocumentReferenceProvider(ports);

    const candidates = await provider.query({ keyword: '', limit: 3 });

    expect(ports.getRecentDocuments).toHaveBeenCalledWith({
      projectId: 'project-1',
      limit: 3,
    });
    expect(candidates.map(candidate => candidate.id)).toEqual(['sheet-1', 'doc-2', 'doc-1']);
  });

  it('拒绝在项目切换后解析旧候选', async () => {
    let currentProjectId: string | null = 'project-1';
    const ports = createPorts(
      [node({ id: 'doc-1', name: 'Roadmap', type: 'document' })],
      { getCurrentProjectId: () => currentProjectId },
    );
    const provider = createWorkspaceDocumentReferenceProvider(ports);
    const [candidate] = await provider.query({ keyword: 'road', limit: 10 });

    currentProjectId = 'project-2';

    expect(() => provider.resolveReference(candidate)).toThrow('候选所属项目已切换');
  });
});
