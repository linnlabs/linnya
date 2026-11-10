<!--
  项目概览：文件、对话两页。文件页是项目里所有文件的一览表：页头、工具条固定，表头吸顶，表体按行虚拟渲染。
  对话页见 ProjectConversationsPanel。数据只读；打开文件、对话、知识库设置和对话的写操作交给页面装配层。
-->
<template>
  <section class="project-overview">
    <header class="project-overview__top">
      <div class="project-overview__head">
        <div class="project-overview__heading">
          <h1 class="project-overview__title" :title="displayProjectName">{{ displayProjectName }}</h1>
          <p class="project-overview__stats">{{ page === 'files' ? statsText : conversationStatsText }}</p>
        </div>
        <button type="button" class="project-overview__knowledge-base" @click="emit('open-knowledge-base')">
          <LibraryIcon />
          <span>{{ workspaceMessage('workspace.projectOverview.knowledgeBase') }}</span>
          <span v-if="knowledgeBaseCount !== null" class="project-overview__knowledge-base-count">
            {{ knowledgeBaseCount }}
          </span>
        </button>
      </div>

      <nav class="project-overview__pages" role="tablist" :aria-label="workspaceMessage('workspace.projectOverview.page.label')">
        <button
          v-for="item in PAGES"
          :key="item.id"
          type="button"
          role="tab"
          class="project-overview__page"
          :class="{ 'is-active': page === item.id }"
          :aria-selected="page === item.id"
          @click="setPage(item.id)"
        >
          {{ workspaceMessage(item.key) }}
          <span v-if="pageCount(item.id) !== null" class="project-overview__page-count">{{ pageCount(item.id) }}</span>
        </button>
      </nav>

      <div v-show="page === 'files'" class="project-overview__toolbar">
        <label class="project-overview__search">
          <SearchIcon class="project-overview__search-icon" />
          <input
            v-model="query"
            type="search"
            class="project-overview__search-input"
            :placeholder="workspaceMessage('workspace.projectOverview.searchPlaceholder')"
            :aria-label="workspaceMessage('workspace.projectOverview.searchPlaceholder')"
          />
        </label>
        <ProjectOverviewFilterMenu
          :label="workspaceMessage('workspace.projectOverview.filter.type')"
          :value-text="typeFilterText"
          :active-text="filterText('workspace.projectOverview.filter.type', typeFilterText)"
          :clear-label="workspaceMessage('workspace.projectOverview.clearFilter')"
          :model-value="filters.nodeType ?? ALL"
          :options="typeOptions"
          @update:model-value="setTypeFilter"
          @clear="setTypeFilter(ALL)"
        />
        <ProjectOverviewFilterMenu
          :label="workspaceMessage('workspace.projectOverview.filter.modified')"
          :value-text="modifiedFilterText"
          :active-text="filterText('workspace.projectOverview.filter.modified', modifiedFilterText)"
          :clear-label="workspaceMessage('workspace.projectOverview.clearFilter')"
          :model-value="filters.modified"
          :options="modifiedOptions"
          @update:model-value="setModifiedFilter"
          @clear="setModifiedFilter('any')"
        />
        <ProjectOverviewFilterMenu
          :label="workspaceMessage('workspace.projectOverview.filter.location')"
          :value-text="locationFilterText"
          :active-text="filterText('workspace.projectOverview.filter.location', locationFilterText)"
          :clear-label="workspaceMessage('workspace.projectOverview.clearFilter')"
          :model-value="filters.location === null ? ALL : locationKey(filters.location)"
          :options="locationOptions"
          @update:model-value="setLocationFilter"
          @clear="setLocationFilter(ALL)"
        />
        <ProjectOverviewFilterMenu
          v-if="tagOptions.length > 0"
          :label="workspaceMessage('workspace.projectOverview.filter.tag')"
          :value-text="tagFilterText"
          :active-text="filterText('workspace.projectOverview.filter.tag', tagFilterText)"
          :clear-label="workspaceMessage('workspace.projectOverview.clearFilter')"
          :model-value="filters.tags[0] ?? ALL"
          :options="tagOptions"
          @update:model-value="setTagFilter"
          @clear="setTagFilter(ALL)"
        />
        <div class="project-overview__spacer" />
        <span v-if="isFiltering && status === 'ready'" class="project-overview__count" aria-live="polite">
          {{ workspaceMessage('workspace.projectOverview.resultCount', { count: sortedRows.length }) }}
        </span>
        <ProjectOverviewColumnsMenu
          :layout="layoutStore.layout"
          @toggle="layoutStore.toggleColumn"
          @move="layoutStore.moveColumn"
          @reset="layoutStore.reset"
        />
      </div>
      <p v-if="page === 'files' && searchFailed" class="project-overview__hint" role="status">
        {{ workspaceMessage('workspace.projectOverview.searchFailed') }}
      </p>
      <p v-if="page === 'files' && searchTruncated" class="project-overview__hint">
        {{ workspaceMessage('workspace.projectOverview.searchTruncated', { count: CONTENT_SEARCH_LIMIT }) }}
      </p>
    </header>

    <div
      v-show="page === 'files'"
      ref="scrollHostRef"
      class="project-overview__scroll-host"
      data-overlay-scroll-theme="linnya"
    >
      <div ref="scrollMountRef" class="project-overview__scroll" data-overlayscrollbars-initialize>
        <div class="project-overview__table" role="table" :style="tableStyle">
          <div class="project-overview__header" role="row">
            <div
              v-for="column in headerColumns"
              :key="column.id"
              class="project-overview__header-cell"
              :class="`project-overview__cell--${column.id}`"
              role="columnheader"
              :aria-sort="ariaSort(column.id)"
            >
              <button
                type="button"
                class="project-overview__sort"
                :class="{ 'is-sorted': sort.key === column.id }"
                @click="toggleSort(column.id)"
              >
                <span>{{ workspaceMessage(projectOverviewColumnMessageKey(column.id)) }}</span>
                <ChevronIcon
                  v-if="sort.key === column.id"
                  class="project-overview__sort-icon"
                  :direction="sort.direction === 'desc' ? 'down' : 'up'"
                />
              </button>
              <span
                class="project-overview__resize"
                role="separator"
                aria-orientation="vertical"
                :aria-label="workspaceMessage('workspace.projectOverview.columns.resize')"
                @pointerdown="startResize($event, column.id)"
                @dblclick="resetColumnWidth(column.id)"
              />
            </div>
          </div>

          <div v-if="status === 'loading'" class="project-overview__state">
            <SkeletonRows :label="workspaceMessage('workspace.projectOverview.loading')" :rows="8" icon />
          </div>
          <p v-else-if="status === 'error'" class="project-overview__state project-overview__state--text">
            {{ workspaceMessage('workspace.projectOverview.loadFailed') }}
          </p>
          <p v-else-if="allRows.length === 0" class="project-overview__state project-overview__state--text">
            {{ workspaceMessage('workspace.projectOverview.empty') }}
          </p>
          <div v-else-if="sortedRows.length === 0" class="project-overview__state project-overview__state--text">
            <span>{{ workspaceMessage('workspace.projectOverview.noMatch') }}</span>
            <button type="button" class="project-overview__clear-all" @click="clearFilters">
              {{ workspaceMessage('workspace.projectOverview.clearFilter') }}
            </button>
          </div>

          <div
            v-else
            ref="bodyRef"
            class="project-overview__body"
            role="rowgroup"
            :style="{ height: `${virtualizer.getTotalSize()}px` }"
          >
            <div
              v-for="item in virtualizer.getVirtualItems()"
              :key="sortedRows[item.index]?.documentId ?? item.index"
              class="project-overview__row"
              :data-document-id="sortedRows[item.index]?.documentId"
              :class="{ 'is-selected': sortedRows[item.index]?.documentId === selectedDocumentId }"
              role="row"
              tabindex="0"
              :aria-selected="sortedRows[item.index]?.documentId === selectedDocumentId"
              :style="{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }"
              @click="selectRow(sortedRows[item.index])"
              @focus="selectRow(sortedRows[item.index])"
              @dblclick="openRow(sortedRows[item.index])"
              @keydown.enter.self="openRow(sortedRows[item.index])"
              @keydown.up.self.prevent="moveSelection(item.index, -1)"
              @keydown.down.self.prevent="moveSelection(item.index, 1)"
            >
              <template v-if="sortedRows[item.index]">
                <div class="project-overview__cell project-overview__cell--name" role="cell">
                  <component
                    :is="presentation.documentType(sortedRows[item.index]!.nodeType).iconComponent"
                    class="project-overview__type-icon"
                    :class="presentation.documentType(sortedRows[item.index]!.nodeType).iconClass"
                  />
                  <button
                    type="button"
                    tabindex="-1"
                    class="project-overview__name"
                    @click.stop="openRow(sortedRows[item.index])"
                    @dblclick.stop
                  >
                    {{ sortedRows[item.index]!.title }}
                  </button>
                </div>
                <div
                  v-for="column in visibleColumns"
                  :key="column.id"
                  class="project-overview__cell"
                  :class="`project-overview__cell--${column.id}`"
                  role="cell"
                >
                  <span
                    v-if="column.id === 'tags'"
                    class="project-overview__tags"
                  >
                    <span
                      v-for="tag in sortedRows[item.index]!.tags"
                      :key="tag.id"
                      class="project-overview__tag"
                    >{{ tag.name }}</span>
                  </span>
                  <template v-else-if="column.id === 'conversation'">
                    <button
                      v-if="sortedRows[item.index]!.conversationId && sortedRows[item.index]!.conversationTitle !== null"
                      type="button"
                      class="project-overview__conversation"
                      :aria-label="`${workspaceMessage('workspace.projectOverview.openConversation')}：${conversationText(sortedRows[item.index]!)}`"
                      @click.stop="emit('open-conversation', sortedRows[item.index]!.conversationId!)"
                    >
                      <span class="project-overview__conversation-text">{{ conversationText(sortedRows[item.index]!) }}</span>
                      <ChatIcon class="project-overview__conversation-icon" />
                    </button>
                  </template>
                  <template v-else-if="column.id === 'modified'">
                    <span v-if="modifiedActorText(sortedRows[item.index]!)" class="project-overview__actor">
                      {{ modifiedActorText(sortedRows[item.index]!) }}
                    </span>
                    <span>{{ timeText(sortedRows[item.index]!.lastModifiedAt) }}</span>
                  </template>
                  <span
                    v-else-if="column.id === 'pending'"
                    class="project-overview__pending"
                  >{{ pendingText(sortedRows[item.index]!) }}</span>
                  <span v-else>
                    {{ cellText(column.id, sortedRows[item.index]!) }}
                  </span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ProjectConversationsPanel
      v-if="conversationsMounted"
      v-show="page === 'conversations'"
      :project-id="projectId"
      :rows="conversationRows"
      :status="conversationStatus"
      :revision="conversationRevision"
      :presentation="presentation"
      :actions="conversationActions"
      :running-conversation-ids="runningConversationIds"
      @open-document="target => emit('open-document', target)"
      @remeasure="remeasureConversation"
    />
  </section>
</template>

<script lang="ts">
const lastPageByProject = new Map<string, 'files' | 'conversations'>();
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { SkeletonRows } from '@linnya/renderer-ui';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { ChatIcon, ChevronIcon, LibraryIcon, SearchIcon } from '@linnya/renderer-ui/icons';
import type { WorkspaceMessageKey } from '@/domains/workspace/definitions/workspaceMessages';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import {
  EMPTY_PROJECT_OVERVIEW_FILTERS,
  type ProjectOverviewColumnId,
  type ProjectOverviewDocumentTarget,
  type ProjectOverviewFilters,
  type ProjectOverviewModifiedRange,
  type ProjectOverviewPresentation,
  type ProjectOverviewRow,
  type ProjectOverviewSort,
  type ProjectOverviewSortKey,
} from '../definitions/projectOverview';
import { DEFAULT_PROJECT_OVERVIEW_LAYOUT, clampColumnWidth, clampNameWidth } from '../functions/projectOverviewLayout';
import {
  defaultProjectOverviewSortDirection,
  formatProjectOverviewActor,
  formatProjectOverviewCharacters,
  formatProjectOverviewTime,
  projectOverviewColumnMessageKey,
} from '../functions/projectOverviewPresentation';
import {
  filterProjectOverviewRows,
  listProjectOverviewLocations,
  listProjectOverviewTags,
  sortProjectOverviewRows,
} from '../functions/projectOverviewRows';
import { useProjectOverviewData } from '../orchestration/useProjectOverviewData';
import {
  PROJECT_OVERVIEW_CONTENT_SEARCH_MAX_MATCHES,
  useProjectOverviewContentSearch,
} from '../orchestration/useProjectOverviewContentSearch';
import { useProjectOverviewLayoutStore } from '../store/projectOverviewLayoutStore';
import type { ProjectConversationActions, ProjectOverviewPage } from '../definitions/projectConversations';
import { projectConversationsTotalBytes } from '../functions/projectConversationRows';
import { useProjectConversationsData } from '../orchestration/useProjectConversationsData';
import { formatStorageBytes } from '@/shared/utils/formatStorageBytes';
import ProjectConversationsPanel from './ProjectConversationsPanel.vue';
import ProjectOverviewColumnsMenu from './ProjectOverviewColumnsMenu.vue';
import ProjectOverviewFilterMenu from './ProjectOverviewFilterMenu.vue';

const props = defineProps<{
  projectId: string;
  projectName: string | null;
  knowledgeBaseCount: number | null;
  presentation: ProjectOverviewPresentation;
  conversationActions: ProjectConversationActions;
  /** 本窗口观察到正在回复的对话。 */
  runningConversationIds: ReadonlySet<string>;
  /** 对话历史（新对话、改名、置顶、删除、新回复）的签名；变化时重读对话列表。 */
  conversationHistoryKey: string;
}>();

const emit = defineEmits<{
  'open-document': [target: ProjectOverviewDocumentTarget];
  'open-conversation': [conversationId: string];
  'open-knowledge-base': [];
}>();

const ALL = '__all__';
const ROW_HEIGHT = 36;
const COLUMN_GAP = 16;
const CONTENT_SEARCH_LIMIT = PROJECT_OVERVIEW_CONTENT_SEARCH_MAX_MATCHES;

const { workspaceMessage, currentLocale } = useWorkspaceLocalization();
const layoutStore = useProjectOverviewLayoutStore();
const projectIdRef = toRef(props, 'projectId');
const { rows, folderCount, characterCount, status, revision } = useProjectOverviewData(projectIdRef);

// 页：每个项目记住上次看的页（本次运行内）。对话页第一次打开时才挂载。
const PAGES: readonly { readonly id: ProjectOverviewPage; readonly key: WorkspaceMessageKey }[] = [
  { id: 'files', key: 'workspace.projectOverview.page.files' },
  { id: 'conversations', key: 'workspace.projectOverview.page.conversations' },
];
const page = ref<ProjectOverviewPage>(lastPageByProject.get(props.projectId) ?? 'files');
const conversationsMounted = ref(page.value === 'conversations');
function setPage(next: ProjectOverviewPage): void {
  page.value = next;
  lastPageByProject.set(props.projectId, next);
  if (next === 'conversations') conversationsMounted.value = true;
}
watch(projectIdRef, projectId => { setPage(lastPageByProject.get(projectId) ?? 'files'); });

const {
  rows: conversationRows,
  status: conversationStatus,
  revision: conversationRevision,
  remeasure: remeasureConversation,
} = useProjectConversationsData(
  projectIdRef,
  toRef(props, 'conversationHistoryKey'),
  computed(() => page.value === 'conversations'),
);
const conversationStatsText = computed(() => {
  if (conversationStatus.value !== 'ready') return '';
  const total = projectConversationsTotalBytes(conversationRows.value);
  return [
    workspaceMessage('workspace.projectOverview.conversations.stats.count', { count: conversationRows.value.length }),
    total === null
      ? workspaceMessage('workspace.projectOverview.conversations.stats.measuring')
      : workspaceMessage('workspace.projectOverview.conversations.stats.storage', { size: formatStorageBytes(total, currentLocale.value) }),
  ].join(' · ');
});
function pageCount(id: ProjectOverviewPage): number | null {
  if (id === 'files') return status.value === 'ready' ? allRows.value.length : null;
  return conversationStatus.value === 'ready' ? conversationRows.value.length : null;
}

const filters = ref<ProjectOverviewFilters>({ ...EMPTY_PROJECT_OVERVIEW_FILTERS });
const sort = ref<ProjectOverviewSort>({ key: 'modified', direction: 'desc' });
const query = computed({
  get: () => filters.value.query,
  set: value => { filters.value = { ...filters.value, query: value }; },
});
const { matches: contentMatches, truncated: searchTruncated, failed: searchFailed } = useProjectOverviewContentSearch(projectIdRef, query, revision);

watch(projectIdRef, () => {
  filters.value = { ...EMPTY_PROJECT_OVERVIEW_FILTERS };
});

// 相对时间（“12 分钟前”）需要随时间走；半分钟刷新一次足够。
const now = shallowRef(new Date());
let clock: ReturnType<typeof setInterval> | null = null;
onMounted(() => { clock = setInterval(() => { now.value = new Date(); }, 30_000); });
onBeforeUnmount(() => { if (clock) clearInterval(clock); });

const displayProjectName = computed(() => (
  props.projectName?.trim() || workspaceMessage('workspace.projectOverview.untitledProject')
));

const allRows = computed(() => [...rows.value.values()]);
const statsText = computed(() => {
  const parts = [workspaceMessage('workspace.projectOverview.stats.documents', { count: allRows.value.length })];
  if (folderCount.value !== null) {
    parts.push(workspaceMessage('workspace.projectOverview.stats.folders', { count: folderCount.value }));
  }
  if (characterCount.value !== null) {
    parts.push(workspaceMessage('workspace.projectOverview.stats.characters', {
      count: formatProjectOverviewCharacters(characterCount.value, currentLocale.value),
    }));
  }
  return status.value === 'ready' ? parts.join(' · ') : '';
});

const isFiltering = computed(() => (
  filters.value.nodeType !== null
  || filters.value.modified !== 'any'
  || filters.value.location !== null
  || filters.value.tags.length > 0
  || filters.value.query.trim().length > 0
));
const typeLabel = (nodeType: string): string => props.presentation.documentType(nodeType).label;
const sortedRows = computed(() => {
  const filtered = filterProjectOverviewRows(allRows.value, filters.value, {
    now: now.value,
    contentMatches: contentMatches.value,
  });
  return sortProjectOverviewRows(filtered, sort.value, { typeLabel });
});

function clearFilters(): void {
  filters.value = { ...EMPTY_PROJECT_OVERVIEW_FILTERS };
}

function filterText(labelKey: WorkspaceMessageKey, value: string | null): string {
  return workspaceMessage('workspace.projectOverview.filterValue', {
    label: workspaceMessage(labelKey),
    value: value ?? '',
  });
}

const typeOptions = computed<CustomSelectOption<string>[]>(() => {
  const types = [...new Set(allRows.value.map(row => row.nodeType))]
    .map(nodeType => ({ nodeType, presentation: props.presentation.documentType(nodeType) }))
    .sort((left, right) => left.presentation.label.localeCompare(right.presentation.label, currentLocale.value));
  return [
    { value: ALL, text: workspaceMessage('workspace.projectOverview.filter.typeAll') },
    { isSeparator: true },
    ...types.map(type => ({
      value: type.nodeType,
      text: type.presentation.label,
      iconComponent: type.presentation.iconComponent,
    })),
  ];
});
const typeFilterText = computed(() => (
  filters.value.nodeType === null ? null : typeLabel(filters.value.nodeType)
));
function setTypeFilter(value: string): void {
  filters.value = { ...filters.value, nodeType: value === ALL ? null : value };
}

const MODIFIED_RANGES: readonly { readonly value: ProjectOverviewModifiedRange; readonly key: WorkspaceMessageKey }[] = [
  { value: 'any', key: 'workspace.projectOverview.filter.modifiedAll' },
  { value: 'today', key: 'workspace.projectOverview.filter.today' },
  { value: 'week', key: 'workspace.projectOverview.filter.week' },
  { value: 'month', key: 'workspace.projectOverview.filter.month' },
];
const modifiedOptions = computed<CustomSelectOption<string>[]>(() => MODIFIED_RANGES.flatMap((range, index) => [
  { value: range.value, text: workspaceMessage(range.key) },
  ...(index === 0 ? [{ isSeparator: true }] : []),
]));
const modifiedFilterText = computed(() => {
  const range = MODIFIED_RANGES.find(item => item.value === filters.value.modified);
  return !range || range.value === 'any' ? null : workspaceMessage(range.key);
});
function setModifiedFilter(value: string): void {
  const range = MODIFIED_RANGES.find(item => item.value === value)?.value ?? 'any';
  filters.value = { ...filters.value, modified: range };
}

const locationKey = (path: readonly string[]): string => path.join('\u0000');
const locationPaths = computed(() => listProjectOverviewLocations(allRows.value));
const locationOptions = computed<CustomSelectOption<string>[]>(() => [
  { value: ALL, text: workspaceMessage('workspace.projectOverview.filter.locationAll') },
  { value: '', text: workspaceMessage('workspace.projectOverview.location.root') },
  ...(locationPaths.value.length > 0 ? [{ isSeparator: true }] : []),
  ...locationPaths.value.map(path => ({ value: locationKey(path), text: path.join(' / ') })),
]);
const locationFilterText = computed(() => (
  filters.value.location === null ? null : filters.value.location.join(' / ') || workspaceMessage('workspace.projectOverview.location.root')
));
function setLocationFilter(value: string): void {
  const path = value === ALL ? null : value === '' ? [] : locationPaths.value.find(item => locationKey(item) === value) ?? null;
  filters.value = { ...filters.value, location: path };
}

const projectTags = computed(() => listProjectOverviewTags(allRows.value));
const tagOptions = computed<CustomSelectOption<string>[]>(() => projectTags.value.length === 0 ? [] : [
  { value: ALL, text: workspaceMessage('workspace.projectOverview.filter.tagAll') },
  { isSeparator: true },
  ...projectTags.value.map(tag => ({ value: tag.id, text: tag.name })),
]);
const tagFilterText = computed(() => {
  const id = filters.value.tags[0];
  return id === undefined ? null : projectTags.value.find(tag => tag.id === id)?.name ?? null;
});
function setTagFilter(value: string): void {
  filters.value = { ...filters.value, tags: value === ALL ? [] : [value] };
}

// 列：名称固定在最前；其余按列配置。拖动列宽时先改草稿，松手再保存。
const draftWidths = ref<Partial<Record<ProjectOverviewSortKey, number>>>({});
const nameWidth = computed(() => draftWidths.value.name ?? layoutStore.layout.nameWidth);
const visibleColumns = computed(() => layoutStore.layout.columns
  .filter(column => column.visible)
  .map(column => ({ ...column, width: draftWidths.value[column.id] ?? column.width })));
const headerColumns = computed<{ readonly id: ProjectOverviewSortKey }[]>(() => [
  { id: 'name' },
  ...visibleColumns.value.map(column => ({ id: column.id })),
]);
const tableStyle = computed(() => {
  const widths = [nameWidth.value, ...visibleColumns.value.map(column => column.width)];
  const contentWidth = widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP * (widths.length - 1);
  return {
    '--project-overview-columns': widths.map(width => `${width}px`).join(' '),
    '--project-overview-table-min-width': `${contentWidth}px`,
  };
});

/*
 * 与 Excel 一致：每列（含名称列）都是固定宽度，从左往右排；拖某列右边界只改这一列，
 * 右边的列整体跟着平移，分隔线始终在指针下。总宽超过可视区时出现水平滚动。
 */
let resizeCleanup: (() => void) | null = null;
function startResize(event: PointerEvent, id: ProjectOverviewSortKey): void {
  if (event.button !== 0) return;
  const startWidth = id === 'name' ? nameWidth.value : visibleColumns.value.find(item => item.id === id)?.width;
  if (startWidth === undefined) return;
  event.preventDefault();
  const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  handle?.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const clamp = id === 'name' ? clampNameWidth : clampColumnWidth;
  const onMove = (moveEvent: PointerEvent) => {
    draftWidths.value = { [id]: clamp(startWidth + moveEvent.clientX - startX) };
  };
  const onUp = () => {
    const width = draftWidths.value[id];
    if (width !== undefined) {
      if (id === 'name') layoutStore.resizeName(width);
      else layoutStore.resizeColumn(id, width);
    }
    draftWidths.value = {};
    resizeCleanup?.();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.body.classList.add('project-overview-is-resizing');
  resizeCleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('project-overview-is-resizing');
    resizeCleanup = null;
  };
}
onBeforeUnmount(() => resizeCleanup?.());

function resetColumnWidth(id: ProjectOverviewSortKey): void {
  if (id === 'name') {
    layoutStore.resizeName(DEFAULT_PROJECT_OVERVIEW_LAYOUT.nameWidth);
    return;
  }
  const width = DEFAULT_PROJECT_OVERVIEW_LAYOUT.columns.find(column => column.id === id)?.width;
  if (width !== undefined) layoutStore.resizeColumn(id, width);
}

function toggleSort(key: ProjectOverviewSortKey): void {
  sort.value = sort.value.key === key
    ? { key, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: defaultProjectOverviewSortDirection(key) };
}

function ariaSort(key: ProjectOverviewSortKey): 'ascending' | 'descending' | 'none' {
  if (sort.value.key !== key) return 'none';
  return sort.value.direction === 'asc' ? 'ascending' : 'descending';
}

// 表体：在整页滚动区里按行虚拟渲染。
const scrollHostRef = ref<HTMLElement | null>(null);
const scrollMountRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const overlayScroll = useOverlayScrollViewport({
  bindings: { hostRef: scrollHostRef, viewportMountRef: scrollMountRef, viewportRef: scrollRef },
  options: { overflow: { x: 'scroll', y: 'scroll' } },
});
onMounted(() => overlayScroll.init());
const bodyRef = ref<HTMLElement | null>(null);
const bodyOffset = ref(0);
const virtualizer = useVirtualizer(computed(() => ({
  count: sortedRows.value.length,
  getScrollElement: () => scrollRef.value ?? scrollMountRef.value,
  estimateSize: () => ROW_HEIGHT,
  overscan: 8,
  scrollMargin: bodyOffset.value,
  getItemKey: (index: number) => sortedRows.value[index]?.documentId ?? index,
})));
watch(bodyRef, body => { bodyOffset.value = body?.offsetTop ?? 0; }, { flush: 'post' });

/*
 * 行交互：文件名和“生成于”是链接，单击打开；点行内其他位置只选中这一行，
 * 双击或按 Enter 打开，↑↓ 在行间移动。选中为以后的批量操作留位置。
 */
const selectedDocumentId = ref<string | null>(null);
watch(projectIdRef, () => { selectedDocumentId.value = null; });

function selectRow(row: ProjectOverviewRow | undefined): void {
  if (row) selectedDocumentId.value = row.documentId;
}

function openRow(row: ProjectOverviewRow | undefined): void {
  if (row) emit('open-document', row);
}

function moveSelection(index: number, offset: -1 | 1): void {
  const target = sortedRows.value[index + offset];
  if (!target) return;
  selectedDocumentId.value = target.documentId;
  virtualizer.value.scrollToIndex(index + offset);
  void nextTick(() => {
    const element = scrollRef.value?.querySelector<HTMLElement>(`[data-document-id="${CSS.escape(target.documentId)}"]`);
    element?.focus({ preventScroll: true });
  });
}

function timeText(timestamp: number): string {
  return formatProjectOverviewTime(timestamp, now.value, currentLocale.value, workspaceMessage);
}

function actorText(actor: ProjectOverviewRow['creatorActor'], pluginId: string | null): string {
  if (actor === null) return '';
  return formatProjectOverviewActor(actor, pluginId ? props.presentation.pluginName(pluginId) : null, workspaceMessage);
}

function modifiedActorText(row: ProjectOverviewRow): string {
  return actorText(row.lastModifiedActor, row.lastModifiedPluginId);
}

function conversationText(row: ProjectOverviewRow): string {
  return row.conversationTitle?.trim() || workspaceMessage('workspace.projectOverview.untitledConversation');
}

function pendingText(row: ProjectOverviewRow): string {
  const count = row.pendingRevisionCount ?? 0;
  return count > 0 ? workspaceMessage('workspace.projectOverview.pending.revisions', { count }) : '';
}

function cellText(id: ProjectOverviewColumnId, row: ProjectOverviewRow): string {
  switch (id) {
    case 'tags':
      return row.tags.map(tag => tag.name).join('、');
    case 'location':
      return row.location.length > 0 ? row.location.join(' / ') : workspaceMessage('workspace.projectOverview.location.root');
    case 'source':
      return actorText(row.creatorActor, row.creatorPluginId);
    case 'type':
      return typeLabel(row.nodeType);
    case 'created':
      return timeText(row.createdAt);
    case 'conversation':
      return conversationText(row);
    case 'modified':
      return timeText(row.lastModifiedAt);
    case 'pending':
      return pendingText(row);
  }
}
</script>
