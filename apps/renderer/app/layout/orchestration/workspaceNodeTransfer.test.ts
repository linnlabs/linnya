import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeTransferResult } from '@app/schemas';
import {
  createWorkspaceNodeTransfer,
  handleWorkspaceNodeTransferredMutation,
} from './workspaceNodeTransfer';

const mocks = vi.hoisted(() => ({
  currentProjectId: 'project-1',
  activeDocument: null as { id: string; projectId: string; type: string } | null,
  projectTree: [{ id: 'node-before' }],
  inspect: vi.fn(),
  transfer: vi.fn(),
  requestSave: vi.fn(async () => true),
  deactivateIfActiveDocument: vi.fn(async () => undefined),
  reloadActiveProjectTree: vi.fn(async () => undefined),
  flattenLoadedWorkspaceTree: vi.fn(() => [{
    id: 'doc-1',
    type: 'document',
    projectId: 'project-1',
    parentId: null,
    name: 'doc-1',
  }]),
  reconcilePageSelectionAfterRemoval: vi.fn(async () => undefined),
  refreshRemovedNodeParent: vi.fn(async () => undefined),
}));

vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'inspect-node-transfer': mocks.inspect,
    'transfer-node': mocks.transfer,
  },
}));

vi.mock('@/app/layout/store/layoutStore', () => ({
  useLayoutStore: () => ({ state: { activeDocument: mocks.activeDocument } }),
}));

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({ currentProjectId: mocks.currentProjectId }),
}));

vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({
  useWorkspaceTreeStore: () => ({
    projectTree: mocks.projectTree,
    reloadActiveProjectTree: mocks.reloadActiveProjectTree,
  }),
}));

vi.mock('@/domains/workspace/services/file-manager', () => ({
  requestSave: mocks.requestSave,
  deactivateIfActiveDocument: mocks.deactivateIfActiveDocument,
}));

vi.mock('@/domains/workspace/functions/resolveCurrentWorkspaceMessage', () => ({
  resolveCurrentWorkspaceMessage: () => 'save failed',
}));

vi.mock('./workspaceNodeRemoval', () => ({
  flattenLoadedWorkspaceTree: mocks.flattenLoadedWorkspaceTree,
  reconcilePageSelectionAfterRemoval: mocks.reconcilePageSelectionAfterRemoval,
  refreshRemovedNodeParent: mocks.refreshRemovedNodeParent,
}));

function result(overrides: Partial<WorkspaceNodeTransferResult> = {}): WorkspaceNodeTransferResult {
  return {
    nodeId: 'folder-1',
    nodeType: 'folder',
    nodeName: '资料',
    sourceProjectId: 'project-1',
    sourceParentId: null,
    targetProjectId: 'project-2',
    targetParentId: null,
    movedNodeIds: ['folder-1', 'doc-1'],
    ...overrides,
  };
}

describe('workspaceNodeTransfer', () => {
  beforeEach(() => {
    mocks.currentProjectId = 'project-1';
    mocks.activeDocument = null;
    mocks.inspect.mockReset();
    mocks.transfer.mockReset();
    mocks.requestSave.mockReset();
    mocks.requestSave.mockResolvedValue(true);
    mocks.deactivateIfActiveDocument.mockClear();
    mocks.reloadActiveProjectTree.mockClear();
    mocks.flattenLoadedWorkspaceTree.mockClear();
    mocks.reconcilePageSelectionAfterRemoval.mockClear();
    mocks.refreshRemovedNodeParent.mockClear();
  });

  it('先保存子树中的活动文档，再执行转移并修正来源项目页面', async () => {
    const transferResult = result();
    mocks.activeDocument = { id: 'doc-1', projectId: 'project-1', type: 'editor' };
    mocks.inspect.mockResolvedValue({ success: true, data: transferResult });
    mocks.transfer.mockResolvedValue({ success: true, data: transferResult });

    await createWorkspaceNodeTransfer().transferNode({
      nodeId: 'folder-1',
      targetProjectId: 'project-2',
    });

    expect(mocks.requestSave).toHaveBeenCalledWith('view-switch');
    expect(mocks.transfer).toHaveBeenCalledTimes(1);
    expect(mocks.deactivateIfActiveDocument).toHaveBeenCalledWith('doc-1');
    expect(mocks.refreshRemovedNodeParent).toHaveBeenCalledWith(null);
    expect(mocks.reconcilePageSelectionAfterRemoval).toHaveBeenCalledWith(expect.objectContaining({
      activeDocumentId: 'doc-1',
      projectId: 'project-1',
    }));
  });

  it('保存失败时不调用 transfer，数据库保持不变', async () => {
    const transferResult = result({ nodeId: 'folder-save-fails' });
    mocks.activeDocument = { id: 'doc-1', projectId: 'project-1', type: 'editor' };
    mocks.inspect.mockResolvedValue({ success: true, data: transferResult });
    mocks.requestSave.mockResolvedValue(false);

    await expect(createWorkspaceNodeTransfer().transferNode({
      nodeId: 'folder-save-fails',
      targetProjectId: 'project-2',
    })).rejects.toThrow('save failed');
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  it('其他窗口在目标项目时刷新目标根目录', async () => {
    mocks.currentProjectId = 'project-2';
    await handleWorkspaceNodeTransferredMutation({
      type: 'workspace.node.transferred',
      mutationId: 'external-transfer-target',
      nodeId: 'external-folder',
      nodeType: 'folder',
      name: '资料',
      sourceProjectId: 'project-1',
      sourceParentId: null,
      targetProjectId: 'project-2',
      targetParentId: null,
      movedNodeIds: ['external-folder'],
    });

    expect(mocks.reloadActiveProjectTree).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePageSelectionAfterRemoval).not.toHaveBeenCalled();
  });
});
