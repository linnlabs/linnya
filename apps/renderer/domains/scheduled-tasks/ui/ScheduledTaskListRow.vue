<!-- 列表里的一行：点整行打开详情；指到或聚焦时，右边的下次运行换成开关和更多。 -->
<template>
  <div class="scheduled-task-row" :class="{ 'is-off': !enabled }">
    <button type="button" class="scheduled-task-row__open" data-testid="scheduled-task-row" @click="emit('open')">
      <span class="scheduled-task-row__main">
        <span class="scheduled-task-row__name">
          <span class="scheduled-task-row__title">{{ task.name }}</span>
          <span v-if="task.permission_level === 'full_access'" class="scheduled-task-tag">
            {{ scheduledTaskMessage('scheduledTasks.tag.fullAccess') }}
          </span>
        </span>
        <span class="scheduled-task-row__meta">{{ scheduleText }}</span>
      </span>
      <span v-if="task.unread_count > 0" class="scheduled-task-row__unread">
        {{ scheduledTaskMessage('scheduledTasks.list.unread', { count: task.unread_count }) }}
      </span>
      <span class="scheduled-task-row__next" :class="`is-${state.tone}`">{{ state.text }}</span>
    </button>
    <span class="scheduled-task-row__actions">
      <Switch
        :model-value="enabled"
        :ariaLabel="scheduledTaskMessage('scheduledTasks.list.enable', { name: task.name })"
        :disabled="task.state === 'finished' || busy"
        @update:model-value="setEnabled"
      />
      <ScheduledTaskMoreMenu :actions="['run', 'edit', 'delete']" @select="handleAction" />
    </span>
    <DeleteScheduledTaskDialog
      :visible="deleteOpen"
      :task="task"
      :busy="busy"
      @confirm="deleteTask"
      @cancel="deleteOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useHistoryTime } from '@app/localization';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { Switch } from '@linnya/renderer-ui';
import { describeSchedule } from '../functions/describeSchedule';
import { isTaskEnabled, presentTaskState, type ScheduledTaskPresentation } from '../functions/presentScheduledTask';
import DeleteScheduledTaskDialog from './DeleteScheduledTaskDialog.vue';
import ScheduledTaskMoreMenu, { type ScheduledTaskMenuAction } from './ScheduledTaskMoreMenu.vue';
import { useScheduledTaskActions } from './useScheduledTaskActions';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{ readonly task: ScheduledTask }>();
const emit = defineEmits<{ open: []; edit: [] }>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledTime, scheduledDate } = useHistoryTime();
const { busy, setEnabled, runNow, deleteTask } = useScheduledTaskActions(() => props.task);

const deleteOpen = ref(false);
const enabled = computed(() => isTaskEnabled(props.task));
const scheduleText = computed(() => describeSchedule(props.task.schedule, scheduledTaskMessage, scheduledDate));
/** 列头已经写了“下次运行”，排好时间的任务这里只写时刻；模型不可用时写明，到点会失败。 */
const state = computed<ScheduledTaskPresentation>(() => {
  if (props.task.state !== 'scheduled') return presentTaskState(props.task, scheduledTaskMessage, null);
  if (props.task.model_unavailable) return { text: scheduledTaskMessage('scheduledTasks.runReason.modelUnavailable'), tone: 'error' };
  return props.task.next_run_at === null
    ? presentTaskState(props.task, scheduledTaskMessage, null)
    : { text: scheduledTime(props.task.next_run_at), tone: 'neutral' };
});

function handleAction(action: ScheduledTaskMenuAction): void {
  if (action === 'run') void runNow();
  else if (action === 'edit') emit('edit');
  else deleteOpen.value = true;
}
</script>
