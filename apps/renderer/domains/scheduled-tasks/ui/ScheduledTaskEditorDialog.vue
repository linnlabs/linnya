<!-- 新建 / 编辑的弹窗。表单只在打开时存在，每次打开都从任务的当前值开始。 -->
<template>
  <Modal
    :is-visible="visible"
    :title="scheduledTaskMessage(task ? 'scheduledTasks.editor.titleEdit' : 'scheduledTasks.editor.titleNew')"
    width="840px"
    max-height="720px"
    :close-on-overlay-click="false"
    @close="emit('close')"
  >
    <ScheduledTaskEditor
      ref="form"
      :key="formKey"
      :task="task"
      :default-project-id="defaultProjectId"
      :initial-error="initialError"
      @saved="(saved, created) => emit('saved', saved, created)"
      @conflict="emit('conflict')"
    />
    <template #footer>
      <div class="scheduled-task-dialog-footer">
        <ActionButtons
          :primary-action-text="scheduledTaskMessage(task ? 'scheduledTasks.editor.save' : 'scheduledTasks.editor.create')"
          :secondary-action-text="scheduledTaskMessage('scheduledTasks.editor.cancel')"
          :is-primary-action-disabled="form?.saving ?? false"
          @primary-click="form?.save()"
          @secondary-click="emit('close')"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { ActionButtons, Modal } from '@linnya/renderer-ui';
import ScheduledTaskEditor from './ScheduledTaskEditor.vue';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

defineProps<{
  readonly visible: boolean;
  /** 为空是新建。 */
  readonly task: ScheduledTask | null;
  readonly defaultProjectId: string | null;
  /** 版本冲突后换一个值，表单按新版本重开。 */
  readonly formKey: number;
  readonly initialError: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [task: ScheduledTask, created: boolean];
  conflict: [];
}>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const form = ref<InstanceType<typeof ScheduledTaskEditor> | null>(null);
</script>
