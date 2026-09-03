import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNode } from '@/domains/workspace/store/WorkspaceTreeStore';
import {
  createWorkspaceNodeDeletion,
  handleWorkspaceNodeDeletedMutation,
} from './workspaceNodeDeletion';

const mocks = vi.hoisted(() => ({
  projectTree: [] as WorkspaceNode[],
  activeDocument: null as { id: string; projectId: string; type: string } | null,
  sidebarMode: 'files',
  deleteNode: vi.fn<() => Promise<string[]>>(),
  openDocument: vi.fn(async () => undefined),
  openEmptyProjectFiles: vi.fn(async () => undefined),
  showEmptyProjectFilesAfterRemoval: vi.fn(),
  deactivateIfActiveDocument: vi.fn(async () => undefined),
  selectSingle: vi.fn(),
  clearSelection: vi.fn(),
  getRecentDocuments: vi.fn(),
}));

vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({
  useWorkspaceTreeStore: () => ({
    projectTree: mocks.projectTree,
    deleteNode: mocks.deleteNode,
    findNodeById: vi.fn(() => null),
    reloadActiveProjectTree: vi.fn(async () => undefined),
    loadNodeChildren: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/app/layout/store/layoutStore', () => ({
  useLayoutStore: () => ({
    state: { activeDocument: mocks.activeDocument, sidebarMode: mocks.sidebarMode },
    closeDocument: vi.fn(),
  }),
}));

vi.mock('@/domains/workspace/store/WorkspaceSelectionStore', () => ({
  useWorkspaceSelectionStore: () => ({
    selectSingle: mocks.selectSingle,
    clearSelection: mocks.clearSelection,
  }),
}));

vi.mock('@/domains/workspace/services/file-manager', () => ({
  deactivateIfActiveDocument: mocks.deactivateIfActiveDocument,
}));

vi.mock('@/app/plugins/enabledPluginsStore', () => ({
  useEnabledPluginsStore: () => ({
    enabledPluginIds: new Set(['platform']),
    states: [],
  }),
}));

vi.mock('@/app/plugins/registry', () => ({
  resolveDocumentTypeByNodeType: (nodeType: string) => nodeType === 'document'
    ? {
        state: 'enabled',
        documentType: { activeDocumentType: 'editor' },
      }
    : { state: 'unknown', nodeType },
}));

vi.mock('@/shared/ports/workspaceNavigationPort', () => ({
  getWorkspaceNavigationPort: () => ({
    openDocument: mocks.openDocument,
    openEmptyProjectFiles: mocks.openEmptyProjectFiles,
  }),
}));

vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'get-recent-documents': mocks.getRecentDocuments,
  },
}));

vi.mock('./workspaceNavigation', () => ({
  showEmptyProjectFilesAfterRemoval: mocks.showEmptyProjectFilesAfterRemoval,
}));

function node(id: string, type = 'document'): WorkspaceNode {
  return {
    id,
    name: id,
    type,
    projectId: 'project-1',
    parentId: null,
    children: null,
    isExpanded: false,
    depth: 0,
  };
}

describe('workspaceNodeDeletion', () => {
  beforeEach(() => {
    mocks.projectTree = [];
    mocks.activeDocument = null;
    mocks.sidebarMode = 'files';
    mocks.deleteNode.mockReset();
    mocks.openDocument.mockClear();
    mocks.openEmptyProjectFiles.mockClear();
    mocks.showEmptyProjectFilesAfterRemoval.mockClear();
    mocks.deactivateIfActiveDocument.mockClear();
    mocks.selectSingle.mockClear();
    mocks.clearSelection.mockClear();
    mocks.getRecentDocuments.mockReset();
    mocks.getRecentDocuments.mockResolvedValue({ success: true, data: [] });
  });

  it('删除当前 page 后关闭旧会话并打开上方最近 page', async () => {
    mocks.projectTree = [node('doc-1'), node('image-1', 'asset_image'), node('doc-2')];
    mocks.activeDocument = { id: 'doc-2', projectId: 'project-1', type: 'editor' };
    mocks.deleteNode.mockResolvedValue(['doc-2']);

    const result = await createWorkspaceNodeDeletion().deleteNodes([{
      id: 'doc-2',
      parentId: null,
    }]);

    expect(result.failures).toEqual([]);
    expect(mocks.deactivateIfActiveDocument).toHaveBeenCalledWith('doc-2');
    expect(mocks.openDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'doc-1',
      type: 'editor',
    }));
    expect(mocks.selectSingle).toHaveBeenCalledWith('doc-1');
  });

  it('只剩图片时清空 selection 并展示暂无文件', async () => {
    mocks.projectTree = [node('doc-1'), node('image-1', 'asset_image')];
    mocks.activeDocument = { id: 'doc-1', projectId: 'project-1', type: 'editor' };
    mocks.deleteNode.mockResolvedValue(['doc-1']);

    await createWorkspaceNodeDeletion().deleteNodes([{
      id: 'doc-1',
      parentId: null,
    }]);

    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.clearSelection).toHaveBeenCalled();
    expect(mocks.showEmptyProjectFilesAfterRemoval).toHaveBeenCalledWith('project-1');
  });

  it('删除非当前 page 时保持当前 page，不重启 runtime', async () => {
    mocks.projectTree = [node('doc-1'), node('doc-2')];
    mocks.activeDocument = { id: 'doc-1', projectId: 'project-1', type: 'editor' };
    mocks.deleteNode.mockResolvedValue(['doc-2']);

    await createWorkspaceNodeDeletion().deleteNodes([{
      id: 'doc-2',
      parentId: null,
    }]);

    expect(mocks.deactivateIfActiveDocument).not.toHaveBeenCalled();
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(mocks.selectSingle).toHaveBeenCalledWith('doc-1');
  });

  it('Agent 触发的外部删除也根据 deletedNodeIds 切换 active page', async () => {
    mocks.projectTree = [node('doc-before'), node('doc-external')];
    mocks.activeDocument = { id: 'doc-external', projectId: 'project-1', type: 'editor' };

    await handleWorkspaceNodeDeletedMutation({
      type: 'workspace.node.deleted',
      mutationId: 'external-delete',
      projectId: 'project-1',
      nodeId: 'doc-external',
      nodeType: 'document',
      parentId: null,
      name: 'doc-external',
      deletedNodeIds: ['doc-external'],
    });

    expect(mocks.deactivateIfActiveDocument).toHaveBeenCalledWith('doc-external');
    expect(mocks.openDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'doc-before',
    }));
  });
});
