<script setup lang="ts">
import { LinnyaIcon, LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';
import type { RunStatusRowView } from '../definitions/runStatus';
import './RunStatusRow.css';

/**
 * 时间线底部常驻状态行：图标 · 在做什么 · 已用时长。
 * 等用户（回答提问、批准命令）和暂停时图标静止变灰，表示球在用户这边。
 */
defineProps<{
  readonly status: RunStatusRowView;
}>();
</script>

<template>
  <div
    class="run-status-row"
    :class="{ 'is-still': status.motion === 'still' }"
    role="status"
    aria-live="polite"
    data-run-status-row
  >
    <LinnyaIcon v-if="status.motion === 'still'" class="run-status-row__icon" />
    <LinnyaLoadingIcon v-else class="run-status-row__icon" :activity="status.motion" />
    <span class="run-status-row__text" data-run-status-text>{{ status.text }}</span>
    <span class="run-status-row__sep" aria-hidden="true">·</span>
    <span class="run-status-row__time">{{ status.elapsedText }}</span>
  </div>
</template>
