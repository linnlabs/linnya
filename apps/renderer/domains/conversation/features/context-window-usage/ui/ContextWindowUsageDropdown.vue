<template>
  <BaseDropdown
    v-if="props.presentation.status !== 'unavailable'"
    :external-content-ref="panelRef"
  >
    <template #trigger="{ toggle, isOpen }">
      <button
        ref="triggerRef"
        type="button"
        class="context-window-usage-trigger"
        :class="{
          'is-unavailable': !available,
          'is-historical': available?.isHistoricalModel,
        }"
        :title="triggerAriaLabel"
        :aria-label="triggerAriaLabel"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        @click="handleTriggerClick($event, toggle, isOpen)"
      >
        <svg class="context-window-usage-trigger__ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="context-window-usage-trigger__track" cx="10" cy="10" r="8" />
          <circle
            v-if="available"
            class="context-window-usage-trigger__value"
            :class="`is-${available.level}`"
            cx="10"
            cy="10"
            r="8"
            pathLength="100"
            :stroke-dasharray="`${available.drawPercent} 100`"
          />
        </svg>
      </button>
    </template>

    <template #content="{ isOpen }">
      <Teleport to="body">
        <Transition name="context-window-usage-panel-fade">
          <div
            v-if="isOpen"
            ref="panelRef"
            class="context-window-usage-panel-wrapper"
            :class="[
              DROPDOWN_SURFACE_CLASSES.root,
              DROPDOWN_SURFACE_CLASSES.panel,
              DROPDOWN_SURFACE_CLASSES.portal,
              { 'is-positioned': panelPositioned },
            ]"
            :style="panelStyle"
          >
            <ContextWindowUsagePanel
              :title="conversationMessage('conversation.contextUsage.title')"
              :summary-text="summaryText"
              :total-text="totalText"
              :progress-aria-label="triggerAriaLabel"
              :used-tokens="available?.usage.used_tokens"
              :capacity-tokens="available?.contextWindowTokens"
              :segments="panelSegments"
              :rows="panelRows"
              :empty-message="emptyMessage"
              :detail-rows="conversationDetailRows"
            />
          </div>
        </Transition>
      </Teleport>
    </template>
  </BaseDropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BaseDropdown, DROPDOWN_SURFACE_CLASSES } from '@linnya/renderer-ui';
import type {
  ContextWindowUsagePanelDetailRow,
  ContextWindowUsagePanelRow,
  ContextWindowUsagePanelSegment,
  ContextWindowUsageTone,
} from '../definitions/contextWindowUsagePanel';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ContextWindowUsagePresentation } from '../definitions/contextWindowUsage';
import type { ConversationInformationPresentation } from '../definitions/conversationInformation';
import {
  formatApproximateContextUsageTokens,
  formatContextUsagePercentage,
  formatContextUsageTokens,
} from '../functions/projectContextWindowUsage';
import {
  formatConversationCreatedAt,
  formatConversationUserMessageCount,
} from '../functions/projectConversationInformation';
import { resolveContextUsagePanelPosition } from '../functions/resolveContextUsagePanelPosition';
import ContextWindowUsagePanel from './ContextWindowUsagePanel.vue';

const props = defineProps<{
  readonly presentation: ContextWindowUsagePresentation;
  readonly conversationInformation: ConversationInformationPresentation | null;
}>();

const { conversationMessage, currentLocale } = useConversationLocalization();
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const panelPositioned = ref(false);
const panelPosition = ref({ top: 0, left: 0 });

const available = computed(() => (
  'usage' in props.presentation ? props.presentation : null
));

function resolveTone(id: 'system_prompt' | 'conversation' | 'tool_definitions'): ContextWindowUsageTone {
  if (id === 'system_prompt') return 'system';
  if (id === 'conversation') return 'conversation';
  return 'tools';
}

const percentageText = computed(() => (
  available.value ? formatContextUsagePercentage(available.value.ratio) : ''
));

const summaryText = computed(() => (
  available.value
    ? conversationMessage('conversation.contextUsage.summary', { percentage: percentageText.value })
    : ''
));

const totalText = computed(() => {
  const current = available.value;
  if (!current) return '';
  const used = current.usage.confidence === 'actual'
    ? formatContextUsageTokens(current.usage.used_tokens)
    : formatApproximateContextUsageTokens(current.usage.used_tokens);
  return conversationMessage('conversation.contextUsage.total', {
    used,
    budget: formatContextUsageTokens(current.contextWindowTokens),
  });
});

const triggerAriaLabel = computed(() => {
  const current = available.value;
  if (!current) return conversationMessage('conversation.contextUsage.trigger.unavailable');
  return conversationMessage('conversation.contextUsage.trigger.available', {
    percentage: percentageText.value,
    used: formatContextUsageTokens(current.usage.used_tokens),
    budget: formatContextUsageTokens(current.contextWindowTokens),
  });
});

const panelSegments = computed<readonly ContextWindowUsagePanelSegment[]>(() => (
  available.value?.segments.map(segment => ({
    id: segment.id,
    share: segment.share,
    tone: resolveTone(segment.id),
  })) ?? []
));

const panelRows = computed<readonly ContextWindowUsagePanelRow[]>(() => {
  const current = available.value;
  if (!current) return [];
  return current.segments.map(segment => ({
    id: segment.id,
    label: conversationMessage(
      segment.id === 'system_prompt'
        ? 'conversation.contextUsage.row.systemPrompt'
        : segment.id === 'conversation'
          ? 'conversation.contextUsage.row.conversation'
          : 'conversation.contextUsage.row.toolDefinitions',
    ),
    value: formatApproximateContextUsageTokens(segment.tokens),
    tone: resolveTone(segment.id),
  }));
});

const emptyMessage = computed(() => {
  if (props.presentation.status === 'tail_unavailable') {
    return conversationMessage('conversation.contextUsage.empty.tailUnavailable');
  }
  return '';
});

const panelStyle = computed(() => ({
  top: `${panelPosition.value.top}px`,
  left: `${panelPosition.value.left}px`,
}));

const conversationDetailRows = computed<readonly ContextWindowUsagePanelDetailRow[]>(() => {
  const information = props.conversationInformation;
  if (!information) return [];

  return [
    {
      id: 'created_at',
      label: conversationMessage('conversation.contextUsage.conversationInfo.createdAt'),
      value: formatConversationCreatedAt(information.createdAt, currentLocale.value),
    },
    {
      id: 'user_message_count',
      label: conversationMessage('conversation.contextUsage.conversationInfo.userMessageCount'),
      value: formatConversationUserMessageCount(information.userMessageCount, currentLocale.value),
    },
  ];
});

function updatePanelPosition(): void {
  const trigger = triggerRef.value;
  const panel = panelRef.value;
  if (!trigger || !panel) return;
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  panelPosition.value = resolveContextUsagePanelPosition({
    trigger: {
      top: triggerRect.top,
      right: triggerRect.right,
      bottom: triggerRect.bottom,
    },
    panel: { width: panelRect.width, height: panelRect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gap: 8,
    padding: 8,
  });
  panelPositioned.value = true;
}

async function handleTriggerClick(
  event: MouseEvent,
  toggle: (event: MouseEvent) => void,
  isOpen: boolean,
): Promise<void> {
  toggle(event);
  if (isOpen) {
    panelPositioned.value = false;
    return;
  }
  await nextTick();
  updatePanelPosition();
}

function handleViewportChange(): void {
  if (panelRef.value) updatePanelPosition();
}

watch(() => props.presentation, () => {
  if (!panelRef.value) return;
  void nextTick(updatePanelPosition);
});

onMounted(() => {
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});
</script>
