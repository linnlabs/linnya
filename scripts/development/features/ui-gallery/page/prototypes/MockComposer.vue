<script setup lang="ts">
import { IconButton } from '@linnya/renderer-ui';
import { AddIcon, ChevronIcon, RunControlIcon } from '@linnya/renderer-ui/icons';

/**
 * 对话输入框的静态外壳：尺寸、圆角、底栏控件高度照真实输入框（AiAssistantInput）抄，
 * 只用来摆放档位指示的位置方案，不含编辑器与发送逻辑。
 */
withDefaults(
  defineProps<{
    readonly variant?: 'default' | 'compact';
    readonly placeholder?: string;
    readonly model?: string;
    readonly running?: boolean;
  }>(),
  { variant: 'default', placeholder: '输入消息，@ 引用文档', model: 'DeepSeek V4', running: false },
);

defineSlots<{
  'footer-extra'(): unknown;
  below(): unknown;
}>();
</script>

<template>
  <div class="mock-composer" :class="`is-${variant}`">
    <div class="mock-composer__surface">
      <div class="mock-composer__editor">{{ placeholder }}</div>
      <div class="mock-composer__footer">
        <div class="mock-composer__controls">
          <IconButton :size="variant === 'compact' ? 'sm' : 'composer'" label="添加">
            <AddIcon />
          </IconButton>
          <span class="mock-composer__model">
            <span class="mock-composer__model-text">{{ model }}</span>
            <ChevronIcon direction="up" class="mock-composer__chevron" />
          </span>
          <slot name="footer-extra" />
        </div>
        <div class="mock-composer__actions">
          <span class="mock-composer__usage" aria-hidden="true" />
          <span class="mock-composer__send" :class="{ 'is-running': running }">
            <RunControlIcon :action="running ? 'pause' : 'send'" />
          </span>
        </div>
      </div>
    </div>
    <slot name="below" />
  </div>
</template>

<style scoped>
.mock-composer {
  --mock-composer-radius: 28px;
  --mock-composer-control-height: 26px;

  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.mock-composer.is-compact {
  --mock-composer-radius: 21px;
  --mock-composer-control-height: 24px;
}

.mock-composer__surface {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 0.5px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
  border-radius: var(--mock-composer-radius);
  corner-shape: squircle;
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
}

.mock-composer__editor {
  min-height: 34px;
  padding: var(--space-3) var(--space-4) var(--space-0-5);
  color: var(--color-text-placeholder);
  font-size: var(--font-size-prose);
  line-height: 24px;
}

.is-compact .mock-composer__editor {
  min-height: 28px;
  padding: var(--space-2-5) var(--space-2-5) 0;
  font-size: var(--font-size-body);
}

.mock-composer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2-5) var(--space-2) var(--space-2);
}

.is-compact .mock-composer__footer {
  padding: var(--space-1-5) var(--space-2-5) var(--space-2);
}

.mock-composer__controls {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.is-compact .mock-composer__controls {
  gap: var(--space-1);
}

.mock-composer__model {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  height: var(--mock-composer-control-height);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.mock-composer__model-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mock-composer__chevron {
  flex: none;
  width: 12px;
  height: 12px;
}

.mock-composer__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}

.mock-composer__usage {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-border-default);
  border-radius: 50%;
}

.mock-composer__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-md);
  background-color: var(--color-bg-inverse);
  color: var(--color-text-inverse);
}

.is-compact .mock-composer__send {
  width: 24px;
  height: 24px;
}

.mock-composer__send :deep(svg) {
  width: 14px;
  height: 14px;
}
</style>
