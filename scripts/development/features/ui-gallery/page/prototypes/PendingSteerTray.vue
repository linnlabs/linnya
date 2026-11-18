<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import { ClockIcon } from '@linnya/renderer-ui/icons';

/**
 * 输入框上方的“待送达”条：说明 Agent 什么时候会读到，可撤回某一条，或立即打断。
 * 贴在输入框顶边后面，底部被输入框压住一截。
 */
defineProps<{
  readonly messages: readonly string[];
  readonly hint: string;
  readonly compact?: boolean;
}>();

const emit = defineEmits<{
  withdraw: [index: number];
  interrupt: [];
}>();
</script>

<template>
  <div class="steer-tray" :class="{ 'is-compact': compact }">
    <div class="steer-tray__head">
      <ClockIcon class="steer-tray__icon" />
      <span class="steer-tray__hint" :title="hint">{{ hint }}</span>
      <BaseButton variant="ghost" size="sm" class="steer-tray__button" @click="emit('interrupt')">立即打断</BaseButton>
    </div>
    <div v-for="(message, index) in messages" :key="index" class="steer-tray__item">
      <span class="steer-tray__text" :title="message">{{ message }}</span>
      <BaseButton variant="ghost" size="sm" class="steer-tray__button" @click="emit('withdraw', index)">撤回</BaseButton>
    </div>
  </div>
</template>

<style scoped>
.steer-tray {
  --steer-tray-overlap: 18px;

  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  margin: 0 var(--space-5) calc(var(--steer-tray-overlap) * -1);
  padding: var(--space-1-5) var(--space-2) calc(var(--space-1-5) + var(--steer-tray-overlap)) var(--space-3);
  border-radius: 16px 16px 0 0;
  corner-shape: squircle;
  background: color-mix(in srgb, var(--color-text-primary) 0.6%, var(--color-bg-subtle));
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-normal);
}

.steer-tray.is-compact {
  margin-inline: var(--space-3);
  padding-left: var(--space-2-5);
}

.steer-tray__head,
.steer-tray__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 26px;
}

.steer-tray__icon {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
}

.steer-tray__hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.steer-tray__item {
  padding-left: calc(14px + var(--space-2));
}

.steer-tray__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.steer-tray__button {
  flex: none;
}
</style>
