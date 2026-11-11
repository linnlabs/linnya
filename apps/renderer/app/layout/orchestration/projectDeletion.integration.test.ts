// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigationScope } from '@/app/navigation';
import { useNavigationScope } from '@/app/navigation';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { projectGateway } from '@/shared/ipc/projectGateway';
import { useLayoutStore } from '../store/layoutStore';
import { useSidebarConversationHistoryRevealStore } from '../store/sidebarConversationHistoryRevealStore';
import { deleteProjectFromSidebar, handleProjectDeleted } from './projectDeletion';

const mocks = vi.hoisted(() => ({
  loadedProjectId: null as string | null,
  clearTree: vi.fn(),
  openWorkspace: vi.fn<(scope: NavigationScope) => Promise<void>>(),
  deactivate: vi.fn<(documentId: string) => Promise<void>>(),
  assistant: {
    setSelectedConversation: vi.fn(),
    clearActiveConversation: vi.fn(),
    clearError: vi.fn(),
  },
}));
vi.mock('@/shared/ipc/projectGateway', () => ({
  projectGateway: { list: vi.fn(), ensureDefault: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/domains/workspace/services/file-manager', () => ({
  deactivateIfActiveDocument: mocks.deactivate,
}));
vi.mock('@/domains/conversation/store/assistantStore', () => ({
  useAssistantStore: () => mocks.assistant,
}));
vi.mock('@/shared/ports/workspaceNavigationPort', () => ({
  getWorkspaceNavigationPort: () => ({ openWorkspace: mocks.openWorkspace }),
}));
vi.mock('@/domains/workspace/tree', () => ({
  useWorkspaceTree: () => ({
    get loadedProjectId() {
      return mocks.loadedProjectId;
    },
    clearTree: mocks.clearTree,
  }),
}));

describe('Project deletion navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.loadedProjectId = 'selected';
    mocks.openWorkspace.mockImplementation(async scope => {
      useNavigationScope().enterScope(scope);
      useLayoutStore().openChatWorkspace();
    });
    vi.mocked(projectGateway.list).mockResolvedValue({ success: true, data: { projects: [] } });
    vi.mocked(projectGateway.delete).mockResolvedValue({ success: true });
  });
  it('侧栏删除成功后先停用已删除文档，再退出项目并清除历史展开意图', async () => {
    const navigation = useNavigationScope();
    navigation.enterProject('selected');
    useWorkspaceProjectsStore().markActiveProject('selected');
    const layout = useLayoutStore();
    layout.setSidebarNav('project');
    layout.openDocumentInRightPane({ id: 'document', projectId: 'selected', type: 'document' });
    const reveal = useSidebarConversationHistoryRevealStore();
    reveal.requestReveal({ kind: 'linnya-assistant' });
    mocks.deactivate.mockImplementationOnce(async () => {
      expect(projectGateway.delete).toHaveBeenCalledWith('selected');
      expect(mocks.openWorkspace).not.toHaveBeenCalled();
      expect(navigation.currentProjectId).toBe('selected');
    });

    await deleteProjectFromSidebar('selected');

    expect(mocks.deactivate).toHaveBeenCalledWith('document');
    expect(layout.state.activeDocument).toBeNull();
    expect(layout.state.sidebarNav).toBe('list');
    expect(navigation.currentDraft?.scope).toEqual({ kind: 'linnya-assistant' });
    expect(mocks.assistant.clearActiveConversation).toHaveBeenCalledOnce();
    expect(reveal.latestRequest).toBeNull();
  });

  it('删除失败时保留原项目、文档与草稿，不提前清理界面', async () => {
    const navigation = useNavigationScope();
    navigation.startDraft({ kind: 'project', projectId: 'selected' });
    const draft = navigation.currentDraft;
    useWorkspaceProjectsStore().markActiveProject('selected');
    const layout = useLayoutStore();
    layout.openDocumentInRightPane({ id: 'document', projectId: 'selected', type: 'document' });
    vi.mocked(projectGateway.delete).mockResolvedValueOnce({ success: false, error: 'delete failed' });

    await expect(deleteProjectFromSidebar('selected')).rejects.toThrow('delete failed');

    expect(navigation.currentDraft).toEqual(draft);
    expect(navigation.currentProjectId).toBe('selected');
    expect(layout.state.activeDocument?.id).toBe('document');
    expect(projectGateway.list).not.toHaveBeenCalled();
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(mocks.openWorkspace).not.toHaveBeenCalled();
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
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(mocks.assistant.clearActiveConversation).not.toHaveBeenCalled();
    expect(mocks.clearTree).not.toHaveBeenCalled();
  });
});
