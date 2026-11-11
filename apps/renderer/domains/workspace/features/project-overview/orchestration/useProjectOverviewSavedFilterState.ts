import { computed, ref, watch, type Ref } from 'vue';
import type { ProjectSavedFilter } from '@app/schemas';
import type { ProjectOverviewFilters, ProjectOverviewSort, ProjectOverviewView } from '../definitions/projectOverview';
import {
  ALL_FILES_FILTER_ID,
  allFilesView,
  fileViewFromSavedFilter,
  findSameConditions,
  isSavedFilterChanged,
  savedFilterDefinitionFrom,
  type ProjectOverviewFileView,
} from '../functions/projectSavedFilters';
import { useProjectSavedFilters } from './useProjectSavedFilters';

export interface ProjectSaveDialog {
  readonly mode: 'create' | 'rename';
  readonly anchor: HTMLElement;
  readonly initialName: string;
  /** 新建时条件与已有的一项相同。 */
  readonly duplicate: ProjectSavedFilter | null;
  /** 重命名的那一项。 */
  readonly targetId: string | null;
}

/**
 * 文件页“正在看哪一项保存的筛选”与它是否被改动。
 * 选中一项就把它的条件、排序和布局套到界面上；与所选那项不同时出现“保存筛选”（全部文件）或“已改动”。
 */
export function useProjectOverviewSavedFilterState(input: {
  readonly projectId: Readonly<Ref<string | null>>;
  readonly filters: Ref<ProjectOverviewFilters>;
  readonly sort: Ref<ProjectOverviewSort>;
  readonly view: Ref<ProjectOverviewView>;
  readonly reportError: (message: string) => void;
  readonly saveFailedMessage: () => string;
}) {
  const savedFilters = useProjectSavedFilters(input.projectId);
  const activeFilterId = ref<string>(ALL_FILES_FILTER_ID);
  const saveDialog = ref<ProjectSaveDialog | null>(null);

  const current = computed(() => savedFilterDefinitionFrom({
    filters: input.filters.value, sort: input.sort.value, view: input.view.value,
  }));
  const activeFilter = computed(() => (
    activeFilterId.value === ALL_FILES_FILTER_ID ? null : savedFilters.find(activeFilterId.value)
  ));
  const baseline = computed(() => (
    activeFilter.value?.definition ?? savedFilterDefinitionFrom(allFilesView(''))
  ));
  /** none：与所选一致；new：全部文件上加了条件；changed：保存的筛选被改了。 */
  const saveState = computed<'none' | 'new' | 'changed'>(() => {
    if (!isSavedFilterChanged(current.value, baseline.value)) return 'none';
    return activeFilter.value === null ? 'new' : 'changed';
  });

  function apply(state: ProjectOverviewFileView): void {
    input.filters.value = state.filters;
    input.sort.value = state.sort;
    input.view.value = state.view;
  }

  function select(id: string): void {
    saveDialog.value = null;
    const query = input.filters.value.query;
    if (id === ALL_FILES_FILTER_ID) {
      activeFilterId.value = ALL_FILES_FILTER_ID;
      apply(allFilesView(query));
      return;
    }
    const filter = savedFilters.find(id);
    if (!filter) return;
    activeFilterId.value = id;
    apply(fileViewFromSavedFilter(filter.definition, query));
    savedFilters.markOpened(id);
  }

  // 所选那项被删掉（或换了项目）时回到全部文件。
  watch(() => savedFilters.filters.value, list => {
    if (activeFilterId.value !== ALL_FILES_FILTER_ID && !list.some(filter => filter.id === activeFilterId.value)) {
      activeFilterId.value = ALL_FILES_FILTER_ID;
    }
  });
  watch(input.projectId, () => {
    activeFilterId.value = ALL_FILES_FILTER_ID;
    saveDialog.value = null;
  });

  function startSave(anchor: HTMLElement, initialName: string): void {
    saveDialog.value = {
      mode: 'create', anchor, initialName, targetId: null,
      duplicate: findSameConditions(savedFilters.filters.value, current.value),
    };
  }

  function startRename(id: string, anchor: HTMLElement): void {
    const filter = savedFilters.find(id);
    if (filter) saveDialog.value = { mode: 'rename', anchor, initialName: filter.name, duplicate: null, targetId: id };
  }

  async function guarded(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error: unknown) {
      console.error('[ProjectOverview] 保存的筛选写入失败:', error);
      input.reportError(input.saveFailedMessage());
    }
  }

  async function submitSaveDialog(name: string): Promise<void> {
    const dialog = saveDialog.value;
    if (!dialog) return;
    saveDialog.value = null;
    await guarded(async () => {
      if (dialog.mode === 'rename' && dialog.targetId) {
        await savedFilters.update(dialog.targetId, { name });
        return;
      }
      const id = await savedFilters.create(name, current.value);
      if (id) activeFilterId.value = id;
    });
  }

  function openDuplicate(): void {
    const duplicate = saveDialog.value?.duplicate;
    saveDialog.value = null;
    if (duplicate) select(duplicate.id);
  }

  async function saveChanges(): Promise<void> {
    const id = activeFilter.value?.id;
    if (id) await guarded(() => savedFilters.update(id, { definition: current.value }));
  }

  async function remove(id: string): Promise<void> {
    await guarded(() => savedFilters.remove(id));
  }

  async function pin(id: string): Promise<void> {
    await guarded(() => savedFilters.update(id, { pinned: true }));
  }

  return {
    savedFilters,
    activeFilterId,
    saveState,
    saveDialog,
    select,
    startSave,
    startRename,
    submitSaveDialog,
    openDuplicate,
    saveChanges,
    remove,
    pin,
  };
}
