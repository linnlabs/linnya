<!--
  项目概览：文件、对话两页。文件页是项目里所有文件的一览表：页头、工具条固定，表头吸顶，表体按行虚拟渲染。
  文件页另有保存的筛选那一排与看板布局。对话页见 ProjectConversationsPanel。
  打开文件、对话、知识库设置和对话的写操作交给页面装配层；保存的筛选与看板改值经本 feature 的网关。
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

      <ProjectSavedFiltersBar
        v-show="page === 'files'"
        :pinned="savedFilters.pinned.value"
        :suggestions="savedFilters.suggestions.value"
        :active-id="activeFilterId"
        :labels="savedFiltersBarLabels"
        :summary="savedFilterSummary"
        @select="selectSavedFilter"
        @rename="startRename"
        @remove="removeSavedFilter"
        @pin="pinSavedFilter"
      />

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
        <ProjectOverviewConditionChip
          v-for="(condition, index) in filters.where"
          :key="`${condition.field}:${condition.op}:${index}`"
          :text="conditionText(condition)"
          :clear-label="workspaceMessage('workspace.projectOverview.clearFilter')"
          @clear="removeCondition(index)"
        />
        <div class="project-overview__spacer" />
        <span v-if="isFiltering && status === 'ready'" class="project-overview__count" aria-live="polite">
          {{ workspaceMessage('workspace.projectOverview.resultCount', { count: sortedRows.length }) }}
        </span>
        <span v-if="saveState === 'new'" ref="saveAnchorRef" class="project-overview__save-anchor">
          <BaseButton variant="plain" size="md" @click="startSave">
            <template #icon><SaveIcon /></template>
            {{ workspaceMessage('workspace.projectOverview.savedFilters.save') }}
          </BaseButton>
        </span>
        <span v-else-if="saveState === 'changed'" ref="saveAnchorRef" class="project-overview__save-anchor">
          <span class="project-overview__changed">{{ workspaceMessage('workspace.projectOverview.savedFilters.changed') }}</span>
          <BaseButton variant="plain" size="md" @click="startSave">
            {{ workspaceMessage('workspace.projectOverview.savedFilters.saveAsNew') }}
          </BaseButton>
          <BaseButton variant="tint" size="md" @click="saveChanges">
            {{ workspaceMessage('workspace.projectOverview.savedFilters.saveChanges') }}
          </BaseButton>
        </span>
        <ProjectOverviewFilterMenu
          v-if="view.kind === 'board' && groupFieldOptions.length > 0"
          :label="workspaceMessage('workspace.projectOverview.board.groupBy')"
          :value-text="boardField?.name ?? null"
          :active-text="filterText('workspace.projectOverview.board.groupBy', boardField?.name ?? null)"
          :clear-label="workspaceMessage('workspace.projectOverview.board.backToTable')"
          :model-value="boardField?.id ?? ''"
          :options="groupFieldOptions"
          @update:model-value="setGroupBy"
          @clear="setViewKind('table')"
        />
        <SegmentedTabs
          class="project-overview__layout"
          :model-value="view.kind"
          :tabs="layoutTabs"
          :aria-label="workspaceMessage('workspace.projectOverview.layout.label')"
          @update:model-value="setViewKind"
        />
        <ProjectOverviewColumnsMenu
          v-if="view.kind === 'table'"
          :layout="layoutStore.layout"
          @toggle="layoutStore.toggleColumn"
          @move="layoutStore.moveColumn"
          @reset="layoutStore.reset"
        />
      </div>
      <p v-if="page === 'files' && searchFailed" class="project-overview__hint" role="status">
        {{ workspaceMessage('workspace.projectOverview.searchFailed') }}
      </p>
      <p v-if="page === 'files' && fieldMatchFailure" class="project-overview__hint" role="status">
        {{ workspaceMessage('workspace.projectOverview.fieldMatchFailed', { message: fieldMatchFailure }) }}
      </p>
      <p v-if="page === 'files' && actionError" class="project-overview__hint project-overview__hint--error" role="alert">
        {{ actionError }}
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
        <div v-if="view.kind === 'board'" class="project-overview__board-wrap">
          <div v-if="status === 'loading'" class="project-overview__state">
            <SkeletonRows :label="workspaceMessage('workspace.projectOverview.loading')" :rows="6" />
          </div>
          <p v-else-if="status === 'error'" class="project-overview__state project-overview__state--text">
            {{ workspaceMessage('workspace.projectOverview.loadFailed') }}
          </p>
          <p v-else-if="boardField === null" class="project-overview__state project-overview__state--text">
            {{ workspaceMessage('workspace.projectOverview.board.noSelectField') }}
          </p>
          <template v-else>
            <ProjectOverviewBoard
              :lanes="board.lanes"
              :field="boardField"
              :fields="fields"
              :readonly="boardField.readonly"
              :when-text="boardWhenText"
              @open="openRow"
              @move="moveCard"
            />
            <p v-if="board.excluded > 0" class="project-overview__board-note">
              {{ workspaceMessage('workspace.projectOverview.board.excluded', { count: board.excluded, field: boardField.name }) }}
            </p>
          </template>
        </div>
        <div v-else class="project-overview__table" role="table" :style="tableStyle">
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
                    <TagChip
                      v-for="tag in sortedRows[item.index]!.tags"
                      :key="tag.id"
                      :label="tag.name"
                    />
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

    <ProjectSaveFilterPopover
      :open="saveDialog !== null"
      :anchor="saveDialog?.anchor ?? null"
      :align="saveDialog?.mode === 'rename' ? 'start' : 'end'"
      :title="saveDialog?.mode === 'rename'
        ? workspaceMessage('workspace.projectOverview.savedFilters.dialog.renameTitle')
        : workspaceMessage('workspace.projectOverview.savedFilters.dialog.title')"
      :initial-name="saveDialog?.initialName ?? ''"
      :placeholder="workspaceMessage('workspace.projectOverview.savedFilters.dialog.namePlaceholder')"
      :primary-text="saveDialog?.mode === 'rename'
        ? workspaceMessage('workspace.projectOverview.savedFilters.dialog.rename')
        : workspaceMessage('workspace.projectOverview.savedFilters.dialog.save')"
      :cancel-text="workspaceMessage('workspace.projectOverview.savedFilters.dialog.cancel')"
      :hint="saveDialog?.mode === 'create' ? workspaceMessage('workspace.projectOverview.savedFilters.dialog.hint') : null"
      :duplicate-notice="saveDialog?.duplicate
        ? workspaceMessage('workspace.projectOverview.savedFilters.dialog.duplicate', { name: saveDialog.duplicate.name })
        : null"
      :open-duplicate-text="saveDialog?.duplicate
        ? workspaceMessage('workspace.projectOverview.savedFilters.dialog.openExisting', { name: saveDialog.duplicate.name })
        : ''"
      :save-anyway-text="workspaceMessage('workspace.projectOverview.savedFilters.dialog.saveAnyway')"
      @submit="submitSaveDialog"
      @open-duplicate="openDuplicate"
      @cancel="saveDialog = null"
    />

    <SemanticSchemaModal
      v-if="schemaModalMounted"
      :is-visible="schemaModalOpen"
      :current-project-id="projectId"
      :agent-name="presentation.agentName"
      @close="schemaModalOpen = false"
      @changed="handleSchemaChanged"
      @open-document="openSchemaDocument"
    />
  </section>
</template>

<script lang="ts">
const lastPageByProject = new Map<string, 'files' | 'conversations'>();
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from 'vue';
import { useHistoryTime } from '@app/localization';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { BaseButton, SegmentedTabs, SkeletonRows, TagChip } from '@linnya/renderer-ui';
import type { CustomSelectOption, SegmentedTabItem } from '@linnya/renderer-ui';
import type { SemanticSchemaOverview } from '@app/schemas';
import { ChatIcon, ChevronIcon, LibraryIcon, SaveIcon, SearchIcon } from '@linnya/renderer-ui/icons';
import type { ProjectFieldCondition, ProjectSavedFilter } from '@app/schemas';
import type { WorkspaceMessageKey } from '@/domains/workspace/definitions/workspaceMessages';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import {
  DEFAULT_PROJECT_OVERVIEW_SORT,
  DEFAULT_PROJECT_OVERVIEW_VIEW,
  EMPTY_PROJECT_OVERVIEW_FILTERS,
  type ProjectOverviewColumnId,
  type ProjectOverviewDocumentTarget,
  type ProjectOverviewFilters,
  type ProjectOverviewModifiedRange,
  type ProjectOverviewPresentation,
  type ProjectOverviewRow,
  type ProjectOverviewSort,
  type ProjectOverviewSortKey,
  type ProjectOverviewView,
  type ProjectOverviewViewKind,
} from '../definitions/projectOverview';
import { groupProjectOverviewBoard, isBoardGroupField } from '../functions/projectOverviewBoard';
import { defaultSavedFilterName, fieldConditionText, type FieldConditionLabels } from '../functions/projectSavedFilters';
import { setProjectField } from '../infrastructure/projectOverviewGateway';
import { useProjectFieldMatches } from '../orchestration/useProjectFieldMatches';
import { useProjectOverviewSavedFilterState } from '../orchestration/useProjectOverviewSavedFilterState';
import ProjectOverviewBoard from './ProjectOverviewBoard.vue';
import ProjectOverviewConditionChip from './ProjectOverviewConditionChip.vue';
import ProjectSaveFilterPopover from './ProjectSaveFilterPopover.vue';
import ProjectSavedFiltersBar, { type ProjectSavedFiltersBarLabels } from './ProjectSavedFiltersBar.vue';
import { DEFAULT_PROJECT_OVERVIEW_LAYOUT, clampColumnWidth, clampNameWidth } from '../functions/projectOverviewLayout';
import {
  defaultProjectOverviewSortDirection,
  formatProjectOverviewActor,
  formatProjectOverviewCharacters,
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
import SemanticSchemaModal from '@/domains/workspace/features/semantic-schema/ui/SemanticSchemaModal.vue';

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
const { rows, fields, folderCount, characterCount, status, revision, refreshDocuments, reloadAll } = useProjectOverviewData(projectIdRef);

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
const sort = ref<ProjectOverviewSort>(DEFAULT_PROJECT_OVERVIEW_SORT);
const view = ref<ProjectOverviewView>(DEFAULT_PROJECT_OVERVIEW_VIEW);
const query = computed({
  get: () => filters.value.query,
  set: value => { filters.value = { ...filters.value, query: value }; },
});
const { matches: contentMatches, truncated: searchTruncated, failed: searchFailed } = useProjectOverviewContentSearch(projectIdRef, query, revision);

watch(projectIdRef, () => {
  filters.value = { ...EMPTY_PROJECT_OVERVIEW_FILTERS };
  sort.value = DEFAULT_PROJECT_OVERVIEW_SORT;
  view.value = DEFAULT_PROJECT_OVERVIEW_VIEW;
  actionError.value = null;
});

// 写入失败（保存筛选、看板改值）的一句提示，几秒后自动消失。
const actionError = ref<string | null>(null);
let actionErrorTimer: ReturnType<typeof setTimeout> | null = null;
function reportError(message: string): void {
  actionError.value = message;
  if (actionErrorTimer) clearTimeout(actionErrorTimer);
  actionErrorTimer = setTimeout(() => { actionError.value = null; }, 6_000);
}
onBeforeUnmount(() => { if (actionErrorTimer) clearTimeout(actionErrorTimer); });

const { matches: fieldMatches, failure: fieldMatchFailure } = useProjectFieldMatches(
  projectIdRef,
  computed(() => filters.value.where),
  revision,
);

const {
  savedFilters,
  activeFilterId,
  saveState,
  saveDialog,
  select: selectSavedFilter,
  startSave: openSaveDialog,
  startRename,
  submitSaveDialog,
  openDuplicate,
  saveChanges,
  remove: removeSavedFilter,
  pin: pinSavedFilter,
  reloadAfterSchemaChange,
} = useProjectOverviewSavedFilterState({
  projectId: projectIdRef,
  filters,
  sort,
  view,
  reportError,
  saveFailedMessage: () => workspaceMessage('workspace.projectOverview.savedFilters.saveFailed'),
});

// 相对时间与“最近 N 天”筛选共用一个时钟，见 useHistoryTime。
const { historyTime, now: historyClock } = useHistoryTime();
const now = computed(() => new Date(historyClock.value));

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
  || filters.value.where.length > 0
  || filters.value.query.trim().length > 0
));
const typeLabel = (nodeType: string): string => props.presentation.documentType(nodeType).label;
const sortedRows = computed(() => {
  const filtered = filterProjectOverviewRows(allRows.value, filters.value, {
    now: now.value,
    contentMatches: contentMatches.value,
    fieldMatches: fieldMatches.value,
  });
  return sortProjectOverviewRows(filtered, sort.value, { typeLabel });
});

function clearFilters(): void {
  filters.value = { ...EMPTY_PROJECT_OVERVIEW_FILTERS };
}

// 保存的筛选：那一排、保存与重命名弹层、字段条件的文字。
const savedFiltersBarLabels = computed<ProjectSavedFiltersBarLabels>(() => ({
  ariaLabel: workspaceMessage('workspace.projectOverview.savedFilters.label'),
  allFiles: workspaceMessage('workspace.projectOverview.savedFilters.all'),
  more: count => workspaceMessage('workspace.projectOverview.savedFilters.more', { count }),
  suggestions: count => workspaceMessage('workspace.projectOverview.savedFilters.suggestions', { count }),
  suggestionActive: name => workspaceMessage('workspace.projectOverview.savedFilters.suggestionActive', { name }),
  pin: workspaceMessage('workspace.projectOverview.savedFilters.pin'),
  suggestionsFooter: workspaceMessage('workspace.projectOverview.savedFilters.suggestionsFooter'),
  rename: workspaceMessage('workspace.projectOverview.savedFilters.menu.rename'),
  remove: workspaceMessage('workspace.projectOverview.savedFilters.menu.delete'),
}));

const BUILTIN_FIELD_KEYS: Readonly<Record<string, WorkspaceMessageKey>> = {
  name: 'workspace.projectOverview.condition.builtin.name',
  type: 'workspace.projectOverview.condition.builtin.type',
  created: 'workspace.projectOverview.condition.builtin.created',
  updated: 'workspace.projectOverview.condition.builtin.updated',
};
const conditionLabels = computed<FieldConditionLabels>(() => ({
  fieldName: id => fields.value.find(field => field.id === id)?.name ?? null,
  builtinName: field => (BUILTIN_FIELD_KEYS[field] ? workspaceMessage(BUILTIN_FIELD_KEYS[field]) : null),
  unknownField: workspaceMessage('workspace.projectOverview.condition.unknownField'),
  checked: workspaceMessage('workspace.projectOverview.condition.checked'),
  unchecked: workspaceMessage('workspace.projectOverview.condition.unchecked'),
  empty: workspaceMessage('workspace.projectOverview.condition.empty'),
  notEmpty: workspaceMessage('workspace.projectOverview.condition.notEmpty'),
  negated: value => workspaceMessage('workspace.projectOverview.condition.not', { value }),
  contains: value => workspaceMessage('workspace.projectOverview.condition.contains', { value }),
  notContains: value => workspaceMessage('workspace.projectOverview.condition.notContains', { value }),
  join: workspaceMessage('workspace.projectOverview.condition.join'),
  pair: (label, value) => workspaceMessage('workspace.projectOverview.filterValue', { label, value }),
}));
function conditionText(condition: ProjectFieldCondition): string {
  return fieldConditionText(condition, fields.value, conditionLabels.value);
}
function removeCondition(index: number): void {
  filters.value = { ...filters.value, where: filters.value.where.filter((_, position) => position !== index) };
}

function savedFilterSummary(filter: ProjectSavedFilter): string {
  const definition = filter.definition;
  return [
    ...definition.tags.map(id => projectTags.value.find(tag => tag.id === id)?.name ?? null),
    ...definition.where.map(conditionText),
    definition.node_type === null ? null : typeLabel(definition.node_type),
  ].filter((part): part is string => part !== null).join(' · ');
}

const saveAnchorRef = ref<HTMLElement | null>(null);
function startSave(): void {
  if (!saveAnchorRef.value) return;
  const fallback = view.value.kind === 'board'
    ? workspaceMessage('workspace.projectOverview.layout.board')
    : workspaceMessage('workspace.projectOverview.savedFilters.defaultName');
  openSaveDialog(saveAnchorRef.value, defaultSavedFilterName([
    tagFilterText.value,
    ...filters.value.where.map(conditionText),
    typeFilterText.value,
    modifiedFilterText.value,
    locationFilterText.value,
  ], fallback));
}

// 布局：表格 / 看板。看板按单选字段分列，第一次切过去时自动选一个本页文档用到的单选字段。
const layoutTabs = computed<SegmentedTabItem[]>(() => [
  { id: 'table', label: workspaceMessage('workspace.projectOverview.layout.table') },
  { id: 'board', label: workspaceMessage('workspace.projectOverview.layout.board') },
]);
const groupFields = computed(() => fields.value.filter(isBoardGroupField));
const groupFieldOptions = computed<CustomSelectOption<string>[]>(() => groupFields.value.map(field => ({ value: field.id, text: field.name })));
const boardField = computed(() => groupFields.value.find(field => field.id === view.value.groupBy) ?? null);
function setViewKind(kind: string): void {
  const next: ProjectOverviewViewKind = kind === 'board' ? 'board' : 'table';
  if (next === 'table') {
    view.value = { kind: 'table', groupBy: null };
    return;
  }
  const used = new Set(sortedRows.value.flatMap(row => row.fieldIds));
  const groupBy = boardField.value?.id
    ?? groupFields.value.find(field => used.has(field.id))?.id
    ?? groupFields.value[0]?.id
    ?? null;
  view.value = { kind: 'board', groupBy };
}
function setGroupBy(id: string): void {
  view.value = { kind: 'board', groupBy: id };
}

// 看板拖动：先在界面上挪过去，写入成功后补读这份文档；失败时挪回并说明原因。
const boardOverrides = ref<ReadonlyMap<string, string | null>>(new Map());
watch(rows, () => { boardOverrides.value = new Map(); });
const board = computed(() => (boardField.value === null
  ? { lanes: [], excluded: 0 }
  : groupProjectOverviewBoard(
      sortedRows.value,
      boardField.value,
      workspaceMessage('workspace.projectOverview.board.unset'),
      boardOverrides.value,
    )));
async function moveCard(row: ProjectOverviewRow, optionId: string | null): Promise<void> {
  const field = boardField.value;
  if (!field) return;
  boardOverrides.value = new Map([...boardOverrides.value, [row.documentId, optionId]]);
  const valueName = optionId === null
    ? workspaceMessage('workspace.projectOverview.board.unset')
    : field.options.find(option => option.id === optionId)?.name ?? optionId;
  try {
    const result = await setProjectField({
      project_id: props.projectId,
      document_id: row.documentId,
      field_id: field.id,
      value: optionId,
      expected_revision: row.fieldRevision,
    });
    if (!result.ok) {
      reportError(result.code === 'revision_conflict'
        ? workspaceMessage('workspace.projectOverview.board.moveConflict')
        : workspaceMessage('workspace.projectOverview.board.moveFailed', { value: valueName, message: result.message }));
    }
  } catch (error: unknown) {
    console.error('[ProjectOverview] 看板改值失败:', error);
    reportError(workspaceMessage('workspace.projectOverview.board.moveFailed', {
      value: valueName, message: error instanceof Error ? error.message : String(error),
    }));
  }
  // 成功与否都补读：成功拿到新版本，失败（如版本冲突）拿到当前值并撤掉界面上的挪动。
  refreshDocuments([row.documentId]);
}
function boardWhenText(row: ProjectOverviewRow): string {
  const actor = modifiedActorText(row);
  const time = timeText(row.lastModifiedAt);
  return actor ? `${actor} · ${time}` : time;
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
const MANAGE_TAGS = '__manage_tags__';
const tagOptions = computed<CustomSelectOption<string>[]>(() => projectTags.value.length === 0 ? [] : [
  { value: ALL, text: workspaceMessage('workspace.projectOverview.filter.tagAll') },
  { isSeparator: true },
  ...projectTags.value.map(tag => ({ value: tag.id, text: tag.name })),
  { isSeparator: true },
  { value: MANAGE_TAGS, text: workspaceMessage('workspace.projectOverview.filter.manageTags') },
]);
const tagFilterText = computed(() => {
  if (filters.value.tags.length === 0) return null;
  // 保存的筛选可能同时要求几个标签（Agent 用 CLI 建的）。
  return filters.value.tags.map(id => projectTags.value.find(tag => tag.id === id)?.name ?? id).join('、');
});
function setTagFilter(value: string): void {
  if (value === MANAGE_TAGS) {
    schemaModalMounted.value = true;
    schemaModalOpen.value = true;
    return;
  }
  filters.value = { ...filters.value, tags: value === ALL ? [] : [value] };
}

// 标签管理弹窗：第一次打开时才挂载。
const schemaModalMounted = ref(false);
const schemaModalOpen = ref(false);

/**
 * 标签或字段本身改了：文档的标签和字段整份重读，保存的筛选重读（Backend 已一并改写）；
 * 界面上临时的条件里引用了已删除的标签或字段时去掉。
 */
function handleSchemaChanged(overview: SemanticSchemaOverview): void {
  reloadAll();
  const tagIds = new Set(overview.tags.map(tag => tag.id));
  const fieldIds = new Set(overview.properties.map(property => property.id));
  void reloadAfterSchemaChange().then(() => {
    const current = filters.value;
    const tags = current.tags.filter(id => tagIds.has(id));
    const where = current.where.filter(condition => fieldIds.has(condition.field) || !looksLikeFieldId(condition.field));
    if (tags.length !== current.tags.length || where.length !== current.where.length) {
      filters.value = { ...current, tags, where };
    }
  }).catch((error: unknown) => console.error('[ProjectOverview] 重读保存的筛选失败:', error));
}

/** 内建字段（name、type、created、updated）不是语义层字段，不因字段删除而去掉。 */
function looksLikeFieldId(field: string): boolean {
  return !['name', 'type', 'created', 'updated'].includes(field);
}

function openSchemaDocument(documentId: string): void {
  const row = rows.value.get(documentId);
  if (!row) return;
  schemaModalOpen.value = false;
  openRow(row);
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
  return historyTime(timestamp);
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
