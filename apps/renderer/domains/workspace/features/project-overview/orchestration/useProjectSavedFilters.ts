import { computed, shallowRef, watch, type Ref } from 'vue';
import type { ProjectSavedFilter, ProjectSavedFilterDefinition, ProjectSavedFiltersRequest } from '@app/schemas';
import { requestProjectSavedFilters } from '../infrastructure/projectOverviewGateway';

/** 每次请求都换回整份列表；切换项目时丢弃旧项目的迟到结果。 */
export function useProjectSavedFilters(projectId: Readonly<Ref<string | null>>) {
  const filters = shallowRef<readonly ProjectSavedFilter[]>([]);
  let generation = 0;

  async function send(request: ProjectSavedFiltersRequest): Promise<string | null> {
    const current = generation;
    const result = await requestProjectSavedFilters(request);
    if (current === generation) filters.value = result.filters;
    return result.saved_id;
  }

  watch(projectId, target => {
    generation += 1;
    filters.value = [];
    if (!target) return;
    send({ action: 'list', project_id: target }).catch((error: unknown) => {
      console.error('[ProjectOverview] 读取保存的筛选失败:', error);
    });
  }, { immediate: true });

  const pinned = computed(() => filters.value.filter(filter => filter.pinned));
  const suggestions = computed(() => filters.value.filter(filter => !filter.pinned));

  function requireProject(): string {
    if (!projectId.value) throw new Error('没有当前项目');
    return projectId.value;
  }

  return {
    filters,
    pinned,
    suggestions,
    find: (id: string) => filters.value.find(filter => filter.id === id) ?? null,
    /** 标签或字段改动会改写保存的筛选，之后重读整份列表。 */
    async reload(): Promise<void> {
      await send({ action: 'list', project_id: requireProject() });
    },
    async create(name: string, definition: ProjectSavedFilterDefinition): Promise<string | null> {
      return send({ action: 'create', project_id: requireProject(), name, definition });
    },
    async update(id: string, patch: { name?: string; definition?: ProjectSavedFilterDefinition; pinned?: boolean }): Promise<void> {
      await send({ action: 'update', project_id: requireProject(), id, ...patch });
    },
    async remove(id: string): Promise<void> {
      await send({ action: 'delete', project_id: requireProject(), id });
    },
    /** 记下打开时间（Agent 建议按它判断 30 天没用），失败不打扰用户。 */
    markOpened(id: string): void {
      send({ action: 'open', project_id: requireProject(), id }).catch((error: unknown) => {
        console.warn('[ProjectOverview] 记录筛选打开时间失败:', error);
      });
    },
  };
}
