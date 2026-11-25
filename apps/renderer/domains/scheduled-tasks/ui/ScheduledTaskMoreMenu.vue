<!-- “更多”菜单：挂到 body，不被滚动的页面裁切。列表行与详情共用。 -->
<template>
  <CustomSelect
    class="scheduled-task-more"
    semantic-role="menu"
    variant="minimal"
    min-width="144px"
    hide-arrow
    use-portal-to-body
    :bordered="false"
    :model-value="null"
    :options="options"
    :trigger-tooltip="scheduledTaskMessage('scheduledTasks.detail.more')"
    :class-names="{ trigger: 'scheduled-task-more__trigger' }"
    @update:model-value="action => emit('select', action)"
  >
    <template #selected-value><MoreIcon class="scheduled-task-more__icon" /></template>
  </CustomSelect>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CustomSelect, type CustomSelectOption } from '@linnya/renderer-ui';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

export type ScheduledTaskMenuAction = 'run' | 'edit' | 'delete';

const props = defineProps<{ readonly actions: readonly ScheduledTaskMenuAction[] }>();
const emit = defineEmits<{ select: [action: ScheduledTaskMenuAction] }>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();

const LABELS = {
  run: 'scheduledTasks.detail.runNow',
  edit: 'scheduledTasks.detail.edit',
  delete: 'scheduledTasks.detail.delete',
} as const satisfies Record<ScheduledTaskMenuAction, string>;

const options = computed<CustomSelectOption<ScheduledTaskMenuAction>[]>(() => props.actions.map(action => ({
  value: action,
  text: scheduledTaskMessage(LABELS[action]),
  ...(action === 'delete' ? { variant: 'danger' as const } : {}),
})));
</script>
