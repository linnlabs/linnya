<script setup lang="ts">
import { IconButton } from '@linnya/renderer-ui';
import { ClockIcon, CloseIcon, EditIcon } from '@linnya/renderer-ui/icons';

/**
 * 输入框上方的“待送达”条：说明 Agent 什么时候会读到；送达前每条可编辑（放回输入框改完再发）
 * 或撤回（不发了），也可以立即打断。贴在输入框顶边后面，底部被输入框压住一截。
 */
defineProps<{
  readonly messages: readonly string[];
  readonly hint: string;
  readonly compact?: boolean;
}>();

const emit = defineEmits<{
  edit: [index: number];
  withdraw: [index: number];
  interrupt: [];
}>();
</script>

<template>
  <div class="steer-tray" :class="{ 'is-compact': compact }">
    <div class="steer-tray__head">
      <ClockIcon class="steer-tray__icon" />
      <span class="steer-tray__hint" :title="hint">{{ hint }}</span>
      <button type="button" class="steer-tray__link" @click="emit('interrupt')">立即打断</button>
    </div>
    <div v-for="(message, index) in messages" :key="index" class="steer-tray__item">
      <span class="steer-tray__text" :title="message">{{ message }}</span>
      <span class="steer-tray__actions">
        <IconButton size="xs" label="编辑" @click="emit('edit', index)">
          <EditIcon />
        </IconButton>
        <IconButton size="xs" label="撤回" @click="emit('withdraw', index)">
          <CloseIcon />
        </IconButton>
      </span>
    </div>
  </div>
</template>

<style scoped>
.steer-tray {
  --steer-tray-overlap: 14px;

  display: flex;
  flex-direction: column;
  margin: 0 var(--space-5) calc(var(--steer-tray-overlap) * -1);
  padding: var(--space-1) var(--space-1-5) calc(var(--space-1) + var(--steer-tray-overlap)) var(--space-3);
  border-radius: 14px 14px 0 0;
  corner-shape: squircle;
  background: color-mix(in srgb, var(--color-text-primary) 0.6%, var(--color-bg-subtle));
  font-size: var(--font-size-footnote);
  line-height: 18px;
}

.steer-tray.is-compact {
  margin-inline: var(--space-3);
  padding-left: var(--space-2-5);
}

.steer-tray__head,
.steer-tray__item {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-width: 0;
  min-height: 22px;
}

.steer-tray__icon {
  flex: none;
  width: 13px;
  height: 13px;
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

.steer-tray__link {
  flex: none;
  height: 20px;
  padding: 0 var(--space-1-5);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  cursor: pointer;
}

.steer-tray__link:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.steer-tray__item {
  padding-left: calc(13px + var(--space-1-5));
}

.steer-tray__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.steer-tray__actions {
  display: inline-flex;
  flex: none;
  gap: var(--space-0-5);
}
</style>
