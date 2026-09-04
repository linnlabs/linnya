import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '@/shared/stores/workspaceScopeStore';

const mocks = vi.hoisted(() => ({
  currentScope: { kind: 'project', projectId: 'project-old' } as WorkspaceScope,
  calls: [] as string[],
  openWorkspace: vi.fn(),
  markActiveProject: vi.fn(),
  startDraftConversation: vi.fn(),
  ensureProjectTreeLoaded: vi.fn(),
}));

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  areWorkspaceScopesEqual: (left: WorkspaceScope, right: WorkspaceScope) => (
    left.kind === right.kind
    && (left.kind !== 'project' || right.kind !== 'project' || left.projectId === right.projectId)
  ),
  useWorkspaceScopeStore: () => ({
    get currentScope(): WorkspaceScope {
      return mocks.currentScope;
    },
  }),
}));

vi.mock('@/shared/ports/workspaceNavigationPort', () => ({
  getWorkspaceNavigationPort: () => ({
    openWorkspace: mocks.openWorkspace,
  }),
}));

vi.mock('@/domains/workspace/store/WorkspaceProjectsStore', () => ({
  useWorkspaceProjectsStore: () => ({
    markActiveProject: mocks.markActiveProject,
  }),
}));

vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({
  useWorkspaceTreeStore: () => ({
    ensureProjectTreeLoaded: mocks.ensureProjectTreeLoaded,
  }),
}));

vi.mock('@/domains/conversation/services/orchestration/startDraftConversation', () => ({
  startDraftConversation: mocks.startDraftConversation,
}));

import { openProjectWorkspaceFromSidebar } from './openProjectWorkspaceFromSidebar';

describe('openProjectWorkspaceFromSidebar', () => {
  beforeEach(() => {
    mocks.currentScope = { kind: 'project', projectId: 'project-old' };
    mocks.calls = [];
    mocks.openWorkspace.mockReset().mockImplementation(async (scope: WorkspaceScope) => {
      const sourceScope = mocks.currentScope.kind === 'project'
        ? mocks.currentScope.projectId
        : 'assistant';
      mocks.calls.push(`navigate-from:${sourceScope}`);
      mocks.currentScope = scope;
    });
    mocks.markActiveProject.mockReset().mockImplementation((projectId: string) => {
      mocks.calls.push(`mark:${projectId}`);
    });
    mocks.startDraftConversation.mockReset().mockImplementation(() => {
      mocks.calls.push('draft');
    });
    mocks.ensureProjectTreeLoaded.mockReset().mockImplementation(async (projectId: string) => {
      mocks.calls.push(`tree:${projectId}`);
    });
  });

  it('跨项目时先由统一导航关闭旧项目文档，再提交项目投影和草稿', async () => {
    await openProjectWorkspaceFromSidebar('project-new');

    expect(mocks.openWorkspace).toHaveBeenCalledWith({ kind: 'project', projectId: 'project-new' });
    expect(mocks.calls).toEqual([
      'navigate-from:project-old',
      'mark:project-new',
      'draft',
      'tree:project-new',
    ]);
  });

  it('重复进入当前项目时保留当前文档或对话，不创建新草稿', async () => {
    mocks.currentScope = { kind: 'project', projectId: 'project-current' };

    await openProjectWorkspaceFromSidebar('project-current');

    expect(mocks.openWorkspace).toHaveBeenCalledWith({ kind: 'project', projectId: 'project-current' });
    expect(mocks.startDraftConversation).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual([
      'navigate-from:project-current',
      'mark:project-current',
      'tree:project-current',
    ]);
  });

  it('旧文档保存失败时不提前切换项目状态', async () => {
    mocks.openWorkspace.mockRejectedValueOnce(new Error('save failed'));

    await expect(openProjectWorkspaceFromSidebar('project-new')).rejects.toThrow('save failed');

    expect(mocks.currentScope).toEqual({ kind: 'project', projectId: 'project-old' });
    expect(mocks.markActiveProject).not.toHaveBeenCalled();
    expect(mocks.startDraftConversation).not.toHaveBeenCalled();
    expect(mocks.ensureProjectTreeLoaded).not.toHaveBeenCalled();
  });
});
