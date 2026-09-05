<template>
  <div class="agent-todo-card">
    <!-- 状态：加载中 -->
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner"></div>
      <span>{{ loadingText }}</span>
    </div>

    <!-- 状态：错误 -->
    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">{{ conversationMessage('conversation.tool.todo.failed') }}</div>
    </div>

    <!-- 状态：成功 -->
    <div v-else class="content">
      <div class="meta-row">
        <div class="meta-left">
          <span class="meta-title">{{ conversationMessage('conversation.tool.todo.title') }}</span>
          <span v-if="metaVersionText" class="meta-version">{{ metaVersionText }}</span>
        </div>
        <div class="meta-right">
          <TagChip
            class="agent-todo-summary-chip"
            :class-names="{ label: 'agent-todo-chip-label' }"
            :label="conversationMessage('conversation.tool.todo.status.inProgress')"
            :backgroundColor="chipColors.inProgress.bg"
            :textColor="chipColors.inProgress.text"
            :borderColor="chipColors.inProgress.border"
          />
          <span class="count-text">{{ counts.inProgress }}</span>

          <TagChip
            class="agent-todo-summary-chip"
            :class-names="{ label: 'agent-todo-chip-label' }"
            :label="conversationMessage('conversation.tool.todo.status.pending')"
            :backgroundColor="chipColors.pending.bg"
            :textColor="chipColors.pending.text"
            :borderColor="chipColors.pending.border"
          />
          <span class="count-text">{{ counts.pending }}</span>

          <TagChip
            class="agent-todo-summary-chip"
            :class-names="{ label: 'agent-todo-chip-label' }"
            :label="conversationMessage('conversation.tool.todo.status.completed')"
            :backgroundColor="chipColors.completed.bg"
            :textColor="chipColors.completed.text"
            :borderColor="chipColors.completed.border"
          />
          <span class="count-text">{{ counts.completed }}</span>
        </div>
      </div>

      <div v-if="items.length === 0" class="empty">
        <div class="empty-title">{{ conversationMessage('conversation.tool.todo.emptyTitle') }}</div>
        <div class="empty-subtitle">{{ conversationMessage('conversation.tool.todo.emptySubtitle') }}</div>
      </div>

      <div v-else class="list">
        <div
          v-for="item in items"
          :key="item.id"
          class="item"
          :class="{
            'item--completed': item.status === 'completed',
            'item--cancelled': item.status === 'cancelled',
            'item--in-progress': item.status === 'in_progress'
          }"
        >
          <!-- ✅ 使用已有组件：统一 checkbox 视觉（只读） -->
          <CustomCheckbox
            class="todo-checkbox"
            :class-names="{
              item: 'agent-todo-checkbox-item',
              indicator: 'agent-todo-checkbox-indicator',
              checkIcon: 'agent-todo-checkbox-check-icon',
            }"
            :modelValue="item.status === 'completed'"
            :disabled="true"
          >
            <!-- 不使用 slot 文本：保持与列表主文案分离 -->
          </CustomCheckbox>
          <div class="item-content">
            <div class="item-text">{{ item.content }}</div>
          </div>
          <div class="item-status">
            <TagChip
              class="agent-todo-item-chip"
              :class-names="{ label: 'agent-todo-chip-label' }"
              :label="statusLabel(item.status)"
              :backgroundColor="statusChip(item.status).bg"
              :textColor="statusChip(item.status).text"
              :borderColor="statusChip(item.status).border"
            />
          </div>
        </div>
      </div>

      <div v-if="items.length > 0" class="progress-row">
        <div class="progress-bar">
          <div class="progress-bar__fill" :style="{ width: `${progressPct}%` }"></div>
        </div>
        <div class="progress-text">{{ progressText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CustomCheckbox, TagChip } from '@linnya/renderer-ui';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { AgentTodoToolItem } from '@app/schemas';
import type { ToolCardPresentation } from '../types';
import type { AgentTodoPresentationData } from './definitions/agentTodoPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<AgentTodoPresentationData>;
  messageId?: string;
}>();

const { conversationMessage } = useConversationLocalization();

const status = computed(() => props.presentation.status);
const data = computed(() => props.presentation.data);
const todo = computed(() => data.value.kind === 'snapshot' ? data.value.todo : null);
const items = computed<readonly AgentTodoToolItem[]>(() => (
  data.value.kind === 'snapshot' ? data.value.items : []
));
const counts = computed(() => data.value.kind === 'snapshot'
  ? data.value.counts
  : { pending: 0, inProgress: 0, completed: 0, cancelled: 0, total: 0 });
const progressPct = computed(() => (
  data.value.kind === 'snapshot' ? data.value.progressPercent : 0
));

const progressText = computed(() => {
  const total = counts.value.total;
  if (total <= 0) return '';
  return conversationMessage('conversation.tool.todo.progress', {
    percent: progressPct.value,
    completed: counts.value.completed,
    total,
  });
});

const metaVersionText = computed(() => {
  return todo.value === null ? null : `v${todo.value.version}`;
});

const loadingText = computed(() => {
  return conversationMessage('conversation.tool.todo.loading');
});

function statusLabel(s: AgentTodoToolItem['status']): string {
  if (s === 'in_progress') return conversationMessage('conversation.tool.todo.status.inProgress');
  if (s === 'pending') return conversationMessage('conversation.tool.todo.status.pending');
  if (s === 'completed') return conversationMessage('conversation.tool.todo.status.completed');
  return conversationMessage('conversation.tool.todo.status.cancelled');
}

const chipColors = computed(() => {
  // 使用 CSS 变量字符串（允许在浅/深色主题下自动变化）
  const accentBg = 'color-mix(in srgb, var(--color-accent) 8%, transparent)';
  const accentBorder = 'color-mix(in srgb, var(--color-accent) 18%, transparent)';
  const accentText = 'var(--color-accent)';
  return {
    inProgress: { bg: accentBg, text: accentText, border: accentBorder },
    pending: {
      bg: 'var(--color-bg-subtle)',
      text: 'var(--color-text-tertiary)',
      border: 'var(--color-border-light)'
    },
    completed: {
      bg: 'var(--color-bg-subtle)',
      text: 'var(--color-text-secondary)',
      border: 'var(--color-border-light)'
    },
    cancelled: {
      bg: 'var(--color-bg-subtle)',
      text: 'var(--color-text-tertiary)',
      border: 'var(--color-border-light)'
    }
  };
});

function statusChip(status: AgentTodoToolItem['status']): { bg: string; text: string; border?: string } {
  if (status === 'in_progress') return chipColors.value.inProgress;
  if (status === 'pending') return chipColors.value.pending;
  if (status === 'completed') return chipColors.value.completed;
  return chipColors.value.cancelled;
}
</script>
