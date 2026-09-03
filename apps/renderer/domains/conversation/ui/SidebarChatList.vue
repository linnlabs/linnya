<template>
  <div
    class="workspace-sidebar-row-list sidebar-chat-list"
    :class="[
      `sidebar-chat-list--${variant}`,
      `sidebar-chat-list--${surface}`,
    ]"
  >
    <div v-if="shouldShowInitialLoading" class="chat-list-state">
      {{ conversationMessage('conversation.sidebar.loading') }}
    </div>
    <div v-else-if="error" class="chat-list-state is-error">
      {{ conversationMessage('conversation.sidebar.loadFailed') }}
    </div>
    <div
      v-else-if="filteredConversations.length === 0"
      class="chat-list-state"
    >
      {{ normalizedSearchQuery
        ? conversationMessage('conversation.sidebar.empty.noMatch')
        : conversationMessage('conversation.sidebar.empty.noConversations') }}
    </div>
    <template v-else>
      <div
        v-for="conversation in visibleConversations"
        :key="conversation.conversation_id"
        class="workspace-sidebar-row chat-list-item"
        :class="{
          'is-active': isConversationActive(conversation.conversation_id),
          'is-selected': isConversationBatchSelected(conversation.conversation_id),
          'is-pinned': conversation.is_pinned === true,
          'is-deleting': isConversationDeleting(conversation.conversation_id),
          'is-cleanup-pending': conversation.cleanup_pending === true,
          'is-renaming': editingConversationId === conversation.conversation_id,
          'is-history-reveal-pulse': isHistoryRevealPulseActive,
        }"
        role="button"
        :tabindex="isConversationUnavailable(conversation) ? -1 : 0"
        :aria-disabled="isConversationUnavailable(conversation) ? 'true' : undefined"
        @click="handleClickConversation($event, conversation)"
        @contextmenu.prevent="handleContextMenu($event, conversation)"
        @keydown.enter.prevent="handleSelectConversation(conversation)"
        @keydown.space.prevent="handleSelectConversation(conversation)"
      >
        <span class="workspace-sidebar-row-icon chat-list-status-slot">
          <PinIcon
            v-if="conversation.is_pinned === true"
            class="chat-list-status-icon"
          />
        </span>
        <input
          v-if="editingConversationId === conversation.conversation_id"
          :ref="setRenameInputRef"
          v-model="editingTitle"
          class="chat-list-rename-input"
          type="text"
          @blur="confirmRename(conversation)"
          @click.stop
          @keydown.enter.stop.prevent="confirmRename(conversation)"
          @keydown.esc.stop.prevent="cancelRename"
          @keydown.stop
        />
        <span v-else class="workspace-sidebar-row-label chat-list-title">
          {{ conversation.title || conversationMessage('conversation.sidebar.untitled') }}
        </span>
        <span
          v-if="editingConversationId !== conversation.conversation_id"
          class="chat-list-time"
        >
          {{ isConversationDeleting(conversation.conversation_id)
            ? conversationMessage('conversation.sidebar.deleting')
            : conversation.cleanup_pending === true
              ? conversationMessage('conversation.sidebar.cleanupPending')
              : formatListTime(conversation.last_event_at) }}
        </span>
        <span
          v-if="editingConversationId !== conversation.conversation_id"
          class="workspace-sidebar-row-actions chat-list-actions"
          @click.stop
        >
          <button
            :ref="(element) => setMenuButtonRef(conversation.conversation_id, element)"
            class="workspace-sidebar-row-action-button chat-list-action-button"
            type="button"
            :disabled="isConversationDeleting(conversation.conversation_id)"
            :title="conversationMessage('conversation.sidebar.moreOptions')"
            @click.stop="toggleMoreMenu(conversation)"
          >
            <MoreIcon direction="horizontal" />
          </button>
        </span>
      </div>

      <button
        v-if="shouldShowExpandControl"
        class="chat-list-toggle-row"
        type="button"
        @click="expandConversationList"
      >
        {{ conversationMessage('conversation.sidebar.expand') }}
      </button>

      <button
        v-else-if="shouldShowCollapseControl"
        class="chat-list-toggle-row"
        type="button"
        @click="collapseConversationList"
      >
        {{ conversationMessage('conversation.sidebar.collapse') }}
      </button>
    </template>

    <Teleport to="body">
      <Transition name="sidebar-chat-menu-fade">
        <div
          v-if="activeMenuConversation"
          ref="menuDropdownRef"
          class="sidebar-chat-menu-wrapper"
          :style="menuDropdownStyle"
        >
          <CustomSelect
            :model-value="null"
            :options="activeMenuOptions"
            :manual-mode="true"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="activeMenuButtonRef"
            @update:model-value="handleMenuSelect"
            @close="closeMoreMenu"
          />
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="sidebar-chat-menu-fade">
        <div
          v-if="contextMenuConversation"
          ref="contextMenuDropdownRef"
          class="sidebar-chat-menu-wrapper"
          :style="contextMenuDropdownStyle"
        >
          <CustomSelect
            :model-value="null"
            :options="contextMenuOptions"
            :manual-mode="true"
            variant="minimal"
            :bordered="false"
            @update:model-value="handleContextMenuSelect"
            @close="closeContextMenu"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useSidebarChatList } from './sidebarChatList/useSidebarChatList';
import type { SidebarChatListEmit, SidebarChatListProps } from './sidebarChatList/definitions';
import { PinIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
const props = defineProps<SidebarChatListProps>();
const emit = defineEmits<SidebarChatListEmit>();

const {
  variant,
  surface,
  conversationMessage,
  shouldShowInitialLoading,
  error,
  filteredConversations,
  normalizedSearchQuery,
  visibleConversations,
  isConversationActive,
  isConversationBatchSelected,
  isConversationDeleting,
  isConversationUnavailable,
  isHistoryRevealPulseActive,
  editingConversationId,
  editingTitle,
  setMenuButtonRef,
  setRenameInputRef,
  confirmRename,
  cancelRename,
  formatListTime,
  toggleMoreMenu,
  shouldShowExpandControl,
  expandConversationList,
  shouldShowCollapseControl,
  collapseConversationList,
  activeMenuConversation,
  menuDropdownRef,
  menuDropdownStyle,
  activeMenuOptions,
  activeMenuButtonRef,
  handleMenuSelect,
  closeMoreMenu,
  closeContextMenu,
  contextMenuConversation,
  contextMenuDropdownRef,
  contextMenuDropdownStyle,
  contextMenuOptions,
  handleContextMenu,
  handleContextMenuSelect,
  handleClickConversation,
  handleSelectConversation,
} = useSidebarChatList(props, emit);
</script>
