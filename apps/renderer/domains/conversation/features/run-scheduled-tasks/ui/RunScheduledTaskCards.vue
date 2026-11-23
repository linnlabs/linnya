<template>
  <div class="run-scheduled-tasks">
    <div
      v-for="card in cards"
      :key="card.taskId"
      class="run-scheduled-task-card"
      :class="{ 'is-warning': card.tone === 'warning' }"
      data-testid="run-scheduled-task-card"
    >
      <ClockIcon class="run-scheduled-task-card__icon" />
      <div class="run-scheduled-task-card__text">
        <span class="run-scheduled-task-card__name">{{ card.name }}</span>
        <span class="run-scheduled-task-card__meta">{{ card.meta }}</span>
      </div>
      <div class="run-scheduled-task-card__actions">
        <BaseButton
          v-for="action in card.actions"
          :key="action.id"
          :variant="action.variant"
          size="sm"
          @click="$emit('act', card, action.id)"
        >{{ action.label }}</BaseButton>
      </div>
      <div v-if="card.warning" class="run-scheduled-task-card__warning">{{ card.warning }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import { ClockIcon } from '@linnya/renderer-ui/icons';
import type { RunScheduledTaskCard } from '../definitions/runScheduledTasks';
import '../styles/RunScheduledTasks.css';

defineProps<{ cards: readonly RunScheduledTaskCard[] }>();
defineEmits<{ act: [card: RunScheduledTaskCard, actionId: string] }>();
</script>
