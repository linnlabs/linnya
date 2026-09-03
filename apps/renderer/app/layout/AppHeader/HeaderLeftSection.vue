<template>
  <div class="app-header-left" :class="{ 'mac-native': isMac && !isWindowMaximized }">
    <!-- 功能按钮 -->
    <div class="function-buttons">
      <HoverTooltip :text="layoutMessage('layout.header.sidebar')" placement="bottom">
        <button
          class="sidebar-toggle"
          type="button"
          :aria-label="layoutMessage('layout.header.sidebar')"
          @click="toggleSidebar"
          :class="{ active: uiStore.sidebarVisible }"
        >
          <SidebarIcon />
        </button>
      </HoverTooltip>
      <HoverTooltip :text="layoutMessage('layout.header.knowledgeBase')" placement="bottom">
        <button
          class="knowledge-base-button"
          type="button"
          :aria-label="layoutMessage('layout.header.knowledgeBase')"
          @click="toggleKnowledgeBase"
        >
          <KnowledgeBaseIcon />
        </button>
      </HoverTooltip>
      <HoverTooltip :text="layoutMessage('layout.header.settings')" placement="bottom">
        <button
          class="settings-button"
          type="button"
          :aria-label="layoutMessage('layout.header.settings')"
          @click="toggleSettings"
        >
          <SettingsIcon />
        </button>
      </HoverTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from '@/shared/stores/ui';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { SettingsIcon } from '@linnya/renderer-ui/icons';
import { KnowledgeBaseIcon } from '@linnya/renderer-ui/icons';
import { SidebarIcon } from '@linnya/renderer-ui/icons';
import { HoverTooltip } from '@linnya/renderer-ui';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

const props = defineProps<{
  isMac: boolean;
  isWindowMaximized: boolean;
}>();

const uiStore = useUIStore();
const navigation = getWorkspaceNavigationPort();
const { layoutMessage } = useLayoutLocalization();

const toggleSidebar = () => {
  uiStore.toggleSidebar();
};

const toggleSettings = () => {
  uiStore.toggleSettingsModal();
};

const toggleKnowledgeBase = () => {
  void navigation.openKnowledgeBase();
};
</script>
