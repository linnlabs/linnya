<!--
  删除定时任务的确认框。任务正在运行时多给一个“同时停止”的勾选，默认不停，让正在跑的这次跑完。
-->
<template>
  <Modal
    :is-visible="visible"
    :title="scheduledTaskMessage('scheduledTasks.delete.title', { name: task.name })"
    width="460px"
    min-height="auto"
    layer="alert"
    @close="emit('cancel')"
  >
    <div class="scheduled-task-delete">
      <p class="scheduled-task-delete__message">
        {{ scheduledTaskMessage(isRunning ? 'scheduledTasks.delete.runningMessage' : 'scheduledTasks.delete.message', { count: task.run_count }) }}
      </p>
      <CustomCheckbox v-if="isRunning" v-model="stopRunning">
        {{ scheduledTaskMessage('scheduledTasks.delete.stopRunning') }}
      </CustomCheckbox>
    </div>
    <template #footer>
      <ActionButtons
        :primary-action-text="scheduledTaskMessage('scheduledTasks.delete.confirm')"
        :secondary-action-text="scheduledTaskMessage('scheduledTasks.editor.cancel')"
        primary-variant="danger"
        :is-primary-action-disabled="busy"
        @primary-click="emit('confirm', isRunning && stopRunning)"
        @secondary-click="emit('cancel')"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { ActionButtons, CustomCheckbox, Modal } from '@linnya/renderer-ui';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  readonly visible: boolean;
  readonly task: ScheduledTask;
  readonly busy: boolean;
}>();

const emit = defineEmits<{
  confirm: [stopRunning: boolean];
  cancel: [];
}>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const stopRunning = ref(false);
const isRunning = computed(() => props.task.state === 'running' || props.task.state === 'awaiting_approval');
watch(() => props.visible, visible => {
  if (visible) stopRunning.value = false;
});
</script>
