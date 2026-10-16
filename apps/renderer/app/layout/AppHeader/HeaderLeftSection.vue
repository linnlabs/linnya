<template>
  <div class="app-header-left" :class="{ 'mac-native': isMac && !isWindowMaximized }">
    <!-- 功能按钮 -->
    <div class="function-buttons">
      <HoverTooltip :text="layoutMessage('layout.header.sidebar')" placement="bottom">
        <IconButton
          :label="layoutMessage('layout.header.sidebar')"
          :tooltip="false"
          class="sidebar-toggle"
          @click="toggleSidebar"
          :class="{ active: uiStore.sidebarVisible }"
        >
          <SidebarIcon />
        </IconButton>
      </HoverTooltip>
      <HoverTooltip :text="layoutMessage('layout.header.knowledgeBase')" placement="bottom">
        <IconButton
          :label="layoutMessage('layout.header.knowledgeBase')"
          :tooltip="false"
          class="knowledge-base-button"
          @click="toggleKnowledgeBase"
        >
          <KnowledgeBaseIcon />
        </IconButton>
      </HoverTooltip>
      <HoverTooltip :text="layoutMessage('layout.header.settings')" placement="bottom">
        <IconButton
          :label="layoutMessage('layout.header.settings')"
          :tooltip="false"
          class="settings-button"
          @click="toggleSettings"
        >
          <SettingsIcon />
        </IconButton>
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
import { HoverTooltip, IconButton } from '@linnya/renderer-ui';
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
