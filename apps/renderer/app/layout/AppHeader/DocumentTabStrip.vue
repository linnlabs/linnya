<template>
  <div class="document-tab-strip">
    <div
      ref="tabsEl"
      class="document-tab-strip__tabs"
      :class="{ 'is-more-left': moreLeft, 'is-more-right': moreRight }"
      role="tablist"
      :aria-label="layoutMessage('layout.tabs.label')"
      @wheel="onTabsWheel"
      @scroll="measureOverflow"
    >
      <div
        v-for="tab in tabsState.tabs"
        :key="tab.id"
        class="document-tab"
        :class="{ 'is-active': tab.id === activeId }"
        role="tab"
        :aria-selected="tab.id === activeId"
        :title="tabTitle(tab)"
        @click="activate(tab)"
        @auxclick.middle.prevent="close([tab.id])"
        @contextmenu.prevent="openTabMenu($event, tab)"
      >
        <component :is="tabIcon(tab)" class="document-tab__icon" />
        <span class="document-tab__title">{{ tabLabel(tab) }}</span>
        <button
          type="button"
          class="document-tab__close"
          :aria-label="layoutMessage('layout.tabs.close')"
          @click.stop="close([tab.id])"
        >
          <CloseIcon />
        </button>
      </div>
    </div>

    <button
      v-if="overflowing"
      ref="allButtonEl"
      type="button"
      class="document-tab-strip__all"
      :class="{ 'is-open': listOpen }"
      :aria-expanded="listOpen"
      :aria-label="layoutMessage('layout.tabs.all', { count: tabsState.tabs.length })"
      :data-linnya-tooltip="listOpen ? undefined : layoutMessage('layout.tabs.all', { count: tabsState.tabs.length })"
      @click="toggleList"
    >
      {{ tabsState.tabs.length }}<ChevronIcon direction="down" />
    </button>

    <!-- 顶栏 pane 裁剪溢出，列表挂到 body 并按按钮位置固定定位。 -->
    <Teleport to="body">
      <DropdownPanel
        :show="listOpen"
        ref="listPanel"
        class="document-tab-strip__list"
        :style="listStyle"
        @keydown.escape="listOpen = false"
      >
        <input
          ref="filterEl"
          v-model="listQuery"
          class="document-tab-strip__filter"
          :placeholder="layoutMessage('layout.tabs.filter')"
          :aria-label="layoutMessage('layout.tabs.filter')"
        />
        <div class="document-tab-strip__list-caption">{{ layoutMessage('layout.tabs.recentCaption') }}</div>
        <div
          v-for="tab in listedTabs"
          :key="tab.id"
          class="document-tab-strip__list-item"
          :class="{ 'is-active': tab.id === activeId }"
          @click="activate(tab); listOpen = false"
        >
          <component :is="tabIcon(tab)" class="document-tab__icon" />
          <span class="document-tab__title">{{ tabLabel(tab) }}</span>
          <button
            type="button"
            class="document-tab__close"
            :aria-label="layoutMessage('layout.tabs.close')"
            @click.stop="close([tab.id])"
          >
            <CloseIcon />
          </button>
        </div>
        <div v-if="!listedTabs.length" class="document-tab-strip__list-empty">
          {{ layoutMessage('layout.tabs.noMatch') }}
        </div>
      </DropdownPanel>
    </Teleport>

    <Teleport to="body">
      <transition name="app-header-menu-fade">
        <div v-if="tabMenu" class="document-tab-strip__menu" :style="tabMenu.style">
          <CustomSelect
            :model-value="null"
            :options="tabMenuOptions"
            :manual-mode="true"
            variant="minimal"
            :bordered="false"
            @update:model-value="handleTabMenuSelect"
            @close="tabMenu = null"
          />
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component, type CSSProperties } from 'vue';
import { CustomSelect, DropdownPanel, type CustomSelectOption } from '@linnya/renderer-ui';
import { ChevronIcon, CloseIcon, DocumentIcon } from '@linnya/renderer-ui/icons';
import { useDocumentTabsStore, type DocumentTab } from '@/app/document-tabs';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import {
  activateDocumentTab,
  closeDocumentTabIds,
  closeDocumentTabIdsToRight,
  closeOtherDocumentTabIds,
  cycleDocumentTab,
  reopenClosedDocumentTab,
} from '@/app/layout/orchestration/documentTabs';
import { getDocumentTypeByActiveType } from '@/app/plugins/registry';
import { useWorkspaceTree } from '@/domains/workspace/tree';
import { resolveWorkspaceNodeDisplayName } from '@/domains/workspace/functions/resolveWorkspaceNodeDisplayName';

/**
 * 文档区顶部的标签栏：替代原来的“项目 / 文档名”。标签按项目分组、只在内存里；
 * 放不下时横向滚动，两端按需淡出，右端“全部标签”按最近使用列出并可筛选。
 */
const props = defineProps<{ readonly projectId: string }>();

const tabsStore = useDocumentTabsStore();
const layoutStore = useLayoutStore();
const treeStore = useWorkspaceTree();
const { layoutMessage } = useLayoutLocalization();
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const tabsState = computed(() => tabsStore.stateFor(props.projectId));
const activeId = computed(() => layoutStore.state.activeDocument?.id ?? null);

function tabLabel(tab: DocumentTab): string {
  const node = treeStore.findNodeById(tab.id);
  if (node) return resolveWorkspaceNodeDisplayName(node, node.name);
  return tab.displayName ?? tab.id;
}

function tabTitle(tab: DocumentTab): string {
  const path: string[] = [];
  let node = treeStore.findNodeById(tab.id);
  while (node) {
    path.unshift(resolveWorkspaceNodeDisplayName(node, node.name));
    node = node.parentId ? treeStore.findNodeById(node.parentId) : null;
  }
  return path.length ? path.join(' / ') : tabLabel(tab);
}

function tabIcon(tab: DocumentTab): Component {
  return getDocumentTypeByActiveType(tab.type)?.iconComponent ?? DocumentIcon;
}

function activate(tab: DocumentTab): void {
  if (tab.id === activeId.value) return;
  void activateDocumentTab(tab);
}

function close(ids: readonly string[]): void {
  void closeDocumentTabIds(props.projectId, ids);
}

/* ---------- 溢出：横向滚动、两端淡出、当前标签滚进视野 ---------- */
const tabsEl = ref<HTMLElement | null>(null);
const overflowing = ref(false);
const moreLeft = ref(false);
const moreRight = ref(false);

function measureOverflow(): void {
  const el = tabsEl.value;
  overflowing.value = !!el && el.scrollWidth > el.clientWidth + 1;
  moreLeft.value = !!el && el.scrollLeft > 1;
  moreRight.value = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function scrollActiveIntoView(): void {
  tabsEl.value
    ?.querySelector<HTMLElement>('.document-tab.is-active')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  measureOverflow();
}

/** 竖向滚轮也横向滚动标签栏。 */
function onTabsWheel(event: WheelEvent): void {
  const el = tabsEl.value;
  if (!el || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  el.scrollLeft += event.deltaY;
  event.preventDefault();
}

let resizeObserver: ResizeObserver | null = null;
watch(() => [activeId.value, tabsState.value.tabs.length] as const, () => void nextTick(scrollActiveIntoView));

/* ---------- 全部标签 ---------- */
const listQuery = ref('');
const listOpen = ref(false);
const listStyle = ref<CSSProperties>({});
const allButtonEl = ref<HTMLButtonElement | null>(null);
const filterEl = ref<HTMLInputElement | null>(null);
const listPanel = ref<{ element: HTMLDivElement | null } | null>(null);

function toggleList(): void {
  if (listOpen.value) {
    listOpen.value = false;
    return;
  }
  const rect = allButtonEl.value?.getBoundingClientRect();
  if (!rect) return;
  listQuery.value = '';
  listStyle.value = { top: `${rect.bottom + 6}px`, right: `${Math.max(8, window.innerWidth - rect.right)}px` };
  listOpen.value = true;
  void nextTick(() => filterEl.value?.focus());
}

function handleListOutsidePointerDown(event: PointerEvent): void {
  if (!listOpen.value || !(event.target instanceof Node)) return;
  if (listPanel.value?.element?.contains(event.target) || allButtonEl.value?.contains(event.target)) return;
  listOpen.value = false;
}

watch(overflowing, (value) => {
  if (!value) listOpen.value = false;
});
const listedTabs = computed(() => {
  const query = listQuery.value.trim().toLowerCase();
  const { tabs, recent } = tabsState.value;
  const ordered = [
    ...recent.map(id => tabs.find(tab => tab.id === id)).filter((tab): tab is DocumentTab => !!tab),
    ...tabs.filter(tab => !recent.includes(tab.id)),
  ];
  return query ? ordered.filter(tab => tabLabel(tab).toLowerCase().includes(query)) : ordered;
});

/* ---------- 右键菜单 ---------- */
type TabMenuAction = 'close' | 'close-others' | 'close-right' | 'close-all' | 'reopen';
const tabMenu = ref<{ readonly tabId: string; readonly style: CSSProperties } | null>(null);

const tabMenuOptions = computed<CustomSelectOption<TabMenuAction>[]>(() => {
  const { tabs, closed } = tabsState.value;
  const index = tabs.findIndex(tab => tab.id === tabMenu.value?.tabId);
  return [
    { value: 'close', text: layoutMessage('layout.tabs.close'), shortcut: isMac ? '⌘W' : 'Ctrl+W' },
    { value: 'close-others', text: layoutMessage('layout.tabs.closeOthers'), disabled: tabs.length < 2 },
    { value: 'close-right', text: layoutMessage('layout.tabs.closeRight'), disabled: index < 0 || index === tabs.length - 1 },
    { value: 'close-all', text: layoutMessage('layout.tabs.closeAll') },
    { isSeparator: true, value: null, text: '' },
    {
      value: 'reopen',
      text: layoutMessage('layout.tabs.reopenClosed'),
      shortcut: isMac ? '⇧⌘T' : 'Ctrl+Shift+T',
      disabled: !closed.some(tab => !tabs.some(open => open.id === tab.id)),
    },
  ];
});

function openTabMenu(event: MouseEvent, tab: DocumentTab): void {
  const gap = 8;
  tabMenu.value = {
    tabId: tab.id,
    style: {
      top: `${Math.min(event.clientY, window.innerHeight - gap)}px`,
      left: `${Math.min(event.clientX, window.innerWidth - gap)}px`,
    },
  };
}

function handleTabMenuSelect(action: TabMenuAction | null): void {
  const tabId = tabMenu.value?.tabId;
  tabMenu.value = null;
  if (!tabId || !action) return;
  if (action === 'close') close([tabId]);
  else if (action === 'close-others') void closeOtherDocumentTabIds(props.projectId, tabId);
  else if (action === 'close-right') void closeDocumentTabIdsToRight(props.projectId, tabId);
  else if (action === 'close-all') close(tabsState.value.tabs.map(tab => tab.id));
  else void reopenClosedDocumentTab(props.projectId);
}

/* ---------- 快捷键：Ctrl+Tab 按最近使用切换、⌘W 关闭、⇧⌘T 重新打开 ---------- */
function handleKeydown(event: KeyboardEvent): void {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && key === 'tab') {
    event.preventDefault();
    void cycleDocumentTab(props.projectId, event.shiftKey ? -1 : 1);
    return;
  }
  if (mod && !event.altKey && key === 'w' && !event.shiftKey) {
    if (!activeId.value) return;
    event.preventDefault();
    close([activeId.value]);
    return;
  }
  if (mod && !event.altKey && key === 't' && event.shiftKey) {
    event.preventDefault();
    void reopenClosedDocumentTab(props.projectId);
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(measureOverflow);
  if (tabsEl.value) resizeObserver.observe(tabsEl.value);
  void nextTick(scrollActiveIntoView);
  window.addEventListener('keydown', handleKeydown);
  document.addEventListener('pointerdown', handleListOutsidePointerDown, true);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('pointerdown', handleListOutsidePointerDown, true);
});
</script>
