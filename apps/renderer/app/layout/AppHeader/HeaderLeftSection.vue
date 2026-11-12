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
          <LibraryIcon />
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
      <UpdateEntry
        :available-width="updateEntryAvailableWidth"
        @width-change="emit('updateEntryWidthChange', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { SettingsIcon } from '@linnya/renderer-ui/icons';
import { LibraryIcon } from '@linnya/renderer-ui/icons';
import { SidebarIcon } from '@linnya/renderer-ui/icons';
import { HoverTooltip, IconButton } from '@linnya/renderer-ui';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import UpdateEntry from '@/app/update/ui/UpdateEntry.vue';
import { useSidebarLayoutWidth } from '@/app/layout/composables/useSidebarLayoutWidth';
import { computeHeaderUpdateEntryAvailableWidth } from '@/app/layout/functions/headerPaneGeometry';

const props = defineProps<{
  isMac: boolean;
  isWindowMaximized: boolean;
}>();

const emit = defineEmits<{
  updateEntryWidthChange: [width: number];
}>();

const uiStore = useUIStore();
const { sidebarOccupiedWidth } = useSidebarLayoutWidth();
const updateEntryAvailableWidth = computed(() => computeHeaderUpdateEntryAvailableWidth({
  isMac: props.isMac,
  isWindowMaximized: props.isWindowMaximized,
  sidebarOccupiedWidth: sidebarOccupiedWidth.value,
}));
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
