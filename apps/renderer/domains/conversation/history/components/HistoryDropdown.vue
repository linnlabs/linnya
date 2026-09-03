<template>
  <Teleport to="body">
    <transition name="history-dropdown-fade">
      <div
        v-if="isVisible"
        ref="dropdownWrapperRef"
        class="history-dropdown-wrapper"
        :style="dropdownStyle"
      >
        <CustomSelect
          :model-value="selectedHistoryValue"
          :options="historyOptions"
          :manual-mode="true"
          variant="minimal"
          :bordered="false"
          :external-trigger-ref="buttonRef"
          options-max-height="none"
          options-overflow="visible"
          :class-names="{
            options: 'history-dropdown-options',
            option: 'history-dropdown-option',
            optionLabel: 'history-dropdown-option-label',
            optionShortcut: 'history-dropdown-option-shortcut',
            optionIcon: 'history-dropdown-option-icon',
          }"
          @update:model-value="handleSelectValue"
          @close="emit('close')"
        />
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component, type CSSProperties } from 'vue';
import { useHistoryListStore } from '../store/historyListStore';
import { useAssistantStore } from '../../store/assistantStore';
import { useWorkspaceScopeStore } from '@shared/stores/workspaceScopeStore';
import { getWorkspaceNavigationPort } from '@shared/ports/workspaceNavigationPort';
import type { ConversationListItem } from '../services/historyApiService';
import { HistoryIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { formatConversationListTime } from '../../functions/conversationListTime';
import { useConversationLocalization } from '../../ui/useConversationLocalization';

interface Props {
  isVisible: boolean;
  buttonRef?: HTMLElement | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  viewAll: [];
}>();

type HistoryDropdownValue = `conversation:${string}` | 'view-all';

interface HistoryDropdownOption {
  value?: HistoryDropdownValue;
  text?: string;
  shortcut?: string;
  iconComponent?: Component;
  isGroup?: true;
  label?: string;
  isSeparator?: true;
  disabled?: boolean;
  className?: string;
}

const listStore = useHistoryListStore();
const assistantStore = useAssistantStore();
const workspaceScopeStore = useWorkspaceScopeStore();
const { conversationMessage } = useConversationLocalization();
const dropdownWrapperRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref<CSSProperties>({});

const conversations = computed(() => listStore.conversations);
const isLoading = computed(() => listStore.isLoading);
const selectedId = computed(() => (
  assistantStore.selectedConversationId || assistantStore.activeConversationId
));
const selectedHistoryValue = computed<HistoryDropdownValue | null>(() => (
  selectedId.value ? `conversation:${selectedId.value}` : null
));
const displayedConversations = computed(() => conversations.value.slice(0, 5));

const historyOptions = computed<HistoryDropdownOption[]>(() => {
  const options: HistoryDropdownOption[] = [
    { isGroup: true, label: conversationMessage('conversation.history.group.recent') },
  ];

  if (isLoading.value && conversations.value.length === 0) {
    options.push({
      value: 'conversation:loading',
      text: conversationMessage('conversation.history.loading'),
      disabled: true,
      className: 'history-dropdown-status-option',
    });
  } else if (conversations.value.length === 0) {
    options.push({
      value: 'conversation:empty',
      text: conversationMessage('conversation.history.empty'),
      disabled: true,
      className: 'history-dropdown-status-option',
    });
  } else {
    options.push(...displayedConversations.value.map(conversation => ({
      value: `conversation:${conversation.conversation_id}` as const,
      text: conversation.title || conversationMessage('conversation.sidebar.untitled'),
      shortcut: formatConversationListTime(conversation.last_event_at, conversationMessage),
    })));
  }

  options.push(
    { isSeparator: true },
    {
      value: 'view-all',
      text: conversationMessage('conversation.history.viewAll'),
      iconComponent: HistoryIcon,
      className: 'history-dropdown-view-all-option',
    },
  );

  return options;
});

const calculatePosition = (): void => {
  const buttonEl = props.buttonRef;
  const wrapperEl = dropdownWrapperRef.value;
  if (!buttonEl || !wrapperEl) return;

  const buttonRect = buttonEl.getBoundingClientRect();
  const wrapperRect = wrapperEl.getBoundingClientRect();
  const viewportGap = 8;
  const offset = 4;
  let top = buttonRect.bottom + offset;
  let left = buttonRect.right - wrapperRect.width;

  if (left < viewportGap) {
    left = viewportGap;
  }

  if (top + wrapperRect.height > window.innerHeight - viewportGap) {
    top = buttonRect.top - wrapperRect.height - offset;
  }

  if (top < viewportGap) {
    top = viewportGap;
  }

  dropdownStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
  };
};

const ensureListLoaded = (): void => {
  if (conversations.value.length > 0 || isLoading.value) return;
  void listStore.loadScopeList(workspaceScopeStore.currentScope, {
    refresh: true,
    limit: 5,
  });
};

const findConversationByValue = (value: HistoryDropdownValue): ConversationListItem | null => {
  if (!value.startsWith('conversation:')) return null;

  const conversationId = value.slice('conversation:'.length);
  return conversations.value.find(conversation => (
    conversation.conversation_id === conversationId
  )) ?? null;
};

const handleSelectValue = (value: HistoryDropdownValue | null): void => {
  if (!value) return;

  if (value === 'view-all') {
    emit('viewAll');
    emit('close');
    return;
  }

  const conversation = findConversationByValue(value);
  if (!conversation) return;

  emit('close');
  void getWorkspaceNavigationPort().openConversation({
    conversationId: conversation.conversation_id,
    scope: workspaceScopeStore.currentScope,
    initialConversation: {
      title: conversation.title,
      createdAt: conversation.created_at,
      lastEventAt: conversation.last_event_at,
      userMessageCount: conversation.user_message_count,
      projectId: conversation.project_id,
    },
  });
};

watch(
  () => props.isVisible,
  (isVisible) => {
    if (!isVisible) return;
    ensureListLoaded();
    void nextTick(() => {
      calculatePosition();
    });
  },
);

watch(
  [displayedConversations, isLoading],
  () => {
    if (!props.isVisible) return;
    void nextTick(() => {
      calculatePosition();
    });
  },
);

onMounted(() => {
  ensureListLoaded();
  calculatePosition();
});
</script>
