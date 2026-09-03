/**
 * @file WorkspaceProjectsStore.ts
 * @description 项目列表管理 Store
 * 
 * 职责：
 * - 管理项目列表（加载、创建、更新）
 * - 管理当前活动项目 ID
 * - 处理加载状态和错误信息
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import type { WorkspaceProjectDTO } from '../../../shared/ipc/workspaceGateway';
import { workspaceGateway } from '../../../shared/ipc/workspaceGateway';
import { useWorkspaceScopeStore } from '../../../shared/stores/workspaceScopeStore';
import type { Project } from '../definitions/project';
import { resolveCurrentWorkspaceMessage } from '../functions/resolveCurrentWorkspaceMessage';
import { WorkspaceOperationError } from '../definitions/workspaceOperationError';

function toProject(dto: WorkspaceProjectDTO): Project {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    icon: dto.icon,
    systemRole: dto.system_role,
    canDelete: dto.can_delete,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export const useWorkspaceProjectsStore = defineStore('workspace-projects', () => {
  // ==========================================================================
  // State
  // ==========================================================================

  /** 项目列表 */
  const projects: Ref<Project[]> = ref([]);

  /** 当前活动项目 ID */
  const activeProjectId: Ref<string | null> = ref(null);

  /** 加载状态 */
  const isLoading: Ref<boolean> = ref(false);

  /** 错误信息 */
  const error: Ref<string | null> = ref(null);
  const workspaceScopeStore = useWorkspaceScopeStore();

  // ==========================================================================
  // Computed
  // ==========================================================================

  /** 当前活动项目对象 */
  const activeProject: ComputedRef<Project | null> = computed(() => {
    if (!activeProjectId.value) return null;
    return projects.value.find(p => p.id === activeProjectId.value) || null;
  });

  // ==========================================================================
  // Actions
  // ==========================================================================

  /**
   * 加载所有项目列表，如果为空则自动创建默认项目
   */
  async function loadProjects(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const result = await workspaceGateway['list-projects']();
      if (result.success) {
        projects.value = result.data.projects.map(toProject);

        // 如果没有任何项目，自动创建默认项目
        if (projects.value.length === 0) {
          console.log('[WorkspaceProjectsStore] 没有项目，创建默认项目...');
          await createDefaultProject();
          // 重新加载项目列表
          const reloadResult = await workspaceGateway['list-projects']();
          if (reloadResult.success) {
            projects.value = reloadResult.data.projects.map(toProject);
          }
        }
      } else {
        throw new WorkspaceOperationError(result);
      }
    } catch (e) {
      console.error('[WorkspaceProjectsStore] Failed to load projects:', e);
      error.value = resolveCurrentWorkspaceMessage('workspace.sidebar.state.error');
      projects.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 确保系统默认项目存在
   */
  async function createDefaultProject(): Promise<string> {
    try {
      const result = await workspaceGateway['ensure-default-project']();
      if (!result.success) {
        throw new WorkspaceOperationError(result);
      }
      console.log('[WorkspaceProjectsStore] 默认项目已就绪:', result.data.projectId);
      return result.data.projectId;
    } catch (error) {
      console.error('[WorkspaceProjectsStore] 创建默认项目失败:', error);
      throw error;
    }
  }

  /**
   * 更新项目信息
   */
  async function updateProject(
    projectId: string,
    updates: { name?: string; description?: string }
  ): Promise<void> {
    try {
      const result = await workspaceGateway['update-project']({
        projectId,
        name: updates.name,
        description: updates.description
      });

      if (result.success) {
        // 更新本地项目列表
        const project = projects.value.find(p => p.id === projectId);
        if (project) {
          if (updates.name !== undefined) {
            project.name = updates.name;
          }
          if (updates.description !== undefined) {
            project.description = updates.description;
          }
        }
      } else {
        throw new WorkspaceOperationError(result);
      }
    } catch (e) {
      console.error(`[WorkspaceProjectsStore] Failed to update project ${projectId}:`, e);
      throw e;
    }
  }

  /**
   * 删除普通项目（后端会永久删除，并拒绝删除系统默认项目）
   */
  async function deleteProject(projectId: string): Promise<void> {
    try {
      const result = await workspaceGateway['delete-project']({ projectId });
      
      if (result.success) {
        // 从本地列表中移除
        projects.value = projects.value.filter(p => p.id !== projectId);
        
        // 如果删除的是当前活动项目，返回项目列表视图
        if (activeProjectId.value === projectId) {
          showProjectList();
        }
      } else {
        throw new WorkspaceOperationError(result);
      }
    } catch (e) {
      console.error(`[WorkspaceProjectsStore] Failed to delete project ${projectId}:`, e);
      throw e;
    }
  }

  /**
   * 设置当前活动项目
   */
  function setActiveProject(projectId: string): void {
    markActiveProject(projectId);
    workspaceScopeStore.enterProject(projectId);
  }

  /**
   * 仅更新项目列表领域的当前项目投影。
   *
   * 中文说明：
   * - 当前 workspace scope 的权威来源是 workspaceScopeStore；
   * - 这里保留 activeProjectId 只是为了项目列表、文件树等 workspace UI 快速读取，
   *   禁止反向当作全局 scope 使用。
   */
  function markActiveProject(projectId: string): void {
    activeProjectId.value = projectId;
  }

  /**
   * 切换回项目列表视图
   */
  function showProjectList(): void {
    clearActiveProject();
    workspaceScopeStore.enterLinnyaAssistant();
  }

  function clearActiveProject(): void {
    activeProjectId.value = null;
  }

  return {
    // State
    projects,
    activeProjectId,
    isLoading,
    error,

    // Computed
    activeProject,

    // Actions
    loadProjects,
    updateProject,
    deleteProject,
    setActiveProject,
    markActiveProject,
    showProjectList,
    clearActiveProject,
  };
});
