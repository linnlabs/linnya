<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import {
  DocumentEditIcon,
  DocumentTextIcon,
  LinkIcon,
  LoadingIcon,
  SearchIcon,
  TerminalIcon,
} from '@linnya/renderer-ui/icons';
import type { TimelineEntry, TimelineStepIcon } from './steeringDemo.ts';

/**
 * 对话时间线的静态示意：用户气泡照 UserMessage.css，工具单行照 ToolInlineLine.css，
 * 只用来摆放插话出现的位置，不是真实的消息投影。
 */
defineProps<{
  readonly entries: readonly TimelineEntry[];
}>();

const STEP_ICONS: Readonly<Record<TimelineStepIcon, unknown>> = {
  search: SearchIcon,
  web: LinkIcon,
  read: DocumentTextIcon,
  edit: DocumentEditIcon,
  terminal: TerminalIcon,
};
</script>

<template>
  <div class="mock-timeline">
    <template v-for="(entry, index) in entries" :key="index">
      <div v-if="entry.kind === 'user'" class="mock-timeline__user">
        <div class="mock-timeline__bubble">{{ entry.text }}</div>
      </div>

      <div v-else-if="entry.kind === 'thought'" class="mock-timeline__line">
        <span class="mock-timeline__text">{{ entry.text }}</span>
      </div>

      <div v-else-if="entry.kind === 'step'" class="mock-timeline__line">
        <LoadingIcon v-if="entry.state === 'running'" class="mock-timeline__icon is-running" />
        <component :is="STEP_ICONS[entry.icon]" v-else class="mock-timeline__icon" />
        <span class="mock-timeline__text">{{ entry.text }}</span>
        <span v-if="entry.meta" class="mock-timeline__meta">{{ entry.meta }}</span>
      </div>

      <p v-else-if="entry.kind === 'answer'" class="mock-timeline__answer">
        {{ entry.text }}
      </p>

      <div v-else-if="entry.kind === 'subrun'" class="mock-timeline__subrun">
        <LoadingIcon class="mock-timeline__icon is-running" />
        <span class="mock-timeline__subrun-title">{{ entry.title }}</span>
        <span class="mock-timeline__meta">{{ entry.meta }}</span>
      </div>

      <div v-else-if="entry.kind === 'approval'" class="mock-timeline__approval">
        <div class="mock-timeline__approval-title"><TerminalIcon />允许执行这条命令吗？</div>
        <code class="mock-timeline__approval-command">{{ entry.command }}</code>
        <div class="mock-timeline__approval-actions">
          <BaseButton variant="secondary" size="sm">拒绝</BaseButton>
          <BaseButton variant="primary" size="sm">允许本次</BaseButton>
        </div>
      </div>

      <div v-else class="mock-timeline__notice">{{ entry.text }}</div>
    </template>
  </div>
</template>

<style scoped>
.mock-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  font-size: var(--font-size-prose);
  line-height: var(--line-height-prose);
}

.mock-timeline__user {
  display: flex;
  justify-content: flex-end;
  margin: var(--space-2) 0;
}

.mock-timeline__bubble {
  max-width: 90%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  background-color: color-mix(in srgb, var(--color-text-primary) 0.6%, var(--color-bg-subtle));
  color: var(--color-text-primary);
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.mock-timeline__line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 24px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-normal);
}

.mock-timeline__icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--color-text-placeholder);
}

.mock-timeline__icon.is-running {
  color: var(--color-text-secondary);
}

.mock-timeline__text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mock-timeline__meta {
  flex: none;
  color: var(--color-text-placeholder);
}

.mock-timeline__answer {
  margin: var(--space-1) 0;
  color: var(--color-text-primary);
}

.mock-timeline__subrun {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2-5) var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--color-border-default);
  font-size: var(--font-size-footnote);
}

.mock-timeline__subrun-title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mock-timeline__approval {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--color-border-default);
  font-size: var(--font-size-sm);
}

.mock-timeline__approval-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.mock-timeline__approval-title :deep(svg) {
  width: 16px;
  height: 16px;
}

.mock-timeline__approval-command {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-caption);
  white-space: pre-wrap;
  word-break: break-all;
}

.mock-timeline__approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.mock-timeline__notice {
  align-self: center;
  margin: var(--space-1) 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}
</style>
