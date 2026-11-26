<template>
  <BaseDropdown
    v-if="props.presentation.status !== 'hidden'"
    :external-content-ref="panelRef"
  >
    <template #trigger="{ toggle, isOpen }">
      <button
        ref="triggerRef"
        type="button"
        class="context-window-usage-trigger"
        :aria-busy="props.presentation.status === 'loading'"
        :data-linnya-tooltip="triggerAriaLabel"
        :aria-label="triggerAriaLabel"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        @click="toggle"
      >
        <LinnyaLoadingIcon v-if="props.presentation.status === 'loading'" />
        <svg
          v-else
          class="context-window-usage-trigger__ring"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <circle
            class="context-window-usage-trigger__track"
            cx="10"
            cy="10"
            r="8"
          />
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
              { 'is-positioned': isPanelPositioned },
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
import { computed, ref } from 'vue';
import { BaseDropdown, DROPDOWN_SURFACE_CLASSES, useAnchoredPosition } from '@linnya/renderer-ui';
import { LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';
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
import ContextWindowUsagePanel from './ContextWindowUsagePanel.vue';

const props = defineProps<{
  readonly presentation: ContextWindowUsagePresentation;
  readonly conversationInformation: ConversationInformationPresentation | null;
}>();

const { conversationMessage, currentLocale } = useConversationLocalization();
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
// 面板只在打开时渲染，元素存在即为打开。输入区在窗口底部，面板默认在按钮上方、右沿对齐。
const {
  style: panelStyle,
  isPositioned: isPanelPositioned,
} = useAnchoredPosition({
  anchor: triggerRef,
  floating: panelRef,
  open: () => panelRef.value !== null,
  placement: { side: 'top', align: 'end' },
});

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
  if (props.presentation.status === 'loading') return conversationMessage('conversation.contextUsage.trigger.loading');
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

const emptyMessage = computed(() => available.value ? '' : triggerAriaLabel.value);

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

</script>
