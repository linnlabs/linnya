<script setup lang="ts">
/**
 * 候选组件原型：StatusBadge。取代各处自写的 default / new / kb / parse-status / agent / revision / date / page 徽标。
 * tone 表达语义而不是颜色；dot 在文字前加状态圆点；只有圆点时用作状态点。
 */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly size?: 'sm' | 'md';
  readonly dot?: boolean;
}

withDefaults(defineProps<BadgeProps>(), { tone: 'neutral', size: 'sm', dot: false });
</script>

<template>
  <span class="proto-badge" :class="[`proto-badge--${tone}`, `proto-badge--${size}`, { 'proto-badge--dot-only': dot && !$slots.default }]">
    <span v-if="dot" class="proto-badge__dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<style>
.proto-badge {
  --proto-badge-fg: var(--color-text-secondary);
  --proto-badge-bg: var(--color-bg-hover);
  --proto-badge-dot: var(--color-text-tertiary);

  display: inline-flex;
  flex: none;
  gap: var(--space-1);
  align-items: center;
  border-radius: var(--radius-full);
  background-color: var(--proto-badge-bg);
  color: var(--proto-badge-fg);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  white-space: nowrap;
}

.proto-badge--sm {
  height: 18px; /* scale-exempt: 徽标高度 */
  padding: 0 var(--space-1-5);
  font-size: var(--font-size-caption);
}

.proto-badge--md {
  height: 22px; /* scale-exempt: 徽标高度 */
  padding: 0 var(--space-2);
  font-size: var(--font-size-footnote);
}

.proto-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--proto-badge-dot);
}

.proto-badge--dot-only {
  height: auto;
  padding: 0;
  background: none;
}

.proto-badge--accent {
  --proto-badge-fg: var(--color-accent-text);
  --proto-badge-bg: var(--color-accent-bg);
  --proto-badge-dot: var(--color-accent);
}

.proto-badge--success {
  --proto-badge-fg: var(--color-success-text);
  --proto-badge-bg: var(--color-success-bg);
  --proto-badge-dot: var(--color-success);
}

.proto-badge--warning {
  --proto-badge-fg: var(--color-warning-text);
  --proto-badge-bg: var(--color-warning-bg);
  --proto-badge-dot: var(--color-warning);
}

.proto-badge--error {
  --proto-badge-fg: var(--color-error-text);
  --proto-badge-bg: var(--color-error-bg);
  --proto-badge-dot: var(--color-error);
}

.proto-badge--info {
  --proto-badge-fg: var(--color-info-text);
  --proto-badge-bg: var(--color-info-bg);
  --proto-badge-dot: var(--color-info);
}
</style>
