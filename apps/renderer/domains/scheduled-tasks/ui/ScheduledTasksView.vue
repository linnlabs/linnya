<!--
  定时任务整页：顶部说明与并发设置，左侧任务列表，右侧选中任务的详情或编辑表单。
  从项目侧栏进来时 `projectId` 是该项目，当前项目的任务列在前面；从全局侧栏进来为 null。
-->
<template>
  <main class="scheduled-tasks-view" data-testid="scheduled-tasks-view">
    <header class="scheduled-tasks-view__header">
      <div class="scheduled-tasks-view__heading">
        <h2 class="scheduled-tasks-view__title">{{ scheduledTaskMessage('scheduledTasks.title') }}</h2>
        <p class="scheduled-tasks-view__subtitle">{{ scheduledTaskMessage('scheduledTasks.subtitle') }}</p>
      </div>
      <div class="scheduled-tasks-view__toolbar">
        <span v-if="store.settings" class="scheduled-tasks-view__concurrency">
          {{ scheduledTaskMessage('scheduledTasks.concurrency.before') }}
          <CustomNumberInput
            :model-value="store.settings.max_concurrent_runs"
            :min="SCHEDULED_TASK_CONCURRENCY_MIN"
            :max="SCHEDULED_TASK_CONCURRENCY_MAX"
            :step="1"
            input-width="72px"
            show-spin-buttons
            @update:model-value="setConcurrency"
          />
          {{ scheduledTaskMessage('scheduledTasks.concurrency.after') }}
          <span v-if="store.runningCount > 0" class="scheduled-tasks-view__running">
            {{ scheduledTaskMessage('scheduledTasks.concurrency.running', { running: store.runningCount }) }}
          </span>
        </span>
        <BaseButton variant="primary" size="md" data-testid="scheduled-task-new" @click="startNew">
          <template #icon><AddIcon /></template>
          {{ scheduledTaskMessage('scheduledTasks.newTask') }}
        </BaseButton>
      </div>
    </header>

    <p v-if="!store.schedulerEnabled" class="scheduled-tasks-view__disabled" role="status">
      {{ scheduledTaskMessage('scheduledTasks.schedulerDisabled') }}
    </p>

    <div v-if="store.loadState === 'error'" class="scheduled-tasks-view__state" role="alert">
      <p>{{ scheduledTaskMessage('scheduledTasks.loadFailed') }}</p>
      <BaseButton variant="secondary" size="sm" @click="retry">{{ scheduledTaskMessage('scheduledTasks.retry') }}</BaseButton>
    </div>

    <div v-else-if="store.loadState !== 'ready'" class="scheduled-tasks-view__state">
      <SkeletonRows :rows="4" :label="scheduledTaskMessage('scheduledTasks.title')" />
    </div>

    <div v-else-if="store.tasks.length === 0 && editing === null" class="scheduled-tasks-view__state scheduled-tasks-view__empty">
      <ClockIcon class="scheduled-tasks-view__empty-icon" />
      <p class="scheduled-tasks-view__empty-title">{{ scheduledTaskMessage('scheduledTasks.empty.title') }}</p>
      <p class="scheduled-tasks-view__empty-hint">{{ scheduledTaskMessage('scheduledTasks.empty.hint') }}</p>
    </div>

    <div v-else class="scheduled-tasks-view__body">
      <ScheduledTaskList
        :tasks="store.tasks"
        :current-project-id="projectId"
        :selected-task-id="editing === 'new' ? null : selectedTaskId"
        :project-name="projectName"
        @select="selectTask"
      />
      <section class="scheduled-tasks-view__pane">
        <ScheduledTaskEditor
          v-if="editing !== null"
          :key="editorKey"
          :task="editing === 'edit' ? selectedTask : null"
          :default-project-id="projectId ?? selectedTask?.project_id ?? null"
          :initial-error="editorError"
          @saved="onSaved"
          @cancel="editing = null"
          @conflict="onConflict"
        />
        <ScheduledTaskDetail
          v-else-if="selectedTask"
          :task="selectedTask"
          :project-name="projectName(selectedTask.project_id)"
          :resolve-model-name="resolveModelName"
          :notice="notice"
          @edit="startEdit"
          @deleted="onDeleted"
          @open-conversation="conversationId => openConversation(selectedTask!.project_id, conversationId)"
        />
        <p v-else class="scheduled-tasks-view__select">{{ scheduledTaskMessage('scheduledTasks.select') }}</p>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  SCHEDULED_TASK_CONCURRENCY_MAX,
  SCHEDULED_TASK_CONCURRENCY_MIN,
  type ScheduledTask,
} from '@app/schemas/scheduled-tasks';
import { BaseButton, CustomNumberInput, SkeletonRows } from '@linnya/renderer-ui';
import { AddIcon, ClockIcon } from '@linnya/renderer-ui/icons';
import { useNotificationStore } from '@/app/notification';
import { buildConversationModelSelectOptions, useModelCatalogReadModel, useModelPickerReadModel } from '@/domains/model-configuration';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { refreshScheduledTasks } from '../orchestration/refreshScheduledTasks';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';
import ScheduledTaskDetail from './ScheduledTaskDetail.vue';
import ScheduledTaskEditor from './ScheduledTaskEditor.vue';
import ScheduledTaskList from './ScheduledTaskList.vue';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';
import '../styles/scheduledTasks.css';

const props = defineProps<{
  readonly projectId: string | null;
  /** 从通知、折叠行等处进来时要选中的任务。 */
  readonly initialTaskId?: string | null;
}>();

const emit = defineEmits<{
  'open-conversation': [projectId: string, conversationId: string];
}>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const store = useScheduledTasksStore();
const projectsStore = useWorkspaceProjectsStore();
const modelPicker = useModelPickerReadModel();
const modelCatalog = useModelCatalogReadModel();
const notifications = useNotificationStore();

const selectedTaskId = ref<string | null>(props.initialTaskId ?? null);
const editing = ref<'new' | 'edit' | null>(null);
const editorKey = ref(0);
const notice = ref('');
const editorError = ref('');

const selectedTask = computed<ScheduledTask | null>(() =>
  selectedTaskId.value === null ? null : store.taskById(selectedTaskId.value));

function projectName(projectId: string): string | null {
  return projectsStore.projects.find(project => project.id === projectId)?.name ?? null;
}

/** 默认选中：当前项目的第一个，没有就整张表第一个；选中的任务被删了也回到这里。 */
function firstTaskId(): string | null {
  const inProject = props.projectId === null ? undefined : store.tasks.find(task => task.project_id === props.projectId);
  return (inProject ?? store.tasks[0])?.id ?? null;
}
watch(() => [store.tasks, props.projectId] as const, () => {
  if (editing.value === 'new') return;
  if (selectedTaskId.value === null || !store.taskById(selectedTaskId.value)) {
    selectedTaskId.value = firstTaskId();
    if (editing.value === 'edit' && selectedTaskId.value === null) editing.value = null;
  }
}, { immediate: true });
watch(() => props.initialTaskId, taskId => {
  if (taskId) selectTask(taskId);
});

const modelNames = computed(() => {
  const names = new Map<string, string>();
  const options = buildConversationModelSelectOptions({
    snapshot: modelPicker.snapshot.value,
    labels: { providerGroup: '', customGroup: '', unavailable: '' },
  });
  for (const option of options) {
    if (!('isGroup' in option && option.isGroup) && typeof option.value === 'string' && option.text) {
      names.set(option.value, option.text);
    }
  }
  return names;
});
/** 先用选择器里的显示名；在模型管理里被隐藏的模型不在选择器里，退回目录里的名字。 */
function resolveModelName(modelConfigId: string): string | null {
  return modelNames.value.get(modelConfigId)
    ?? modelCatalog.models.value.find(model => model.id === modelConfigId)?.display_name
    ?? null;
}

function selectTask(taskId: string): void {
  selectedTaskId.value = taskId;
  editing.value = null;
  notice.value = '';
  editorError.value = '';
}

function startNew(): void {
  editing.value = 'new';
  editorKey.value += 1;
  notice.value = '';
  editorError.value = '';
}

function startEdit(): void {
  editing.value = 'edit';
  editorKey.value += 1;
  notice.value = '';
  editorError.value = '';
}

function onSaved(task: ScheduledTask, created: boolean): void {
  store.applyTask(task);
  selectedTaskId.value = task.id;
  editing.value = null;
  notice.value = created ? '' : scheduledTaskMessage('scheduledTasks.detail.saved');
}

/** 版本冲突：重读后按新版本重开表单，用户再改一次。 */
async function onConflict(): Promise<void> {
  await refreshScheduledTasks();
  editorError.value = scheduledTaskMessage('scheduledTasks.editor.revisionConflict');
  editorKey.value += 1;
}

function onDeleted(): void {
  selectedTaskId.value = firstTaskId();
  notice.value = '';
}

function openConversation(projectId: string, conversationId: string): void {
  emit('open-conversation', projectId, conversationId);
}

async function setConcurrency(value: unknown): Promise<void> {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next) || !store.settings || next === store.settings.max_concurrent_runs) return;
  const clamped = Math.min(SCHEDULED_TASK_CONCURRENCY_MAX, Math.max(SCHEDULED_TASK_CONCURRENCY_MIN, next));
  try {
    store.applySettings(await scheduledTasksClient.setSettings({ max_concurrent_runs: clamped }));
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 保存并发设置失败', error);
    notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: String(error) }), 'error');
  }
}

function retry(): void {
  void refreshScheduledTasks();
}
</script>
