// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNavigationScope } from '@/app/navigation';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceTree } from '@/domains/workspace/tree';
import { useProjectOperations } from '@/domains/workspace/ui/sidebar/composables/useProjectOperations';
import { registerWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { createWorkspaceNavigation } from './workspaceNavigation';
import { openProjectWorkspaceFromSidebar } from './openProjectWorkspaceFromSidebar';
import { startProjectPlanningConversation } from './startProjectPlanningConversation';

const io = vi.hoisted(() => ({
  save: vi.fn<() => Promise<void>>(),
  listNodes: vi.fn(),
  send: vi.fn(async () => true),
  draft: vi.fn(),
}));

vi.mock('@/shared/ipc/projectGateway', () => ({ projectGateway: {
  create: async () => ({ success: true, data: { projectId: 'new-project' } }),
  list: async () => ({ success: true, data: { projects: [{
    id: 'new-project', name: 'New project', description: null, icon: null,
    system_role: null, can_delete: true, created_at: 1, updated_at: 1,
  }] } }),
} }));
vi.mock('@/shared/ipc/projectKbLinksGateway', () => ({ projectKbLinksGateway: {
  replaceProjectKnowledgeBaseLinks: async () => ({ success: true }),
} }));
vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: {
  'list-vfs-nodes': io.listNodes,
} }));
vi.mock('@/domains/workspace/services/file-manager', () => ({
  saveDeactivateThen: async (action: () => Promise<void>) => { await io.save(); await action(); },
  getActiveFileSession: () => null,
}));
vi.mock('@/domains/conversation/services/orchestration/startDraftConversation', () => ({
  startDraftConversation: io.draft,
}));

describe('project creation navigation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
    registerWorkspaceNavigationPort(createWorkspaceNavigation());
    useNavigationScope().enterProject('old-project');
    useWorkspaceProjectsStore().markActiveProject('old-project');
    useLayoutStore().setSidebarNav('project');
    useLayoutStore().setSidebarMode('files');
    useLayoutStore().openDocumentInRightPane({ id: 'old-document', projectId: 'old-project', type: 'document' });
    io.listNodes.mockResolvedValueOnce({ success: true, data: [{
      id: 'old-document', name: 'Old document', type: 'document', projectId: 'old-project', parentId: null,
    }] }).mockResolvedValue({ success: true, data: [] });
    await useWorkspaceTree().loadProjectTree('old-project');
    io.save.mockImplementation(async () => {
      // 保存时必须仍是旧项目；提前改 scope 会让导航误判成重复进入。
      expect(useNavigationScope().currentProjectId).toBe('old-project');
      expect(useLayoutStore().state.activeDocument?.id).toBe('old-document');
    });
  });

  function operations() {
    return useProjectOperations(useWorkspaceProjectsStore(), { show: vi.fn() }, {
      openProjectWorkspace: openProjectWorkspaceFromSidebar,
      deleteProject: vi.fn(),
      startProjectPlanning: (project: { id: string; name: string; description: string }) => (
        startProjectPlanningConversation({
          project,
          openProjectWorkspace: (projectId) => openProjectWorkspaceFromSidebar(projectId, { startNewConversation: true }),
          chooseAgent: async () => undefined,
          send: io.send,
          resolveInitialMessage: () => 'Plan this project',
        })
      ),
    });
  }

  it.each(['manual', 'ai'] as const)('%s creation closes the old document before entering the new empty project', async (mode) => {
    const entry = operations();
    const input = { name: 'New project', description: '', kbIds: [] };
    await (mode === 'ai' ? entry.handleAiCreateProject(input) : entry.handleProjectDialogConfirm(input));

    expect(io.save).toHaveBeenCalledOnce();
    expect(useNavigationScope().currentProjectId).toBe('new-project');
    expect(useWorkspaceProjectsStore().activeProjectId).toBe('new-project');
    expect(useLayoutStore().state.activeDocument).toBeNull();
    expect(useLayoutStore().state.documentPane.visible).toBe(false);
    expect(useWorkspaceTree().loadedProjectId).toBe('new-project');
    expect(useWorkspaceTree().projectTree).toEqual([]);
    expect(io.draft).toHaveBeenCalledOnce();
    expect(io.send).toHaveBeenCalledTimes(mode === 'ai' ? 1 : 0);
  });

  it.each(['manual', 'ai'] as const)('%s creation preserves the old document and scope when saving fails', async (mode) => {
    io.save.mockRejectedValueOnce(new Error('save failed'));
    const entry = operations();
    const input = { name: 'New project', description: '', kbIds: [] };
    await (mode === 'ai' ? entry.handleAiCreateProject(input) : entry.handleProjectDialogConfirm(input));

    expect(useNavigationScope().currentProjectId).toBe('old-project');
    expect(useWorkspaceProjectsStore().activeProjectId).toBe('old-project');
    expect(useLayoutStore().state.activeDocument?.id).toBe('old-document');
    expect(useWorkspaceTree().loadedProjectId).toBe('old-project');
    expect(io.send).not.toHaveBeenCalled();
  });
});
