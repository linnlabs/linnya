<!-- apps/renderer/domains/settings/ui/SettingsModal.vue -->
<template>
  <div
    class="settings-modal-overlay"
    @click.self="closeSettings"
  >
    <div
      class="settings-modal-container"
      role="dialog"
      aria-modal="true"
      :aria-label="settingsMessage('settings.modal.title')"
    >
      <nav
        ref="navRef"
        class="settings-modal-nav"
      >
        <div class="settings-modal-nav-title">
          {{ settingsMessage('settings.modal.title') }}
        </div>

        <div
          class="settings-modal-nav-scroll"
          role="tablist"
          aria-orientation="vertical"
          :aria-label="settingsMessage('settings.modal.title')"
        >
          <div
            v-for="group in navigationGroups"
            :key="group.group"
            class="settings-modal-nav-group"
            :class="{ 'is-untitled': group.titleMessageKey === null }"
          >
            <div
              v-if="group.titleMessageKey"
              class="settings-modal-nav-group-title"
            >
              {{ settingsMessage(group.titleMessageKey) }}
            </div>

            <button
              v-for="tab in group.items"
              :id="tabButtonId(tab.id)"
              :key="tab.id"
              type="button"
              role="tab"
              class="settings-modal-nav-item"
              :class="{ 'is-active': activeTab === tab.id }"
              :aria-selected="activeTab === tab.id"
              :aria-controls="tabPanelId(tab.id)"
              :tabindex="activeTab === tab.id ? 0 : -1"
              :data-tab-id="tab.id"
              @click="activateTab(tab.id)"
              @keydown="handleNavKeyDown"
            >
              {{ getTabTitle(tab) }}
            </button>
          </div>
        </div>
      </nav>

      <section class="settings-modal-panel">
        <!-- 关闭按钮浮在面板右上角不随内容滚动；正文右侧留出让位内边距，内容不会滑到按钮底下。 -->
        <button
          type="button"
          class="settings-modal-close"
          :aria-label="settingsMessage('settings.modal.close')"
          @click="closeSettings"
        >
          <CloseIcon />
        </button>

        <div
          v-if="activeContribution"
          :id="tabPanelId(activeContribution.id)"
          class="settings-modal-panel-body"
          role="tabpanel"
          tabindex="0"
          :aria-labelledby="tabButtonId(activeContribution.id)"
        >
          <h2 class="settings-modal-panel-title">
            {{ getTabTitle(activeContribution) }}
          </h2>
          <component
            :is="activeContribution.component"
            :key="activeContribution.id"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useLocalization } from '@/app/localization';
import { useUIStore } from '../../../shared/stores/ui';
import type { SettingsContribution } from '../definitions/settingsContribution';
import { listSettingsContributions } from '../registry/settingsRegistry';
import {
  flattenSettingsNavigation,
  groupSettingsContributions,
} from '../functions/groupSettingsContributions';
import { resolveSettingsContributionTitle } from '../functions/resolveSettingsContributionTitle';
import { useSettingsLocalization } from './useSettingsLocalization';
import { CloseIcon } from '@linnya/renderer-ui/icons';

const uiStore = useUIStore();
const { message } = useLocalization();
const { settingsMessage } = useSettingsLocalization();
const activeTab = ref(uiStore.settingsInitialTabId ?? 'appearance');
const navRef = ref<HTMLElement | null>(null);

const settingsTabs = computed(() => listSettingsContributions());
const navigationGroups = computed(() => groupSettingsContributions(settingsTabs.value));
const navigationTabIds = computed(() => flattenSettingsNavigation(navigationGroups.value));
const activeContribution = computed(() => {
  return settingsTabs.value.find((tab) => tab.id === activeTab.value) ?? settingsTabs.value[0] ?? null;
});

watch(
  settingsTabs,
  (tabs) => {
    const requestedTabId = uiStore.settingsInitialTabId;
    if (requestedTabId && tabs.some((tab) => tab.id === requestedTabId)) {
      activeTab.value = requestedTabId;
      return;
    }
    if (!tabs.some((tab) => tab.id === activeTab.value) && tabs[0]) {
      activeTab.value = tabs[0].id;
    }
  },
  { immediate: true },
);

const closeSettings = () => {
  uiStore.closeSettingsModal();
};

watch(
  () => uiStore.settingsInitialTabId,
  (tabId) => {
    if (!tabId) return;
    if (settingsTabs.value.some((tab) => tab.id === tabId)) {
      activeTab.value = tabId;
    }
  },
);

function tabButtonId(tabId: string): string {
  return `settings-tab-${tabId}`;
}

function tabPanelId(tabId: string): string {
  return `settings-panel-${tabId}`;
}

function getTabTitle(tab: SettingsContribution): string {
  return resolveSettingsContributionTitle(tab, message);
}

function activateTab(tabId: string): void {
  activeTab.value = tabId;
}

/**
 * 侧栏是垂直 tablist：方向键在分组之间连续移动（分组标题不参与焦点循环），
 * Home / End 直达首尾。切换即激活，与原来的点击行为一致。
 */
function handleNavKeyDown(event: KeyboardEvent): void {
  const tabIds = navigationTabIds.value;
  if (tabIds.length === 0) return;

  const currentIndex = tabIds.indexOf(activeTab.value);
  if (currentIndex < 0) return;

  let nextIndex: number | null = null;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabIds.length;
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = tabIds.length - 1;
  }

  if (nextIndex === null) return;

  event.preventDefault();
  const nextTabId = tabIds[nextIndex];
  if (!nextTabId) return;

  activateTab(nextTabId);
  void nextTick(() => focusTabButton(nextTabId));
}

function focusTabButton(tabId: string): void {
  const buttons = navRef.value?.querySelectorAll<HTMLButtonElement>('[data-tab-id]');
  if (!buttons) return;

  for (const button of buttons) {
    if (button.dataset.tabId === tabId) {
      button.focus();
      return;
    }
  }
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeSettings();
  }
};

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
