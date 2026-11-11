<!--
  文件页那一排保存的筛选：全部文件 + 固定的筛选（放不下的收进“更多”）+ “Agent 建议”。
  右键一项可重命名或删除。数据与写入交给页面，这里只负责排布、菜单和弹出层。
-->
<template>
  <div class="project-overview__saved">
    <div ref="tabsHostRef" class="project-overview__saved-tabs" @contextmenu="openContextMenu">
      <SegmentedTabs
        :model-value="tabValue"
        :tabs="tabs"
        :aria-label="labels.ariaLabel"
        @update:model-value="selectTab"
      />
    </div>
    <template v-if="suggestions.length > 0">
      <span class="project-overview__saved-separator" aria-hidden="true" />
      <span ref="suggestTriggerRef" class="project-overview__saved-suggest" :class="{ 'is-active': activeSuggestion !== null }">
        <BaseButton
          variant="plain"
          size="sm"
          aria-haspopup="dialog"
          :aria-expanded="openMenu === 'suggestions'"
          @click="toggle('suggestions')"
        >
          {{ activeSuggestion ? labels.suggestionActive(activeSuggestion.name) : labels.suggestions(suggestions.length) }}
        </BaseButton>
      </span>
    </template>

    <Teleport to="body">
      <Transition name="project-overview-filter-menu-fade">
        <div
          v-if="openMenu === 'suggestions'"
          ref="suggestPanelRef"
          :class="[DROPDOWN_SURFACE_CLASSES.root, DROPDOWN_SURFACE_CLASSES.panel, 'project-overview-suggestions']"
          :style="suggestStyle"
          role="dialog"
          :aria-label="labels.suggestions(suggestions.length)"
          @keydown.esc.stop="openMenu = null"
        >
          <div
            v-for="filter in suggestions"
            :key="filter.id"
            class="project-overview-suggestions__item"
            :class="{ 'is-active': filter.id === activeId }"
          >
            <button type="button" class="project-overview-suggestions__open" @click="chooseSuggestion(filter.id)">
              <span class="project-overview-suggestions__name">{{ filter.name }}</span>
              <span v-if="summary(filter)" class="project-overview-suggestions__meta">{{ summary(filter) }}</span>
            </button>
            <BaseButton variant="plain" size="sm" @click="pin(filter.id)">
              <template #icon><PinIcon /></template>
              {{ labels.pin }}
            </BaseButton>
          </div>
          <p class="project-overview-suggestions__foot">{{ labels.suggestionsFooter }}</p>
        </div>
      </Transition>
      <Transition name="project-overview-filter-menu-fade">
        <div
          v-if="openMenu === 'more' || openMenu === 'context'"
          ref="menuRef"
          class="project-overview-filter__menu"
          :style="menuStyle"
        >
          <CustomSelect
            :model-value="openMenu === 'more' ? activeId : null"
            :options="openMenu === 'more' ? overflowOptions : contextOptions"
            :manual-mode="true"
            :parent-is-open="true"
            semantic-role="menu"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="menuAnchor"
            :enable-keyboard-nav="true"
            :show-selected-checkmark="openMenu === 'more'"
            options-max-height="320px"
            option-label-overflow="ellipsis"
            :class-names="{ options: 'project-overview-filter__options' }"
            @update:model-value="chooseMenuItem"
            @close="openMenu = null"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ProjectSavedFilter } from '@app/schemas';
import {
  BaseButton,
  CustomSelect,
  DROPDOWN_SURFACE_CLASSES,
  SegmentedTabs,
  type CustomSelectOption,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { PinIcon } from '@linnya/renderer-ui/icons';
import { useFixedDropdownPosition } from '@/domains/workspace/ui/sidebar';
import { ALL_FILES_FILTER_ID, arrangeSavedFilters } from '../functions/projectSavedFilters';

export interface ProjectSavedFiltersBarLabels {
  readonly ariaLabel: string;
  readonly allFiles: string;
  readonly more: (count: number) => string;
  readonly suggestions: (count: number) => string;
  readonly suggestionActive: (name: string) => string;
  readonly pin: string;
  readonly suggestionsFooter: string;
  readonly rename: string;
  readonly remove: string;
}

const props = defineProps<{
  pinned: readonly ProjectSavedFilter[];
  suggestions: readonly ProjectSavedFilter[];
  activeId: string;
  labels: ProjectSavedFiltersBarLabels;
  summary: (filter: ProjectSavedFilter) => string;
}>();

const emit = defineEmits<{
  select: [id: string];
  rename: [id: string, anchor: HTMLElement];
  remove: [id: string];
  pin: [id: string];
}>();

const MORE = '__more__';
type Menu = 'suggestions' | 'more' | 'context';

const arranged = computed(() => arrangeSavedFilters(props.pinned, props.activeId));
const tabs = computed<SegmentedTabItem[]>(() => [
  { id: ALL_FILES_FILTER_ID, label: props.labels.allFiles },
  ...arranged.value.visible.map(filter => ({ id: filter.id, label: filter.name })),
  ...(arranged.value.overflow.length > 0 ? [{ id: MORE, label: props.labels.more(arranged.value.overflow.length) }] : []),
]);
const tabValue = computed(() => (tabs.value.some(tab => tab.id === props.activeId) ? props.activeId : ''));
const activeSuggestion = computed(() => props.suggestions.find(filter => filter.id === props.activeId) ?? null);

const openMenu = ref<Menu | null>(null);
const tabsHostRef = ref<HTMLElement | null>(null);
const suggestTriggerRef = ref<HTMLElement | null>(null);
const menuAnchor = ref<HTMLElement | null>(null);
const contextTargetId = ref<string | null>(null);

const { dropdownRef: menuRef, dropdownStyle: menuStyle, positionDropdownAfterRender: positionMenu } = useFixedDropdownPosition({ align: 'start' });
const {
  dropdownRef: suggestPanelRef,
  dropdownStyle: suggestStyle,
  positionDropdownAfterRender: positionSuggestions,
} = useFixedDropdownPosition({ align: 'start' });

function tabButton(id: string): HTMLElement | null {
  const index = tabs.value.findIndex(tab => tab.id === id);
  return tabsHostRef.value?.querySelectorAll<HTMLElement>('.segmented-tabs__button')[index] ?? null;
}

function toggle(menu: Menu): void {
  openMenu.value = openMenu.value === menu ? null : menu;
}

watch(openMenu, menu => {
  if (menu === 'suggestions') void positionSuggestions(suggestTriggerRef.value);
  if (menu === 'more' || menu === 'context') void positionMenu(menuAnchor.value);
}, { flush: 'post' });

function selectTab(id: string): void {
  if (id !== MORE) {
    emit('select', id);
    return;
  }
  menuAnchor.value = tabButton(MORE);
  toggle('more');
}

const overflowOptions = computed<CustomSelectOption<string>[]>(() => (
  arranged.value.overflow.map(filter => ({ value: filter.id, text: filter.name }))
));
const contextOptions = computed<CustomSelectOption<string>[]>(() => [
  { value: 'rename', text: props.labels.rename },
  { value: 'remove', text: props.labels.remove },
]);

/** 右键固定的筛选：重命名、删除。“全部文件”和“更多”没有菜单。 */
function openContextMenu(event: MouseEvent): void {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.segmented-tabs__button') : null;
  if (!button || !tabsHostRef.value) return;
  const index = [...tabsHostRef.value.querySelectorAll('.segmented-tabs__button')].indexOf(button);
  const id = tabs.value[index]?.id;
  if (!id || id === ALL_FILES_FILTER_ID || id === MORE) return;
  event.preventDefault();
  contextTargetId.value = id;
  menuAnchor.value = button;
  openMenu.value = null;
  openMenu.value = 'context';
}

function chooseMenuItem(value: string | null): void {
  const menu = openMenu.value;
  openMenu.value = null;
  if (value === null) return;
  if (menu === 'more') {
    emit('select', value);
    return;
  }
  const id = contextTargetId.value;
  if (!id) return;
  if (value === 'remove') emit('remove', id);
  else {
    const anchor = tabButton(id);
    if (anchor) emit('rename', id, anchor);
  }
}

function chooseSuggestion(id: string): void {
  openMenu.value = null;
  emit('select', id);
}

function pin(id: string): void {
  openMenu.value = null;
  emit('pin', id);
}

// 建议弹层是自定义内容，点外面关闭（菜单由 CustomSelect 自己处理）。
function closeOnOutside(event: PointerEvent): void {
  if (openMenu.value !== 'suggestions') return;
  const target = event.target instanceof Node ? event.target : null;
  if (target && (suggestPanelRef.value?.contains(target) || suggestTriggerRef.value?.contains(target))) return;
  openMenu.value = null;
}
watch(openMenu, menu => {
  if (menu === 'suggestions') document.addEventListener('pointerdown', closeOnOutside, true);
  else document.removeEventListener('pointerdown', closeOnOutside, true);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutside, true));
</script>
