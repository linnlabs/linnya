import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import type { ProjectOverviewColumnId, ProjectOverviewLayout } from '../definitions/projectOverview';
import {
  moveProjectOverviewColumn,
  normalizeProjectOverviewLayout,
  resizeProjectOverviewColumn,
  toggleProjectOverviewColumn,
} from '../functions/projectOverviewLayout';

/**
 * “全部文件”的列配置。所有项目共用一份，保存在本机界面偏好里；以后保存面板时，
 * 同一格式随面板定义存进项目。
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

  function reset(): void {
    savedLayout.value = null;
  }

  return { savedLayout, layout, toggleColumn, moveColumn, resizeColumn, reset };
}, {
  persist: {
    key: 'project-overview-layout',
    storage: getRendererPersistStorage(),
    pick: ['savedLayout'],
  },
});
