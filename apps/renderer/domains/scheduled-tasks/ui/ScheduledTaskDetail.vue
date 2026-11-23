<!--
  选中任务的设置与运行记录。所有操作的结果都以 App Server 返回的任务为准写回 store。
-->
<template>
  <div class="scheduled-task-detail" data-testid="scheduled-task-detail">
    <p v-if="notice" class="scheduled-task-detail__saved" role="status">{{ notice }}</p>

    <header class="scheduled-task-detail__header">
      <div class="scheduled-task-detail__heading">
        <h3 class="scheduled-task-detail__title">{{ task.name }}</h3>
        <p class="scheduled-task-detail__source">{{ sourceLine }}</p>
      </div>
      <div class="scheduled-task-detail__actions">
        <label class="scheduled-task-detail__enable">
          <Switch
            :model-value="enabled"
            :ariaLabel="scheduledTaskMessage('scheduledTasks.detail.enabled')"
            :disabled="task.state === 'finished' || busy"
            @update:model-value="setEnabled"
          />
          {{ scheduledTaskMessage(enabled ? 'scheduledTasks.detail.enabled' : 'scheduledTasks.detail.paused') }}
        </label>
        <BaseButton variant="secondary" size="sm" :disabled="busy" data-testid="scheduled-task-run-now" @click="runNow">
          {{ scheduledTaskMessage('scheduledTasks.detail.runNow') }}
        </BaseButton>
        <BaseButton variant="secondary" size="sm" data-testid="scheduled-task-edit" @click="emit('edit')">
          {{ scheduledTaskMessage('scheduledTasks.detail.edit') }}
        </BaseButton>
        <BaseDropdown class="scheduled-task-detail__more">
          <template #trigger="{ toggle, isOpen }">
            <IconButton
              :label="scheduledTaskMessage('scheduledTasks.detail.more')"
              size="md"
              :active="isOpen"
              aria-haspopup="menu"
              :aria-expanded="isOpen"
              @click="toggle"
            >
              <MoreIcon />
            </IconButton>
          </template>
          <template #content="{ isOpen, close }">
            <DropdownPanel :show="isOpen" class="scheduled-task-detail__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                class="scheduled-task-detail__menu-item is-danger"
                @click="close(); deleteOpen = true"
              >{{ scheduledTaskMessage('scheduledTasks.detail.delete') }}</button>
            </DropdownPanel>
          </template>
        </BaseDropdown>
      </div>
    </header>

    <div v-if="banner" class="scheduled-task-banner" :class="`is-${banner.tone}`" role="status">
      <span>{{ banner.text }}</span>
      <BaseButton v-if="banner.action" variant="secondary" size="sm" :disabled="busy" @click="handleBannerAction(banner.action.kind)">
        {{ banner.action.label }}
      </BaseButton>
    </div>

    <dl class="scheduled-task-facts">
      <div><dt>{{ scheduledTaskMessage('scheduledTasks.fact.schedule') }}</dt><dd>{{ scheduleText }}</dd></div>
      <div><dt>{{ scheduledTaskMessage('scheduledTasks.fact.nextRun') }}</dt><dd>{{ nextRunText ?? '—' }}</dd></div>
      <div><dt>{{ scheduledTaskMessage('scheduledTasks.fact.agent') }}</dt><dd>{{ agentText }}</dd></div>
      <div><dt>{{ scheduledTaskMessage('scheduledTasks.fact.model') }}</dt><dd :class="{ 'is-error': task.model_unavailable }">{{ modelName }}</dd></div>
      <div>
        <dt>{{ scheduledTaskMessage('scheduledTasks.fact.permission') }}</dt>
        <dd :class="{ 'is-full-access': task.permission_level === 'full_access' }">{{ levelText }}</dd>
      </div>
      <div>
        <dt>{{ scheduledTaskMessage('scheduledTasks.fact.missed') }}</dt>
        <dd>{{ scheduledTaskMessage(task.missed_policy === 'skip' ? 'scheduledTasks.missed.skip' : 'scheduledTasks.missed.runLatest') }}</dd>
      </div>
      <div class="is-wide">
        <dt>{{ scheduledTaskMessage('scheduledTasks.fact.prompt') }}</dt>
        <dd class="scheduled-task-facts__prompt">{{ task.prompt }}</dd>
      </div>
    </dl>

    <ScheduledTaskRuns :task="task" @open-conversation="emit('open-conversation', $event)" />

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
import type { ScheduledTask, ScheduledTaskMutationResult } from '@app/schemas/scheduled-tasks';
import { BaseButton, BaseDropdown, DropdownPanel, IconButton, Switch } from '@linnya/renderer-ui';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { useNotificationStore } from '@/app/notification';
import { useSettingsLocalization } from '@/domains/settings/public';
import { PERMISSION_LEVEL_LABEL_KEYS } from '../functions/permissionLevelMessages';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { describeSchedule } from '../functions/describeSchedule';
import { isTaskEnabled, resolveTaskBanner, type ScheduledTaskBannerAction } from '../functions/presentScheduledTask';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';
import DeleteScheduledTaskDialog from './DeleteScheduledTaskDialog.vue';
import ScheduledTaskRuns from './ScheduledTaskRuns.vue';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  readonly task: ScheduledTask;
  readonly projectName: string | null;
  /** 模型 ID 到显示名；查不到为 null。 */
  readonly resolveModelName: (modelConfigId: string) => string | null;
  /** 保存、创建后的一句提示，由外层在切换任务时清掉。 */
  readonly notice: string;
}>();

const emit = defineEmits<{
  edit: [];
  deleted: [taskId: string];
  'open-conversation': [conversationId: string];
}>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledTime, scheduledDate } = useHistoryTime();
const { settingsMessage } = useSettingsLocalization();
const store = useScheduledTasksStore();
const notifications = useNotificationStore();

const busy = ref(false);
const deleteOpen = ref(false);

const enabled = computed(() => isTaskEnabled(props.task));
const banner = computed(() => resolveTaskBanner(props.task, scheduledTaskMessage));

const sourceLine = computed(() => {
  const project = props.projectName ?? scheduledTaskMessage('scheduledTasks.group.unknownProject');
  const source = props.task.source;
  const sourceText = source.kind === 'user'
    ? scheduledTaskMessage('scheduledTasks.source.user')
    : source.conversation_title === null
      ? scheduledTaskMessage('scheduledTasks.source.agentDeletedConversation')
      : scheduledTaskMessage('scheduledTasks.source.agent', { title: source.conversation_title });
  return `${project} · ${sourceText}`;
});

const scheduleText = computed(() => describeSchedule(props.task.schedule, scheduledTaskMessage, scheduledDate));
const nextRunText = computed(() => (props.task.next_run_at === null ? null : scheduledTime(props.task.next_run_at)));
const agentText = computed(() =>
  scheduledTaskMessage(props.task.agent === 'research' ? 'scheduledTasks.agent.research' : 'scheduledTasks.agent.default'));
const modelName = computed(() => {
  const id = props.task.model_config_id;
  if (id === null) return scheduledTaskMessage('scheduledTasks.model.default');
  return props.resolveModelName(id) ?? scheduledTaskMessage('scheduledTasks.model.unknown');
});
const levelText = computed(() => settingsMessage(PERMISSION_LEVEL_LABEL_KEYS[props.task.permission_level]));

async function mutate(action: () => Promise<ScheduledTaskMutationResult>): Promise<ScheduledTask | null> {
  if (busy.value) return null;
  busy.value = true;
  try {
    const result = await action();
    if (result.ok) {
      store.applyTask(result.task);
      return result.task;
    }
    notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: result.message }), 'error');
    return null;
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 操作失败', error);
    notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: String(error) }), 'error');
    return null;
  } finally {
    busy.value = false;
  }
}

function setEnabled(value: boolean): void {
  void mutate(() => scheduledTasksClient.setEnabled(props.task.id, value));
}

async function runNow(): Promise<void> {
  const task = await mutate(() => scheduledTasksClient.runNow(props.task.id));
  if (!task) return;
  notifications.show(
    scheduledTaskMessage(task.state === 'queued' ? 'scheduledTasks.runNow.queued' : 'scheduledTasks.runNow.started'),
    'success',
  );
}

function handleBannerAction(kind: ScheduledTaskBannerAction): void {
  switch (kind) {
    case 'open_approval': {
      const conversationId = props.task.last_run?.conversation_id;
      if (conversationId) emit('open-conversation', conversationId);
      return;
    }
    case 'resume':
      setEnabled(true);
      return;
    case 'edit':
      emit('edit');
  }
}

async function deleteTask(stopRunning: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  const taskId = props.task.id;
  try {
    const result = await scheduledTasksClient.delete({ task_id: taskId, stop_running: stopRunning });
    if (!result.ok && result.code !== 'task_not_found') {
      notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: result.message }), 'error');
      return;
    }
    deleteOpen.value = false;
    store.removeTask(taskId);
    emit('deleted', taskId);
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 删除失败', error);
    notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: String(error) }), 'error');
  } finally {
    busy.value = false;
  }
}
</script>
