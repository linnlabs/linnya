import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@/domains/workspace/definitions/project';
import { useSidebarProjectDelete } from './useSidebarProjectDelete';

// 公共汇总入口还导出会初始化 Electron IPC 的 UI 组件；此流程只装配真实菜单规则。
vi.mock('@/domains/workspace/ui/sidebar', () =>
  import('@/domains/workspace/ui/sidebar/functions/projectMenuModel')
);

describe('前端项目删除确认流程', () => {
  it('默认项目不可发起删除，普通项目取消无副作用，确认后才调用删除入口', async () => {
    const ordinary: Project = {
      id: 'ordinary', name: 'Research', description: null, icon: null,
      systemRole: null, canDelete: true, createdAt: 1, updatedAt: 1,
    };
    const defaultProject: Project = {
      ...ordinary, id: 'default', name: 'Default', systemRole: 'default', canDelete: false,
    };
    const deleteProject = vi.fn<(projectId: string) => Promise<void>>().mockResolvedValue(undefined);
    const deletion = useSidebarProjectDelete({
      getProjects: () => [ordinary, defaultProject],
      deleteProject,
      workspaceMessage: key => key,
    });

    await deletion.handleDeleteProject(defaultProject.id);
    expect(deletion.showDeleteProjectDialog.value).toBe(false);
    expect(deleteProject).not.toHaveBeenCalled();

    await deletion.handleDeleteProject(ordinary.id);
    expect(deletion.showDeleteProjectDialog.value).toBe(true);
    expect(deleteProject).not.toHaveBeenCalled();
    deletion.handleCancelDeleteProject();
    expect(deletion.showDeleteProjectDialog.value).toBe(false);
    await deletion.handleConfirmDeleteProject();
    expect(deleteProject).not.toHaveBeenCalled();

    await deletion.handleDeleteProject(ordinary.id);
    await deletion.handleConfirmDeleteProject();
    expect(deleteProject).toHaveBeenCalledExactlyOnceWith(ordinary.id);
    expect(deletion.showDeleteProjectDialog.value).toBe(false);
  });
});
