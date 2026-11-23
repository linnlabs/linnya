<!--
  视图左侧的任务列表：项目视图先列当前项目，再列其他项目；全局视图按项目分组。
-->
<template>
  <nav class="scheduled-task-list" :aria-label="scheduledTaskMessage('scheduledTasks.title')">
    <template v-if="groups.current">
      <div class="scheduled-task-list__group">
        {{ scheduledTaskMessage('scheduledTasks.group.currentProject', { name: groups.current.projectName ?? '' }) }}
      </div>
      <ScheduledTaskListRow
        v-for="task in groups.current.tasks"
        :key="task.id"
        :task="task"
        :selected="task.id === selectedTaskId"
        @select="emit('select', task.id)"
      />
    </template>

    <template v-if="groups.others.length > 0">
      <div v-if="groups.current" class="scheduled-task-list__group scheduled-task-list__group--other">
        {{ scheduledTaskMessage('scheduledTasks.group.otherProjects') }}
      </div>
      <template v-for="group in groups.others" :key="group.projectId">
        <div class="scheduled-task-list__project">
          {{ group.projectName ?? scheduledTaskMessage('scheduledTasks.group.unknownProject') }}
        </div>
        <ScheduledTaskListRow
          v-for="task in group.tasks"
          :key="task.id"
          :task="task"
          :selected="task.id === selectedTaskId"
          @select="emit('select', task.id)"
        />
      </template>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { groupTasksByProject } from '../functions/presentScheduledTask';
import ScheduledTaskListRow from './ScheduledTaskListRow.vue';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  readonly tasks: readonly ScheduledTask[];
  readonly currentProjectId: string | null;
  readonly selectedTaskId: string | null;
  readonly projectName: (projectId: string) => string | null;
}>();

const emit = defineEmits<{ select: [taskId: string] }>();

const { currentLocale, scheduledTaskMessage } = useScheduledTaskLocalization();
const groups = computed(() =>
  groupTasksByProject(props.tasks, props.currentProjectId, props.projectName, currentLocale.value));
</script>
