<template>
  <button
    type="button"
    class="scheduled-task-row"
    :class="{ 'is-selected': selected, 'is-off': !enabled }"
    :aria-current="selected ? 'true' : undefined"
    data-testid="scheduled-task-row"
    @click="emit('select')"
  >
    <span class="scheduled-task-row__main">
      <span class="scheduled-task-row__name">
        <span class="scheduled-task-row__name-text">{{ task.name }}</span>
        <span v-if="task.permission_level === 'full_access'" class="scheduled-task-tag is-warning">
          {{ scheduledTaskMessage('scheduledTasks.tag.fullAccess') }}
        </span>
      </span>
      <span class="scheduled-task-row__meta">
        {{ scheduleText }} ·
        <span :class="`is-${state.tone}`">{{ state.text }}</span>
      </span>
    </span>
    <span v-if="task.unread_count > 0" class="scheduled-task-badge">{{ task.unread_count }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useHistoryTime } from '@app/localization';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { describeSchedule } from '../functions/describeSchedule';
import { isTaskEnabled, presentTaskState } from '../functions/presentScheduledTask';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  readonly task: ScheduledTask;
  readonly selected: boolean;
}>();

const emit = defineEmits<{ select: [] }>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledTime, scheduledDate } = useHistoryTime();
const enabled = computed(() => isTaskEnabled(props.task));
const scheduleText = computed(() => describeSchedule(props.task.schedule, scheduledTaskMessage, scheduledDate));
const state = computed(() => presentTaskState(
  props.task,
  scheduledTaskMessage,
  props.task.next_run_at === null ? null : scheduledTime(props.task.next_run_at),
));
</script>
