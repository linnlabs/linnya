import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigationScope } from '@/app/navigation';
import { useNavigationScope } from '@/app/navigation';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { projectGateway } from '@/shared/ipc/projectGateway';
import { handleProjectDeleted } from './projectDeletion';

const mocks = vi.hoisted(() => ({
  loadedProjectId: null as string | null,
  clearTree: vi.fn(),
  openWorkspace: vi.fn<(scope: NavigationScope) => Promise<void>>(),
}));
vi.mock('@/shared/ipc/projectGateway', () => ({
  projectGateway: { list: vi.fn(), ensureDefault: vi.fn() },
}));
vi.mock('@/shared/ports/workspaceNavigationPort', () => ({
  getWorkspaceNavigationPort: () => ({ openWorkspace: mocks.openWorkspace }),
}));
vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({
  useWorkspaceTreeStore: () => ({
    get loadedProjectId() {
      return mocks.loadedProjectId;
    },
    clearTree: mocks.clearTree,
  }),
}));

describe('External empty project deletion', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.loadedProjectId = 'selected';
    mocks.openWorkspace.mockImplementation(async scope => {
      useNavigationScope().enterScope(scope);
    });
    vi.mocked(projectGateway.list).mockResolvedValue({ success: true, data: { projects: [] } });
  });
  it('删除当前项目后退出失效导航、清空项目树，最后一个项目删除不会重建默认项目', async () => {
    const navigation = useNavigationScope();
    navigation.startDraft({ kind: 'project', projectId: 'selected' });
    navigation.rememberLastActiveConversation(navigation.currentScope, 'old');
    const projects = useWorkspaceProjectsStore();
    projects.markActiveProject('selected');
    await handleProjectDeleted('selected');
    expect(navigation.currentScope).toEqual({ kind: 'linnya-assistant' });
    expect(navigation.currentDraft?.scope).toEqual({ kind: 'linnya-assistant' });
    expect(
      navigation.getLastActiveConversation({ kind: 'project', projectId: 'selected' })
    ).toBeNull();
    expect(projects.activeProjectId).toBeNull();
    expect(projects.projects).toEqual([]);
    expect(mocks.clearTree).toHaveBeenCalledOnce();
    expect(projectGateway.ensureDefault).not.toHaveBeenCalled();
  });
  it('删除另一项目只更新列表，保留当前导航、草稿和文件树', async () => {
    const navigation = useNavigationScope();
    navigation.startDraft({ kind: 'project', projectId: 'selected' });
    const draft = navigation.currentDraft;
    const projects = useWorkspaceProjectsStore();
    projects.markActiveProject('selected');
    await handleProjectDeleted('other');
    expect(navigation.currentProjectId).toBe('selected');
    expect(navigation.currentDraft).toEqual(draft);
    expect(projects.activeProjectId).toBe('selected');
    expect(mocks.openWorkspace).not.toHaveBeenCalled();
    expect(mocks.clearTree).not.toHaveBeenCalled();
  });
});
