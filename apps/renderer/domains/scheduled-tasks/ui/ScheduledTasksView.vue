<!--
  定时任务整页：列表、一个任务的详情，以及新建 / 编辑弹窗。
  从项目侧栏进来时 entry.projectId 是该项目，它的任务列在前面；从全局侧栏进来为 null。
-->
<template>
  <main class="scheduled-tasks-view" data-testid="scheduled-tasks-view">
    <!-- 列表一直挂着，从详情返回时滚动位置不变。 -->
    <div v-show="openedTask === null" class="scheduled-tasks-page" data-linnya-scrollbar="large">
      <div class="scheduled-tasks-page__inner">
        <PageSectionHeader
          :title="scheduledTaskMessage('scheduledTasks.title')"
          :subtitle="scheduledTaskMessage('scheduledTasks.subtitle')"
        >
          <template #actions>
            <BaseButton
              variant="outline"
              tone="accent"
              size="lg"
              shape="pill"
              block
              data-testid="scheduled-task-new"
              @click="startNew"
            >
              <template #icon><AddIcon /></template>
              {{ scheduledTaskMessage('scheduledTasks.newTask') }}
            </BaseButton>
          </template>
        </PageSectionHeader>

        <p v-if="!store.schedulerEnabled" class="scheduled-tasks-page__notice" role="status">
          {{ scheduledTaskMessage('scheduledTasks.schedulerDisabled') }}
        </p>
        <p v-else-if="store.clockAnomaly" class="scheduled-tasks-page__notice is-warning" role="status" data-testid="scheduled-tasks-clock-anomaly">
          {{ scheduledTaskMessage('scheduledTasks.clockAnomaly', { date: scheduledDate(store.clockAnomaly.now) }) }}
        </p>

        <div v-if="store.loadState === 'error'" class="scheduled-tasks-page__state" role="alert">
          <p>{{ scheduledTaskMessage('scheduledTasks.loadFailed') }}</p>
          <BaseButton variant="secondary" size="md" @click="retry">{{ scheduledTaskMessage('scheduledTasks.retry') }}</BaseButton>
        </div>

        <SkeletonRows
          v-else-if="store.loadState !== 'ready'"
          class="scheduled-tasks-page__skeleton"
          :rows="4"
          :label="scheduledTaskMessage('scheduledTasks.title')"
        />

        <div v-else-if="store.tasks.length === 0" class="scheduled-tasks-page__state">
          <ClockIcon class="scheduled-tasks-page__state-icon" />
          <p class="scheduled-tasks-page__state-title">{{ scheduledTaskMessage('scheduledTasks.empty.title') }}</p>
          <p>{{ scheduledTaskMessage('scheduledTasks.empty.hint') }}</p>
        </div>

        <template v-else>
          <ScheduledTaskList
            :tasks="store.tasks"
            :current-project-id="entry.projectId"
            :project-name="projectName"
            @open="openTask"
            @edit="startEdit"
          />
          <div v-if="store.settings" class="scheduled-tasks-page__concurrency">
            <span>{{ scheduledTaskMessage('scheduledTasks.concurrency.label') }}</span>
            <CustomSelect
              class="scheduled-tasks-page__concurrency-select"
              variant="minimal"
              min-width="88px"
              font-size="12px"
              use-portal-to-body
              :bordered="false"
              :model-value="store.settings.max_concurrent_runs"
              :options="concurrencyOptions"
              :trigger-aria-label="scheduledTaskMessage('scheduledTasks.concurrency.label')"
              @update:model-value="setConcurrency"
            />
            <span v-if="store.runningCount > 0">
              {{ scheduledTaskMessage('scheduledTasks.concurrency.running', { running: store.runningCount }) }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <div v-if="openedTask" :key="openedTask.id" class="scheduled-tasks-page" data-linnya-scrollbar="large">
      <div class="scheduled-tasks-page__inner">
        <ScheduledTaskDetail
          :task="openedTask"
          :project-name="projectName(openedTask.project_id)"
          :resolve-model-name="resolveModelName"
          @back="closeTask"
          @edit="startEdit(openedTask.id)"
          @deleted="closeTask"
          @open-conversation="conversationId => emit('open-conversation', openedTask!.project_id, conversationId)"
        />
      </div>
    </div>

    <ScheduledTaskEditorDialog
      :visible="editorOpen"
      :task="editorTask"
      :default-project-id="entry.projectId"
      :form-key="editorKey"
      :initial-error="editorError"
      @close="editorOpen = false"
      @saved="onSaved"
      @conflict="onConflict"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useHistoryTime } from '@app/localization';
import {
  SCHEDULED_TASK_CONCURRENCY_MAX,
  SCHEDULED_TASK_CONCURRENCY_MIN,
  type ScheduledTask,
} from '@app/schemas/scheduled-tasks';
import { BaseButton, CustomSelect, PageSectionHeader, SkeletonRows, type CustomSelectOption } from '@linnya/renderer-ui';
import { AddIcon, ClockIcon } from '@linnya/renderer-ui/icons';
import { useNotificationStore } from '@/app/notification';
import { buildConversationModelSelectOptions, useModelCatalogReadModel, useModelPickerReadModel } from '@/domains/model-configuration';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { refreshScheduledTasks } from '../orchestration/refreshScheduledTasks';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';
import ScheduledTaskDetail from './ScheduledTaskDetail.vue';
import ScheduledTaskEditorDialog from './ScheduledTaskEditorDialog.vue';
import ScheduledTaskList from './ScheduledTaskList.vue';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';
import '../styles/scheduledTasks.css';

const props = defineProps<{
  /**
   * 这一次进入页面的去处。每从侧栏、通知或对话卡片进来一次 visit 就变，
   * 所以停在详情时再点侧栏会回到列表，再点同一个任务的通知会重新打开它。
   */
  readonly entry: { readonly projectId: string | null; readonly scheduledTaskId: string | null; readonly visit: number };
}>();

const emit = defineEmits<{
  'open-conversation': [projectId: string, conversationId: string];
}>();

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledDate } = useHistoryTime();
const store = useScheduledTasksStore();
const projectsStore = useWorkspaceProjectsStore();
const modelPicker = useModelPickerReadModel();
const modelCatalog = useModelCatalogReadModel();
const notifications = useNotificationStore();

const openedTaskId = ref<string | null>(null);
/** 任务在别处被删掉时自然回到列表。 */
const openedTask = computed<ScheduledTask | null>(() =>
  openedTaskId.value === null ? null : store.taskById(openedTaskId.value));
watch(() => props.entry.visit, () => { openedTaskId.value = props.entry.scheduledTaskId; }, { immediate: true });

function openTask(taskId: string): void {
  openedTaskId.value = taskId;
}

function closeTask(): void {
  openedTaskId.value = null;
}

function projectName(projectId: string): string | null {
  return projectsStore.projects.find(project => project.id === projectId)?.name ?? null;
}

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

// ---- 新建与编辑 ----

const editorOpen = ref(false);
/** 打开时的任务；弹窗收起的过程中标题不变。 */
const editorTask = shallowRef<ScheduledTask | null>(null);
const editorKey = ref(0);
const editorError = ref('');

function openEditor(task: ScheduledTask | null): void {
  editorTask.value = task;
  editorError.value = '';
  editorKey.value += 1;
  editorOpen.value = true;
}

function startNew(): void {
  openEditor(null);
}

function startEdit(taskId: string): void {
  const task = store.taskById(taskId);
  if (task) openEditor(task);
}

function onSaved(task: ScheduledTask, created: boolean): void {
  store.applyTask(task);
  editorOpen.value = false;
  if (created) openTask(task.id);
  else notifications.show(scheduledTaskMessage('scheduledTasks.detail.saved'), 'success');
}

/** 版本冲突：重读后按新版本重开表单，用户再改一次；任务已经没了就收起。 */
async function onConflict(): Promise<void> {
  const taskId = editorTask.value?.id;
  await refreshScheduledTasks();
  const task = taskId === undefined ? null : store.taskById(taskId);
  if (!task) {
    editorOpen.value = false;
    return;
  }
  editorTask.value = task;
  editorError.value = scheduledTaskMessage('scheduledTasks.editor.revisionConflict');
  editorKey.value += 1;
}

// ---- 同时运行的数量 ----

const concurrencyOptions = computed<CustomSelectOption<number>[]>(() => Array.from(
  { length: SCHEDULED_TASK_CONCURRENCY_MAX - SCHEDULED_TASK_CONCURRENCY_MIN + 1 },
  (_, index) => {
    const count = SCHEDULED_TASK_CONCURRENCY_MIN + index;
    return { value: count, text: scheduledTaskMessage('scheduledTasks.concurrency.option', { count }) };
  },
));

async function setConcurrency(next: number): Promise<void> {
  if (next === store.settings?.max_concurrent_runs) return;
  try {
    store.applySettings(await scheduledTasksClient.setSettings({ max_concurrent_runs: next }));
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 保存并发设置失败', error);
    notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: String(error) }), 'error');
  }
}

function retry(): void {
  void refreshScheduledTasks();
}
</script>
