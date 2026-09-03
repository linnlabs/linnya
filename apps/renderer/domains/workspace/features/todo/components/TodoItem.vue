<template>
  <div
    class="todo-item"
    :class="{ 'is-completed': isFinished }"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
  >
    <div class="main-content">
      <!-- Checkbox -->
      <CustomCheckbox
        class="todo-checkbox"
        :model-value="isFinished"
        @update:modelValue="$emit('toggleComplete', todo.id)"
      />

      <!-- Content -->
      <div class="details">
        <p :class="['title', { 'is-finished': isFinished }]">
          {{ todo.title }}
        </p>

        <!-- Tags and Info Row -->
        <div class="info-row">
          <!-- Priority Badge -->
          <span
            v-if="todo.priority"
            :class="['badge', `priority-${todo.priority}`]"
          >
            <span class="badge-dot" />
            {{ priorityText[todo.priority] }}
          </span>

          <!-- Custom Tags -->
          <span
            v-for="tag in todo.customTags"
            :key="tag"
            class="badge tag-badge"
          >
            <TagIcon class="tag-icon" />
            {{ tag }}
          </span>

          <!-- Due Date -->
          <span 
            v-if="dueDateMeta" 
            :class="['badge', 'date-badge', dueDateMeta && `date-${dueDateMeta.status}`]"
          >
            <CalendarIcon class="date-icon" />
            {{ dueDateMeta.label }}
          </span>
        </div>
      </div>

      <!-- Actions -->
      <div v-if="showActions" class="actions">
        <button
          @click="$emit('delete', todo.id)"
          class="delete-button"
          :title="workspaceMessage('workspace.todo.item.delete')"
        >
          <DeleteIcon class="delete-icon" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Todo } from '../types';
import { CustomCheckbox } from '@linnya/renderer-ui';
import { DeleteIcon } from '@linnya/renderer-ui/icons';
import { CalendarIcon } from '@linnya/renderer-ui/icons';
import { TagIcon } from '@linnya/renderer-ui/icons';
import { useWorkspaceLocalization } from '../../../ui/useWorkspaceLocalization';

interface Props {
  todo: Todo;
  isCompleted?: boolean;
}

const props = defineProps<Props>();
defineEmits(['toggleComplete', 'delete']);
const { currentLocale, workspaceMessage } = useWorkspaceLocalization();

const showActions = ref(false);

const isFinished = computed(() => props.isCompleted || props.todo.status === 'completed');

const priorityText = computed(() => ({
  high: workspaceMessage('workspace.todo.priority.high'),
  medium: workspaceMessage('workspace.todo.priority.medium'),
  low: workspaceMessage('workspace.todo.priority.low'),
}));

type DueStatus = 'today' | 'tomorrow' | 'overdue' | 'upcoming';

const getStartOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const dueDateMeta = computed<null | { label: string; status: DueStatus }>(() => {
  const dueDateString = props.todo.dueDate;
  if (!dueDateString) return null;

  const dueDate = new Date(dueDateString);
  if (Number.isNaN(dueDate.getTime())) return null;

  const startOfToday = getStartOfDay(new Date());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDue = getStartOfDay(dueDate);

  if (startOfDue.getTime() === startOfToday.getTime()) {
    return { label: workspaceMessage('workspace.todo.date.today'), status: 'today' };
  }

  if (startOfDue.getTime() === startOfTomorrow.getTime()) {
    return { label: workspaceMessage('workspace.todo.date.tomorrow'), status: 'tomorrow' };
  }

  const formatted = dueDate.toLocaleDateString(currentLocale.value, { month: 'short', day: 'numeric' });

  if (startOfDue < startOfToday) {
    return { label: formatted, status: 'overdue' };
  }

  return { label: formatted, status: 'upcoming' };
});
</script>
