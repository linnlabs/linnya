<!-- 任务列表：当前项目在前，其余按项目名分组；分组规则见 groupTasksByProject。 -->
<template>
  <section v-for="(group, index) in groups" :key="group.projectId" class="scheduled-task-group">
    <h2 class="scheduled-task-group__title">
      <span>{{ groupTitle(group) }}</span>
      <span v-if="index === 0">{{ scheduledTaskMessage('scheduledTasks.list.nextRun') }}</span>
    </h2>
    <ScheduledTaskListRow
      v-for="task in group.tasks"
      :key="task.id"
      :task="task"
      @open="emit('open', task.id)"
      @edit="emit('edit', task.id)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { groupTasksByProject, type ScheduledTaskProjectGroup } from '../functions/presentScheduledTask';
import ScheduledTaskListRow from './ScheduledTaskListRow.vue';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  readonly tasks: readonly ScheduledTask[];
  readonly currentProjectId: string | null;
  readonly projectName: (projectId: string) => string | null;
}>();

const emit = defineEmits<{
  open: [taskId: string];
  edit: [taskId: string];
}>();

const { currentLocale, scheduledTaskMessage } = useScheduledTaskLocalization();
const groups = computed(() =>
  groupTasksByProject(props.tasks, props.currentProjectId, props.projectName, currentLocale.value));

function groupTitle(group: ScheduledTaskProjectGroup): string {
  const name = group.projectName ?? scheduledTaskMessage('scheduledTasks.group.unknownProject');
  return group.projectId === props.currentProjectId
    ? scheduledTaskMessage('scheduledTasks.group.currentProject', { name })
    : name;
}
</script>
