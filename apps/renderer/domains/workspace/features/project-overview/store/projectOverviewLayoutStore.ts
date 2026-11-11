import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import type { ProjectOverviewColumnId, ProjectOverviewLayout } from '../definitions/projectOverview';
import {
  moveProjectOverviewColumn,
  normalizeProjectOverviewLayout,
  resizeProjectOverviewColumn,
  resizeProjectOverviewName,
  toggleProjectOverviewColumn,
} from '../functions/projectOverviewLayout';

/**
 * 文件页表格的列配置。所有项目、所有保存的筛选共用一份，保存在本机界面偏好里。
 */
export const useProjectOverviewLayoutStore = defineStore('workspace-project-overview-layout', () => {
  // Pinia hydrate 会合并普通对象，不能把冻结的默认常量放进可写 state。
  // null 表示尚未保存偏好，默认值仅通过只读派生结果提供。
  const savedLayout = ref<unknown>(null);
  const layout = computed<ProjectOverviewLayout>(() => normalizeProjectOverviewLayout(savedLayout.value));

  function toggleColumn(id: ProjectOverviewColumnId): void {
    savedLayout.value = toggleProjectOverviewColumn(layout.value, id);
  }

  function moveColumn(id: ProjectOverviewColumnId, targetId: ProjectOverviewColumnId): void {
    savedLayout.value = moveProjectOverviewColumn(layout.value, id, targetId);
  }

  function resizeColumn(id: ProjectOverviewColumnId, width: number): void {
    savedLayout.value = resizeProjectOverviewColumn(layout.value, id, width);
  }

  function resizeName(width: number): void {
    savedLayout.value = resizeProjectOverviewName(layout.value, width);
  }

  function reset(): void {
    savedLayout.value = null;
  }

  return { savedLayout, layout, toggleColumn, moveColumn, resizeColumn, resizeName, reset };
}, {
  persist: {
    key: 'project-overview-layout',
    storage: getRendererPersistStorage(),
    pick: ['savedLayout'],
  },
});
