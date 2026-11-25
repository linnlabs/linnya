<!-- 一个任务的设置与运行记录。操作结果都以 App Server 返回的任务为准写回 store。 -->
<template>
  <div class="scheduled-task-detail" data-testid="scheduled-task-detail">
    <button type="button" class="scheduled-task-detail__back" data-testid="scheduled-task-back" @click="emit('back')">
      <ChevronIcon direction="left" class="scheduled-task-detail__back-icon" />
      {{ scheduledTaskMessage('scheduledTasks.title') }}
    </button>

    <header class="scheduled-task-detail__header">
      <div class="scheduled-task-detail__heading">
        <h1 class="scheduled-task-detail__title">{{ task.name }}</h1>
        <p class="scheduled-task-detail__line">{{ summaryLine }}</p>
      </div>
      <div class="scheduled-task-detail__actions">
        <Switch
          class="scheduled-task-detail__switch"
          :model-value="enabled"
          :ariaLabel="scheduledTaskMessage('scheduledTasks.detail.enabled')"
          :disabled="task.state === 'finished' || busy"
          @update:model-value="setEnabled"
        />
        <BaseButton variant="secondary" size="md" :disabled="busy" data-testid="scheduled-task-run-now" @click="runNow">
          {{ scheduledTaskMessage('scheduledTasks.detail.runNow') }}
        </BaseButton>
        <BaseButton variant="secondary" size="md" data-testid="scheduled-task-edit" @click="emit('edit')">
          {{ scheduledTaskMessage('scheduledTasks.detail.edit') }}
        </BaseButton>
        <ScheduledTaskMoreMenu :actions="['delete']" @select="deleteOpen = true" />
      </div>
    </header>

    <div v-if="banner" class="scheduled-task-banner" :class="`is-${banner.tone}`" role="status">
      <span>{{ banner.text }}</span>
      <BaseButton variant="secondary" size="sm" :disabled="busy" @click="handleBannerAction(banner.action.kind)">
        {{ banner.action.label }}
      </BaseButton>
    </div>

    <section class="scheduled-task-brief" :aria-label="scheduledTaskMessage('scheduledTasks.fact.prompt')">
      <p class="scheduled-task-brief__prompt">{{ task.prompt }}</p>
      <dl class="scheduled-task-brief__facts">
        <div v-for="fact in facts" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd :class="fact.tone ? `is-${fact.tone}` : undefined" :title="fact.value">{{ fact.value }}</dd>
        </div>
      </dl>
      <p v-if="sourceText" class="scheduled-task-brief__source">{{ sourceText }}</p>
    </section>

    <ScheduledTaskRuns :task="task" @open-conversation="emit('open-conversation', $event)" />

    <DeleteScheduledTaskDialog
      :visible="deleteOpen"
      :task="task"
      :busy="busy"
      @confirm="confirmDelete"
      @cancel="deleteOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useHistoryTime } from '@app/localization';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { BaseButton, Switch } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useSettingsLocalization } from '@/domains/settings/public';
import { PERMISSION_LEVEL_LABEL_KEYS } from '../functions/permissionLevelMessages';
import { describeSchedule } from '../functions/describeSchedule';
import {
  isTaskEnabled,
  presentTaskState,
  resolveTaskBanner,
  type ScheduledTaskBannerAction,
} from '../functions/presentScheduledTask';
import DeleteScheduledTaskDialog from './DeleteScheduledTaskDialog.vue';
import ScheduledTaskMoreMenu from './ScheduledTaskMoreMenu.vue';
import ScheduledTaskRuns from './ScheduledTaskRuns.vue';
import { useScheduledTaskActions } from './useScheduledTaskActions';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  readonly task: ScheduledTask;
  readonly projectName: string | null;
  /** 模型 ID 到显示名；查不到为 null。 */
  readonly resolveModelName: (modelConfigId: string) => string | null;
}>();

const emit = defineEmits<{
  back: [];
  edit: [];
  deleted: [];
  'open-conversation': [conversationId: string];
}>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledTime, scheduledDate } = useHistoryTime();
const { settingsMessage } = useSettingsLocalization();
const { busy, setEnabled, runNow, deleteTask } = useScheduledTaskActions(() => props.task);

const deleteOpen = ref(false);
const enabled = computed(() => isTaskEnabled(props.task));
const banner = computed(() => resolveTaskBanner(props.task, scheduledTaskMessage));

const summaryLine = computed(() => {
  const nextRun = props.task.next_run_at === null ? null : scheduledTime(props.task.next_run_at);
  return [
    describeSchedule(props.task.schedule, scheduledTaskMessage, scheduledDate),
    presentTaskState(props.task, scheduledTaskMessage, nextRun).text,
  ].join(' · ');
});

const modelName = computed(() => {
  const id = props.task.model_config_id;
  if (id === null) return scheduledTaskMessage('scheduledTasks.model.default');
  return props.resolveModelName(id) ?? scheduledTaskMessage('scheduledTasks.model.unknown');
});

const facts = computed<readonly { label: string; value: string; tone?: 'error' | 'warning' }[]>(() => [
  {
    label: scheduledTaskMessage('scheduledTasks.fact.project'),
    value: props.projectName ?? scheduledTaskMessage('scheduledTasks.group.unknownProject'),
  },
  {
    label: scheduledTaskMessage('scheduledTasks.fact.agent'),
    value: scheduledTaskMessage(props.task.agent === 'research' ? 'scheduledTasks.agent.research' : 'scheduledTasks.agent.default'),
  },
  {
    label: scheduledTaskMessage('scheduledTasks.fact.model'),
    value: modelName.value,
    ...(props.task.model_unavailable ? { tone: 'error' as const } : {}),
  },
  {
    label: scheduledTaskMessage('scheduledTasks.fact.permission'),
    value: settingsMessage(PERMISSION_LEVEL_LABEL_KEYS[props.task.permission_level]),
    ...(props.task.permission_level === 'full_access' ? { tone: 'warning' as const } : {}),
  },
  {
    label: scheduledTaskMessage('scheduledTasks.fact.missed'),
    value: scheduledTaskMessage(props.task.missed_policy === 'skip' ? 'scheduledTasks.missed.skip' : 'scheduledTasks.missed.runLatest'),
  },
]);

/** 自己建的不用说；Agent 建的写明来自哪段对话。 */
const sourceText = computed(() => {
  const source = props.task.source;
  if (source.kind === 'user') return '';
  return source.conversation_title === null
    ? scheduledTaskMessage('scheduledTasks.source.agentDeletedConversation')
    : scheduledTaskMessage('scheduledTasks.source.agent', { title: source.conversation_title });
});

function handleBannerAction(kind: ScheduledTaskBannerAction): void {
  switch (kind) {
    case 'open_approval': {
      const conversationId = props.task.last_run?.conversation_id;
      if (conversationId) emit('open-conversation', conversationId);
      return;
    }
    case 'resume':
      void setEnabled(true);
      return;
    case 'edit':
      emit('edit');
  }
}

async function confirmDelete(stopRunning: boolean): Promise<void> {
  if (!await deleteTask(stopRunning)) return;
  deleteOpen.value = false;
  emit('deleted');
}
</script>
