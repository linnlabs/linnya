/**
 * @file WorkspaceProjectsStore.ts
 * @description 项目列表管理 Store
 *
 * 职责：
 * - 同步保存项目列表与已接纳的项目更新
 * - 管理当前活动项目 ID
 * - 保存加载状态和错误信息；异步加载/默认初始化/更新归 project-catalog 编排
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import type { Project, ProjectUpdate } from '../definitions/project';

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

  function replaceProjects(next: Project[]): void {
    projects.value = next;
  }

  function setProjectsLoading(value: boolean): void {
    isLoading.value = value;
  }
  function setProjectsError(value: string | null): void {
    error.value = value;
  }
  function applyProjectUpdate(projectId: string, updates: ProjectUpdate): void {
    const project = projects.value.find(p => p.id === projectId);
    if (project) {
      if (updates.name !== undefined) {
        project.name = updates.name;
      }
      if (updates.description !== undefined) {
        project.description = updates.description;
      }
    }
  }

  /**
   * 仅更新项目列表领域的当前项目投影。
   *
   * 中文说明：
   * - 当前导航上下文的权威来源是 navigationScope；
   * - 这里保留 activeProjectId 只是为了项目列表、文件树等 workspace UI 快速读取，
   *   禁止反向当作全局 scope 使用。
   */
  function markActiveProject(projectId: string): void {
    activeProjectId.value = projectId;
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
    setProjectsLoading,
    setProjectsError,
    replaceProjects,
    applyProjectUpdate,
    markActiveProject,
    clearActiveProject,
  };
});
