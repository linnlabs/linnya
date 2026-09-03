<template>
  <div
    class="conversation-chat-surface"
    :class="{ 'conversation-chat-surface--compact': variant === 'compact' }"
    :data-empty-composer-placement="emptyComposerPlacement"
  >
    <slot name="overlay" />

    <main ref="mainRef" class="conversation-chat-main">
      <ErrorBanner v-if="!shouldMountHost" :error="error" @dismiss="clearError" />

      <div
        v-if="!shouldMountHost && emptyComposerPlacement === 'footer'"
        class="conversation-chat-footer-empty-layout"
      >
        <div class="conversation-chat-footer-empty-content">
          <ConversationEmptyState />
        </div>

        <footer class="conversation-chat-footer-empty-footer">
          <AiAssistantInput
            :placeholder="inputPlaceholder"
            :variant="variant"
            :disabled="isHistoryReplayLoading"
          />
        </footer>
      </div>

      <div v-else-if="!shouldMountHost" class="empty-state-layout">
        <div class="empty-state-content" :style="emptyStateVisualOffsetStyle">
          <slot name="empty-mark">
            <div v-if="emptyMark" class="empty-mark">{{ emptyMark }}</div>
          </slot>

          <h1 class="empty-heading">{{ emptyHeading }}</h1>
          <p v-if="emptyDescription" class="empty-description">{{ emptyDescription }}</p>

          <div class="centered-input-box">
            <AiAssistantInput
              :placeholder="inputPlaceholder"
              :variant="variant"
              :disabled="isHistoryReplayLoading"
            />
          </div>

          <div v-if="$slots.emptyActions" class="empty-actions">
            <slot name="emptyActions" />
          </div>
        </div>
      </div>

      <ConversationHost
        v-else
        :is-timeline-collapsed="isTimelineCollapsed"
        :is-active="isActive"
        :input-placeholder="inputPlaceholder"
        :input-variant="variant"
        use-own-scroll-viewport
        class="conversation-chat-host"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useAssistantStore } from '../store/assistantStore';
import { useConversationContentPhaseSelector } from '../store/conversationContentPhaseSelector';
import {
  isConversationHistoryPendingPhase,
  shouldMountConversationHost,
} from '../functions/conversationContentPhase';
import type {
  ConversationEmptyComposerPlacement,
  ConversationSurfaceVariant,
} from '../definitions/conversationPresentation';
import AiAssistantInput from './AiAssistantInput.vue';
import ConversationHost from './ConversationHost.vue';
import ConversationEmptyState from './components/ConversationEmptyState.vue';
import ErrorBanner from './components/ErrorBanner.vue';

withDefaults(defineProps<{
  emptyHeading: string;
  emptyDescription?: string;
  emptyMark?: string;
  inputPlaceholder?: string;
  variant?: ConversationSurfaceVariant;
  emptyComposerPlacement?: ConversationEmptyComposerPlacement;
  isActive?: boolean;
}>(), {
  variant: 'regular',
  emptyComposerPlacement: 'center',
  isActive: true,
});

const assistantStore = useAssistantStore();
const mainRef = ref<HTMLElement | null>(null);
const mainHeight = ref(0);

const contentPhase = useConversationContentPhaseSelector();
const isHistoryReplayLoading = computed(() => isConversationHistoryPendingPhase(contentPhase.value));
const shouldMountHost = computed(() => shouldMountConversationHost(contentPhase.value));
const isTimelineCollapsed = computed(() => assistantStore.isTimelineCollapsed);
const error = computed(() => assistantStore.error);

const emptyStateVisualOffsetStyle = computed(() => {
  const aestheticLift = Math.min(28, Math.max(8, Math.round(mainHeight.value * 0.035)));
  const offset = Math.round(aestheticLift + 10);
  return {
    transform: `translateY(-${offset}px)`,
  };
});

const updateMainHeight = () => {
  mainHeight.value = mainRef.value?.offsetHeight ?? 0;
};

const clearError = () => {
  assistantStore.clearError();
};

let mainResizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  await nextTick();
  updateMainHeight();
  mainResizeObserver = new ResizeObserver(updateMainHeight);
  if (mainRef.value) {
    mainResizeObserver.observe(mainRef.value);
  }
});

onBeforeUnmount(() => {
  if (mainResizeObserver) {
    mainResizeObserver.disconnect();
    mainResizeObserver = null;
  }
});
</script>
