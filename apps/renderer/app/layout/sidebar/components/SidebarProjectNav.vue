<template>
  <div class="project-nav-top">
    <div class="project-nav-header">
      <HoverTooltip :text="layoutMessage('layout.sidebar.project.back')" placement="bottom">
        <button
          class="project-nav-back-button"
          type="button"
          :aria-label="layoutMessage('layout.sidebar.project.back')"
          @click="$emit('back')"
        >
          <ChevronIcon class="project-nav-back-icon" direction="left" />
        </button>
      </HoverTooltip>

      <div class="project-nav-title" :title="projectName">
        {{ projectName }}
      </div>

      <div class="project-nav-tabs" role="group" :aria-label="layoutMessage('layout.sidebar.project.viewGroup')">
        <button
          class="project-nav-tab"
          :class="{ 'is-selected': sidebarMode === 'chat' }"
          type="button"
          :title="layoutMessage('layout.sidebar.project.chat')"
          :aria-label="layoutMessage('layout.sidebar.project.chat')"
          @click="$emit('set-mode', 'chat')"
        >
          <ChatIcon class="project-nav-tab-icon" />
        </button>
        <button
          class="project-nav-tab"
          :class="{ 'is-selected': sidebarMode === 'files' }"
          type="button"
          :title="layoutMessage('layout.sidebar.project.files')"
          :aria-label="layoutMessage('layout.sidebar.project.files')"
          @click="$emit('set-mode', 'files')"
        >
          <FolderIcon class="project-nav-tab-icon" />
        </button>
      </div>
    </div>

    <button
      v-if="sidebarMode === 'chat'"
      class="project-nav-create-button"
      type="button"
      @click="$emit('new-conversation')"
    >
      <AddIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.project.newConversation') }}</span>
    </button>

    <label
      v-if="sidebarMode === 'chat'"
      class="project-nav-search"
    >
      <SearchIcon class="project-nav-search-icon" />
      <input
        :value="chatSearchQuery"
        class="project-nav-search-input"
        type="search"
        :aria-label="layoutMessage('layout.sidebar.project.searchChats')"
        :placeholder="layoutMessage('layout.sidebar.project.searchChats')"
        @input="handleChatSearchInput"
      />
    </label>

    <button
      v-if="sidebarMode === 'files'"
      ref="projectCreateButtonRef"
      class="project-nav-create-button"
      type="button"
      @click="$emit('toggle-create-menu')"
    >
      <AddIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.project.create') }}</span>
    </button>

    <label
      v-if="sidebarMode === 'files'"
      class="project-nav-search"
    >
      <SearchIcon class="project-nav-search-icon" />
      <input
        :value="fileSearchQuery"
        class="project-nav-search-input"
        type="search"
        :aria-label="layoutMessage('layout.sidebar.project.searchFiles')"
        :placeholder="layoutMessage('layout.sidebar.project.searchFiles')"
        @input="handleFileSearchInput"
      />
    </label>

    <Teleport to="body">
      <transition name="workspace-project-create-menu-fade">
        <div
          v-if="showCreateMenu"
            ref="projectCreateDropdownRef"
            class="project-create-menu-wrapper"
            :style="projectCreateDropdownStyle"
        >
          <CustomSelect
            :model-value="null"
            :options="createOptions"
            :manual-mode="true"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="projectCreateButtonRef"
            :class-names="{ options: 'project-create-menu-options' }"
            @update:model-value="$emit('create-selection', $event)"
            @close="$emit('close-create-menu')"
          />
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { ChatIcon } from '@linnya/renderer-ui/icons';
import { FolderIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { SearchIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect, HoverTooltip } from '@linnya/renderer-ui';
import { useFixedDropdownPosition } from '@/domains/workspace/ui/sidebar';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

export type WorkspaceSidebarMode = 'chat' | 'files';

export interface ProjectCreateOption {
  value?: string;
  text?: string;
  isSeparator?: boolean;
}

const props = defineProps<{
  projectName: string;
  sidebarMode: WorkspaceSidebarMode;
  chatSearchQuery: string;
  fileSearchQuery: string;
  showCreateMenu: boolean;
  createOptions: ProjectCreateOption[];
}>();

const emit = defineEmits<{
  back: [];
  'set-mode': [mode: WorkspaceSidebarMode];
  'new-conversation': [];
  'toggle-create-menu': [];
  'close-create-menu': [];
  'create-selection': [value: string | null];
  'update:chat-search-query': [query: string];
  'update:file-search-query': [query: string];
}>();

const { layoutMessage } = useLayoutLocalization();
const projectCreateButtonRef = ref<HTMLButtonElement | null>(null);
const {
  dropdownRef: projectCreateDropdownRef,
  dropdownStyle: projectCreateDropdownStyle,
  positionDropdownAfterRender: positionProjectCreateDropdownAfterRender,
} = useFixedDropdownPosition({ matchTriggerWidth: true });

watch(
  () => props.showCreateMenu,
  (showCreateMenu) => {
    if (!showCreateMenu) return;
    void positionProjectCreateDropdownAfterRender(projectCreateButtonRef.value);
  },
  { flush: 'post' },
);

defineExpose({
  projectCreateButtonRef,
  projectCreateDropdownRef,
  positionProjectCreateDropdownAfterRender,
});

function readInputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : '';
}

function handleChatSearchInput(event: Event): void {
  emit('update:chat-search-query', readInputValue(event));
}

function handleFileSearchInput(event: Event): void {
  emit('update:file-search-query', readInputValue(event));
}
</script>
