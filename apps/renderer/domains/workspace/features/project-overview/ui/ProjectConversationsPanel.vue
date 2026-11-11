<!--
  项目概览的“对话”页：工具条、对话表和右侧详情。
  列表数据由视图持有（页签上要显示数量）；对话的写操作（置顶、改名、删除、打开）交给页面装配层，
  这里只清理过程文件（走存储空间接口）。
-->
<template>
  <div class="project-conversations">
    <div class="project-overview__top project-conversations__top">
      <div class="project-overview__toolbar">
        <label class="project-overview__search">
          <SearchIcon class="project-overview__search-icon" />
          <input
            v-model="query"
            type="search"
            class="project-overview__search-input"
            :placeholder="message('workspace.projectOverview.conversations.searchPlaceholder')"
            :aria-label="message('workspace.projectOverview.conversations.searchPlaceholder')"
          />
        </label>
        <ProjectOverviewFilterMenu
          :label="message('workspace.projectOverview.conversations.filter.agent')"
          :value-text="agentFilterText"
          :active-text="filterText('workspace.projectOverview.conversations.filter.agent', agentFilterText)"
          :clear-label="message('workspace.projectOverview.clearFilter')"
          :model-value="filters.agent ?? ALL"
          :options="agentOptions"
          @update:model-value="setAgentFilter"
          @clear="setAgentFilter(ALL)"
        />
        <ProjectOverviewFilterMenu
          :label="message('workspace.projectOverview.conversations.filter.activity')"
          :value-text="activityFilterText"
          :active-text="filterText('workspace.projectOverview.conversations.filter.activity', activityFilterText)"
          :clear-label="message('workspace.projectOverview.clearFilter')"
          :model-value="filters.activity"
          :options="activityOptions"
          @update:model-value="setActivityFilter"
          @clear="setActivityFilter('any')"
        />
        <ProjectOverviewFilterMenu
          :label="message('workspace.projectOverview.conversations.filter.documents')"
          :value-text="documentsFilterText"
          :active-text="documentsFilterText ?? ''"
          :clear-label="message('workspace.projectOverview.clearFilter')"
          :model-value="filters.documents"
          :options="documentsOptions"
          @update:model-value="setDocumentsFilter"
          @clear="setDocumentsFilter('any')"
        />
        <div class="project-overview__spacer" />
        <span v-if="isFiltering && status === 'ready'" class="project-overview__count" aria-live="polite">
          {{ message('workspace.projectOverview.conversations.resultCount', { count: sortedRows.length }) }}
        </span>
      </div>
      <p v-if="searchFailed" class="project-overview__hint" role="status">
        {{ message('workspace.projectOverview.conversations.searchFailed') }}
      </p>
      <p v-if="searchTruncated" class="project-overview__hint">
        {{ message('workspace.projectOverview.conversations.searchTruncated', { count: PROJECT_CONVERSATIONS_SEARCH_LIMIT }) }}
      </p>
    </div>

    <div class="project-conversations__split">
      <div
        ref="scrollHostRef"
        class="project-overview__scroll-host project-conversations__main"
        data-overlay-scroll-theme="linnya"
      >
        <div ref="scrollMountRef" class="project-overview__scroll" data-overlayscrollbars-initialize>
          <div class="project-overview__table project-conversations__table" role="table">
            <div class="project-overview__header" role="row">
              <div
                v-for="column in PROJECT_CONVERSATION_COLUMN_IDS"
                :key="column"
                class="project-overview__header-cell"
                :class="{ 'project-conversations__numeric': isNumeric(column) }"
                role="columnheader"
                :aria-sort="ariaSort(column)"
              >
                <button
                  type="button"
                  class="project-overview__sort"
                  :class="{ 'is-sorted': sort.key === column }"
                  @click="toggleSort(column)"
                >
                  <span>{{ message(columnMessageKey(column)) }}</span>
                  <ChevronIcon
                    v-if="sort.key === column"
                    class="project-overview__sort-icon"
                    :direction="sort.direction === 'desc' ? 'down' : 'up'"
                  />
                </button>
              </div>
            </div>

            <div v-if="status === 'loading'" class="project-overview__state">
              <SkeletonRows :label="message('workspace.projectOverview.loading')" :rows="8" />
            </div>
            <p v-else-if="status === 'error'" class="project-overview__state project-overview__state--text">
              {{ message('workspace.projectOverview.loadFailed') }}
            </p>
            <p v-else-if="rows.length === 0" class="project-overview__state project-overview__state--text">
              {{ message('workspace.projectOverview.conversations.empty') }}
            </p>
            <div v-else-if="sortedRows.length === 0" class="project-overview__state project-overview__state--text">
              <span>{{ message('workspace.projectOverview.conversations.noMatch') }}</span>
              <button type="button" class="project-overview__clear-all" @click="clearFilters">
                {{ message('workspace.projectOverview.clearFilter') }}
              </button>
            </div>

            <div v-else role="rowgroup">
              <div
                v-for="(row, index) in sortedRows"
                :key="row.conversation_id"
                class="project-overview__row project-conversations__row"
                :class="{ 'is-selected': row.conversation_id === selectedId }"
                :data-conversation-id="row.conversation_id"
                role="row"
                tabindex="0"
                :aria-selected="row.conversation_id === selectedId"
                @click="selectedId = row.conversation_id"
                @focus="selectedId = row.conversation_id"
                @dblclick="actions.open(row.conversation_id)"
                @keydown.enter.self="actions.open(row.conversation_id)"
                @keydown.up.self.prevent="moveSelection(index, -1)"
                @keydown.down.self.prevent="moveSelection(index, 1)"
              >
                <div class="project-overview__cell project-overview__cell--name" role="cell">
                  <button
                    type="button"
                    tabindex="-1"
                    class="project-overview__name"
                    @click.stop="actions.open(row.conversation_id)"
                    @dblclick.stop
                  >
                    {{ titleText(row) }}
                  </button>
                  <PinIcon
                    v-if="row.is_pinned"
                    class="project-conversations__pin"
                    :aria-label="message('workspace.projectOverview.conversations.pinned')"
                  />
                </div>
                <div class="project-overview__cell project-conversations__muted" role="cell">
                  <span>{{ agentText(row.agent_id) }}</span>
                </div>
                <div class="project-overview__cell project-conversations__numeric" role="cell">
                  <span>{{ row.turn_count }}</span>
                </div>
                <div class="project-overview__cell project-conversations__numeric" role="cell">
                  <span :class="{ 'project-conversations__muted': row.changed_document_count === 0 }">
                    {{ row.changed_document_count === 0 ? '—' : row.changed_document_count }}
                  </span>
                </div>
                <div class="project-overview__cell" role="cell">
                  <span
                    v-if="runningConversationIds.has(row.conversation_id)"
                    class="project-conversations__running"
                  >{{ message('workspace.projectOverview.conversations.running') }}</span>
                  <span v-else>{{ timeText(row.last_event_at) }}</span>
                </div>
                <div class="project-overview__cell project-conversations__numeric project-conversations__muted" role="cell">
                  <span>{{ row.storage === null ? '' : bytesText(projectConversationStorageBytes(row.storage)) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside
        v-if="selectedRow"
        class="project-conversations__detail"
        :aria-label="titleText(selectedRow)"
      >
        <div class="project-conversations__detail-head">
          <InlineTextInput
            v-if="renamingId === selectedRow.conversation_id"
            ref="renameInputRef"
            v-model="renameDraft"
            :autofocus="false"
            class="project-conversations__rename"
            :aria-label="message('workspace.projectOverview.conversations.rename.label')"
            @commit="commitRename(selectedRow)"
            @cancel="renamingId = null"
          />
          <h2 v-else class="project-conversations__detail-title">{{ titleText(selectedRow) }}</h2>
          <ProjectConversationMoreMenu
            :label="message('workspace.projectOverview.conversations.menu.more')"
            :options="menuOptions"
            @select="handleMenu"
          />
        </div>
        <p class="project-conversations__detail-meta">{{ detailMetaText(selectedRow) }}</p>

        <p v-if="detailStatus === 'error'" class="project-conversations__detail-note">
          {{ message('workspace.projectOverview.conversations.detail.loadFailed') }}
        </p>

        <section v-if="selectedExcerpt" class="project-conversations__section">
          <h3 class="project-conversations__label">{{ message('workspace.projectOverview.conversations.detail.match') }}</h3>
          <p class="project-conversations__quote">{{ selectedExcerpt }}</p>
        </section>

        <template v-if="detail">
          <section v-if="detail.first_question" class="project-conversations__section">
            <h3 class="project-conversations__label">{{ message('workspace.projectOverview.conversations.detail.firstQuestion') }}</h3>
            <p class="project-conversations__quote">{{ detail.first_question }}</p>
          </section>
          <section v-if="detail.last_answer" class="project-conversations__section">
            <h3 class="project-conversations__label">{{ message('workspace.projectOverview.conversations.detail.lastAnswer') }}</h3>
            <p class="project-conversations__quote">{{ detail.last_answer }}</p>
          </section>
          <section v-if="detail.changed_documents.length > 0" class="project-conversations__section">
            <h3 class="project-conversations__label">
              {{ message('workspace.projectOverview.conversations.detail.documents') }}
              <span class="project-conversations__label-count">{{ detail.changed_documents.length }}</span>
            </h3>
            <ul class="project-conversations__docs">
              <li v-for="document in detail.changed_documents" :key="document.document_id">
                <button
                  type="button"
                  class="project-conversations__doc"
                  :disabled="document.deleted"
                  @click="openDocument(document)"
                >
                  <component
                    :is="presentation.documentType(document.node_type).iconComponent"
                    class="project-overview__type-icon project-conversations__doc-icon"
                    :class="presentation.documentType(document.node_type).iconClass"
                  />
                  <span class="project-conversations__doc-name">{{ document.title }}</span>
                  <span class="project-conversations__doc-meta">
                    <template v-if="document.deleted">
                      {{ message('workspace.projectOverview.conversations.detail.documentDeleted') }}
                    </template>
                    <template v-else>
                      <span v-if="(document.pending_revision_count ?? 0) > 0" class="project-overview__pending">
                        {{ message('workspace.projectOverview.pending.revisions', { count: document.pending_revision_count ?? 0 }) }}
                      </span>
                      <span v-if="(document.pending_revision_count ?? 0) > 0"> · </span>
                      {{ timeText(document.last_changed_at) }}
                    </template>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </template>

        <section class="project-conversations__section">
          <h3 class="project-conversations__label">
            {{ message('workspace.projectOverview.conversations.detail.storage') }}
            <span class="project-conversations__label-count">
              {{ selectedStorage === null
                ? message('workspace.projectOverview.conversations.detail.storageMeasuring')
                : bytesText(projectConversationStorageBytes(selectedStorage)) }}
            </span>
          </h3>
          <dl v-if="selectedStorage" class="project-conversations__storage">
            <div>
              <dt>{{ message('workspace.projectOverview.conversations.detail.storageRecords') }}</dt>
              <dd>{{ bytesText(selectedStorage.record_bytes) }}</dd>
            </div>
            <div v-if="selectedStorage.attachment_bytes > 0">
              <dt
                :data-linnya-tooltip="selectedStorage.has_shared_attachments
                  ? message('workspace.projectOverview.conversations.detail.storageShared')
                  : undefined"
              >{{ message('workspace.projectOverview.conversations.detail.storageAttachments') }}</dt>
              <dd>{{ bytesText(selectedStorage.attachment_bytes) }}</dd>
            </div>
            <div v-if="selectedStorage.work_files_state !== 'not_created'">
              <dt>{{ message('workspace.projectOverview.conversations.detail.storageWorkFiles') }}</dt>
              <dd>
                <template v-if="selectedStorage.work_file_bytes === null">
                  {{ message('workspace.projectOverview.conversations.detail.storageUnavailable') }}
                </template>
                <template v-else>
                  {{ bytesText(selectedStorage.work_file_bytes) }}
                  <button
                    v-if="canClear(selectedStorage)"
                    type="button"
                    class="project-conversations__link"
                    :disabled="clearingId === selectedRow.conversation_id"
                    @click="clearWorkFiles(selectedRow)"
                  >{{ message('workspace.projectOverview.conversations.detail.clear') }}</button>
                </template>
              </dd>
            </div>
          </dl>
        </section>

        <div class="project-conversations__foot">
          <button type="button" class="project-conversations__open" @click="actions.open(selectedRow.conversation_id)">
            <ChatIcon />
            <span>{{ message('workspace.projectOverview.conversations.detail.open') }}</span>
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef, watch } from 'vue';
import { useHistoryTime } from '@app/localization';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { InlineTextInput, SkeletonRows, type CustomSelectOption } from '@linnya/renderer-ui';
import { ChatIcon, ChevronIcon, PinIcon, SearchIcon } from '@linnya/renderer-ui/icons';
import {
  PROJECT_CONVERSATIONS_SEARCH_LIMIT,
  type ProjectConversationChangedDocument,
  type ProjectConversationRow,
  type ProjectConversationStorage,
} from '@app/schemas';
import type { WorkspaceMessageKey } from '@/domains/workspace/definitions/workspaceMessages';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { formatStorageBytes } from '@app/localization';
import {
  EMPTY_PROJECT_CONVERSATION_FILTERS,
  PROJECT_CONVERSATION_COLUMN_IDS,
  type ProjectConversationActions,
  type ProjectConversationActivityRange,
  type ProjectConversationColumnId,
  type ProjectConversationDocumentsFilter,
  type ProjectConversationFilters,
  type ProjectConversationSort,
} from '../definitions/projectConversations';
import type { ProjectOverviewDocumentTarget, ProjectOverviewPresentation } from '../definitions/projectOverview';
import {
  defaultProjectConversationSortDirection,
  filterProjectConversationRows,
  projectConversationStorageBytes,
  sortProjectConversationRows,
} from '../functions/projectConversationRows';
import { isExcerptShown } from '../functions/projectConversationExcerpt';
import { clearProjectConversationWorkFiles } from '../orchestration/clearProjectConversationWorkFiles';
import { useProjectConversationDetail } from '../orchestration/useProjectConversationDetail';
import { useProjectConversationSearch } from '../orchestration/useProjectConversationSearch';
import ProjectConversationMoreMenu from './ProjectConversationMoreMenu.vue';
import ProjectOverviewFilterMenu from './ProjectOverviewFilterMenu.vue';

const props = defineProps<{
  projectId: string;
  rows: readonly ProjectConversationRow[];
  status: 'loading' | 'ready' | 'error';
  revision: number;
  presentation: ProjectOverviewPresentation;
  actions: ProjectConversationActions;
  runningConversationIds: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  'open-document': [target: ProjectOverviewDocumentTarget];
  /** 存储变化（清理过程文件）后请视图重测这个对话。 */
  remeasure: [conversationId: string];
}>();

type MenuAction = 'open' | 'pin' | 'rename' | 'clear' | 'delete';

const ALL = '__all__';
const { workspaceMessage: message, currentLocale } = useWorkspaceLocalization();
const projectIdRef = toRef(props, 'projectId');
const revisionRef = toRef(props, 'revision');

const filters = ref<ProjectConversationFilters>({ ...EMPTY_PROJECT_CONVERSATION_FILTERS });
const sort = ref<ProjectConversationSort>({ key: 'activity', direction: 'desc' });
const query = computed({
  get: () => filters.value.query,
  set: value => { filters.value = { ...filters.value, query: value }; },
});
const { matches, truncated: searchTruncated, failed: searchFailed } = useProjectConversationSearch(projectIdRef, query, revisionRef);

watch(projectIdRef, () => { filters.value = { ...EMPTY_PROJECT_CONVERSATION_FILTERS }; });

// 相对时间与活跃度筛选共用一个时钟，见 useHistoryTime。
const { historyTime, now: historyClock } = useHistoryTime();
const now = computed(() => new Date(historyClock.value));

function agentText(agentId: string | null): string {
  return props.presentation.agentName(agentId) ?? agentId ?? message('workspace.projectOverview.actor.linnyaAi');
}
function titleText(row: ProjectConversationRow): string {
  return row.title.trim() || message('workspace.projectOverview.untitledConversation');
}
function timeText(timestamp: number): string {
  return historyTime(timestamp);
}
function bytesText(bytes: number): string {
  return formatStorageBytes(bytes, currentLocale.value);
}

const isFiltering = computed(() => (
  filters.value.agent !== null
  || filters.value.activity !== 'any'
  || filters.value.documents !== 'any'
  || filters.value.query.trim().length > 0
));
const sortedRows = computed(() => {
  const filtered = filterProjectConversationRows(props.rows, filters.value, {
    now: now.value,
    matches: filters.value.query.trim() ? matches.value : null,
  });
  return sortProjectConversationRows(filtered, sort.value, {
    title: titleText,
    agent: row => agentText(row.agent_id),
  });
});

function clearFilters(): void {
  filters.value = { ...EMPTY_PROJECT_CONVERSATION_FILTERS };
}
function filterText(labelKey: WorkspaceMessageKey, value: string | null): string {
  return message('workspace.projectOverview.filterValue', { label: message(labelKey), value: value ?? '' });
}

const agentOptions = computed<CustomSelectOption<string>[]>(() => {
  const agents = [...new Set(props.rows.map(row => row.agent_id ?? ''))]
    .map(agent => ({ value: agent, text: agentText(agent || null) }))
    .sort((left, right) => left.text.localeCompare(right.text, currentLocale.value));
  return [
    { value: ALL, text: message('workspace.projectOverview.conversations.filter.agentAll') },
    { isSeparator: true },
    ...agents,
  ];
});
const agentFilterText = computed(() => (filters.value.agent === null ? null : agentText(filters.value.agent || null)));
function setAgentFilter(value: string): void {
  filters.value = { ...filters.value, agent: value === ALL ? null : value };
}

const ACTIVITY_RANGES: readonly { readonly value: ProjectConversationActivityRange; readonly key: WorkspaceMessageKey }[] = [
  { value: 'any', key: 'workspace.projectOverview.filter.modifiedAll' },
  { value: 'today', key: 'workspace.projectOverview.filter.today' },
  { value: 'week', key: 'workspace.projectOverview.filter.week' },
  { value: 'month', key: 'workspace.projectOverview.filter.month' },
];
const activityOptions = computed<CustomSelectOption<string>[]>(() => ACTIVITY_RANGES.flatMap((range, index) => [
  { value: range.value, text: message(range.key) },
  ...(index === 0 ? [{ isSeparator: true }] : []),
]));
const activityFilterText = computed(() => {
  const range = ACTIVITY_RANGES.find(item => item.value === filters.value.activity);
  return !range || range.value === 'any' ? null : message(range.key);
});
function setActivityFilter(value: string): void {
  filters.value = { ...filters.value, activity: ACTIVITY_RANGES.find(item => item.value === value)?.value ?? 'any' };
}

const DOCUMENT_FILTERS: readonly { readonly value: ProjectConversationDocumentsFilter; readonly key: WorkspaceMessageKey }[] = [
  { value: 'any', key: 'workspace.projectOverview.conversations.filter.documentsAll' },
  { value: 'changed', key: 'workspace.projectOverview.conversations.filter.documentsChanged' },
  { value: 'unchanged', key: 'workspace.projectOverview.conversations.filter.documentsUnchanged' },
];
const documentsOptions = computed<CustomSelectOption<string>[]>(() => DOCUMENT_FILTERS.flatMap((item, index) => [
  { value: item.value, text: message(item.key) },
  ...(index === 0 ? [{ isSeparator: true }] : []),
]));
const documentsFilterText = computed(() => {
  const item = DOCUMENT_FILTERS.find(filter => filter.value === filters.value.documents);
  return !item || item.value === 'any' ? null : message(item.key);
});
function setDocumentsFilter(value: string): void {
  filters.value = { ...filters.value, documents: DOCUMENT_FILTERS.find(item => item.value === value)?.value ?? 'any' };
}

function columnMessageKey(column: ProjectConversationColumnId): WorkspaceMessageKey {
  switch (column) {
    case 'title': return 'workspace.projectOverview.conversations.column.title';
    case 'agent': return 'workspace.projectOverview.conversations.column.agent';
    case 'turns': return 'workspace.projectOverview.conversations.column.turns';
    case 'documents': return 'workspace.projectOverview.conversations.column.documents';
    case 'activity': return 'workspace.projectOverview.conversations.column.activity';
    case 'storage': return 'workspace.projectOverview.conversations.column.storage';
  }
}
const isNumeric = (column: ProjectConversationColumnId): boolean => (
  column === 'turns' || column === 'documents' || column === 'storage'
);
function toggleSort(key: ProjectConversationColumnId): void {
  sort.value = sort.value.key === key
    ? { key, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: defaultProjectConversationSortDirection(key) };
}
function ariaSort(key: ProjectConversationColumnId): 'ascending' | 'descending' | 'none' {
  if (sort.value.key !== key) return 'none';
  return sort.value.direction === 'asc' ? 'ascending' : 'descending';
}

const scrollHostRef = ref<HTMLElement | null>(null);
const scrollMountRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const overlayScroll = useOverlayScrollViewport({
  bindings: { hostRef: scrollHostRef, viewportMountRef: scrollMountRef, viewportRef: scrollRef },
  options: { overflow: { x: 'hidden', y: 'scroll' } },
});
onMounted(() => overlayScroll.init());

// 选中：默认选中第一行，详情栏始终有内容；选中的对话被筛掉或删掉时改选第一行。
const selectedId = ref<string | null>(null);
watch(sortedRows, list => {
  if (selectedId.value !== null && list.some(row => row.conversation_id === selectedId.value)) return;
  selectedId.value = list[0]?.conversation_id ?? null;
}, { immediate: true });
const selectedRow = computed(() => sortedRows.value.find(row => row.conversation_id === selectedId.value) ?? null);
const { detail, status: detailStatus } = useProjectConversationDetail(projectIdRef, selectedId, revisionRef);
const selectedStorage = computed(() => selectedRow.value?.storage ?? null);
const selectedExcerpt = computed(() => {
  const excerpt = selectedId.value && filters.value.query.trim() ? matches.value?.get(selectedId.value) ?? null : null;
  return excerpt && !isExcerptShown(excerpt, [detail.value?.first_question, detail.value?.last_answer]) ? excerpt : null;
});

function moveSelection(index: number, offset: -1 | 1): void {
  const target = sortedRows.value[index + offset];
  if (!target) return;
  selectedId.value = target.conversation_id;
  void nextTick(() => {
    const element = scrollRef.value?.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(target.conversation_id)}"]`);
    element?.focus();
  });
}

function detailMetaText(row: ProjectConversationRow): string {
  return [
    agentText(row.agent_id),
    message('workspace.projectOverview.conversations.detail.turns', { count: row.turn_count }),
    message('workspace.projectOverview.conversations.detail.created', { time: timeText(row.created_at) }),
    props.runningConversationIds.has(row.conversation_id)
      ? message('workspace.projectOverview.conversations.running')
      : message('workspace.projectOverview.conversations.detail.activity', { time: timeText(row.last_event_at) }),
  ].join(' · ');
}

function openDocument(document: ProjectConversationChangedDocument): void {
  if (document.deleted) return;
  emit('open-document', {
    documentId: document.document_id,
    nodeType: document.node_type,
    title: document.title,
    parentId: document.parent_id,
  });
}

const canClear = (storage: ProjectConversationStorage): boolean => (
  storage.work_files_state === 'available' && (storage.work_file_bytes ?? 0) > 0
);

const menuOptions = computed<CustomSelectOption<MenuAction>[]>(() => {
  const row = selectedRow.value;
  const storage = selectedStorage.value;
  return [
    { value: 'open', text: message('workspace.projectOverview.conversations.menu.open') },
    {
      value: 'pin',
      text: message(row?.is_pinned
        ? 'workspace.projectOverview.conversations.menu.unpin'
        : 'workspace.projectOverview.conversations.menu.pin'),
    },
    { value: 'rename', text: message('workspace.projectOverview.conversations.menu.rename') },
    ...(storage && canClear(storage)
      ? [{ value: 'clear' as const, text: message('workspace.projectOverview.conversations.menu.clearWorkFiles') }]
      : []),
    { isSeparator: true },
    { value: 'delete', text: message('workspace.projectOverview.conversations.menu.delete'), variant: 'danger' },
  ];
});

const renamingId = ref<string | null>(null);
const renameInputRef = ref<InstanceType<typeof InlineTextInput> | null>(null);
const renameDraft = ref('');
const clearingId = ref<string | null>(null);

async function commitRename(row: ProjectConversationRow): Promise<void> {
  const title = renameDraft.value.trim();
  renamingId.value = null;
  if (!title || title === row.title) return;
  await props.actions.rename(row.conversation_id, title);
}

async function clearWorkFiles(row: ProjectConversationRow): Promise<void> {
  if (clearingId.value) return;
  clearingId.value = row.conversation_id;
  try {
    const cleared = await clearProjectConversationWorkFiles({ conversationId: row.conversation_id, title: titleText(row), message });
    if (cleared) emit('remeasure', row.conversation_id);
  } finally {
    clearingId.value = null;
  }
}

async function handleMenu(action: MenuAction): Promise<void> {
  const row = selectedRow.value;
  if (!row) return;
  switch (action) {
    case 'open': props.actions.open(row.conversation_id); return;
    case 'pin': await props.actions.setPinned(row.conversation_id, !row.is_pinned); return;
    case 'rename':
      renameDraft.value = titleText(row);
      renamingId.value = row.conversation_id;
      // 菜单选中后在下一个宏任务里把焦点还给“更多”按钮；排在它之后再聚焦编辑框，否则编辑框一失焦就提交了。
      await nextTick();
      window.setTimeout(() => {
        renameInputRef.value?.focus();
        renameInputRef.value?.select();
      }, 0);
      return;
    case 'clear': await clearWorkFiles(row); return;
    case 'delete': await props.actions.remove(row.conversation_id, titleText(row)); return;
  }
}
</script>
