<!--
  定时任务的表单：左边像写消息一样写任务，右边定时间。
  下次运行、月历上的运行日期与时间表校验一律问 App Server（previewSchedule），这里不推算。
-->
<template>
  <form class="scheduled-task-editor" novalidate @submit.prevent="save">
    <div class="scheduled-task-editor__brief">
      <CustomTextInput
        ref="nameInput"
        v-model="name"
        control-class="scheduled-task-editor__name"
        :bordered="false"
        :maxlength="SCHEDULED_TASK_NAME_MAX_CHARS"
        :placeholder="scheduledTaskMessage('scheduledTasks.editor.namePlaceholder')"
        :aria-label="scheduledTaskMessage('scheduledTasks.editor.name')"
        data-testid="scheduled-task-name"
      />
      <p v-if="nameError" class="scheduled-task-editor__error is-inset">{{ nameError }}</p>
      <p v-if="promptError" class="scheduled-task-editor__error is-inset">{{ promptError }}</p>
      <CustomTextarea
        v-model="prompt"
        class="scheduled-task-editor__prompt-field"
        control-class="scheduled-task-editor__prompt"
        :bordered="false"
        :rows="6"
        :maxlength="SCHEDULED_TASK_PROMPT_MAX_CHARS"
        :placeholder="scheduledTaskMessage('scheduledTasks.editor.promptPlaceholder')"
        :aria-label="scheduledTaskMessage('scheduledTasks.editor.prompt')"
        data-testid="scheduled-task-prompt"
      />

      <div class="scheduled-task-editor__bar">
        <CustomSelect
          v-model="projectId"
          v-bind="barSelect"
          min-width="180px"
          :options="projectOptions"
          :disabled="!isNew"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.project')"
          :trigger-tooltip="scheduledTaskMessage('scheduledTasks.editor.project')"
        />
        <CustomSelect
          v-model="agent"
          v-bind="barSelect"
          min-width="140px"
          :options="agentOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.agent')"
          :trigger-tooltip="scheduledTaskMessage('scheduledTasks.editor.agent')"
        />
        <CustomSelect
          v-model="modelChoice"
          v-bind="barSelect"
          min-width="240px"
          option-label-overflow="ellipsis"
          :options="modelOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.model')"
          :trigger-tooltip="scheduledTaskMessage('scheduledTasks.editor.model')"
        />
        <CustomSelect
          v-bind="barSelect"
          min-width="300px"
          :class="{ 'is-full-access': permissionLevel === 'full_access' }"
          :model-value="permissionLevel"
          :options="permissionOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.permission')"
          :trigger-tooltip="scheduledTaskMessage('scheduledTasks.editor.permission')"
          data-testid="scheduled-task-permission"
          @update:model-value="chooseLevel"
        />
      </div>
    </div>

    <div class="scheduled-task-editor__when">
      <div class="scheduled-task-editor__row">
        <CustomSelect
          use-portal-to-body
          :model-value="draft.kind"
          :options="kindOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.repeat')"
          @update:model-value="kind => patchDraft({ kind })"
        />
        <TimePicker
          v-if="hasTimeOfDay"
          :model-value="timeValue"
          :aria-label="scheduledTaskMessage('scheduledTasks.editor.schedule')"
          @update:model-value="setTime"
        />
      </div>

      <div v-if="draft.kind === 'hourly'" class="scheduled-task-editor__row">
        <CustomSelect
          use-portal-to-body
          :model-value="draft.everyHours"
          :options="hourlyOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.interval')"
          @update:model-value="everyHours => patchDraft({ everyHours })"
        />
        <CustomSelect
          use-portal-to-body
          :model-value="draft.minute"
          :options="minuteOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.minute')"
          @update:model-value="minute => patchDraft({ minute })"
        />
      </div>
      <div
        v-else-if="draft.kind === 'weekly'"
        class="scheduled-task-editor__weekdays"
        role="group"
        :aria-label="scheduledTaskMessage('scheduledTasks.editor.weekdays')"
      >
        <button
          v-for="day in ISO_WEEKDAYS"
          :key="day"
          type="button"
          class="scheduled-task-editor__weekday"
          :class="{ 'is-selected': draft.weekdays.includes(day) }"
          :aria-pressed="draft.weekdays.includes(day)"
          @click="patchDraft({ weekdays: toggleWeekday(draft.weekdays, day) })"
        >{{ scheduledTaskMessage(weekdayKey(day)) }}</button>
      </div>
      <CustomSelect
        v-else-if="draft.kind === 'monthly'"
        use-portal-to-body
        :model-value="String(draft.monthDay)"
        :options="monthDayOptions"
        :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.date')"
        @update:model-value="value => patchDraft({ monthDay: value === 'last' ? 'last' : Number(value) })"
      />
      <CustomTextInput
        v-else-if="draft.kind === 'cron'"
        control-class="scheduled-task-editor__cron"
        :model-value="draft.expression"
        :maxlength="120"
        :placeholder="scheduledTaskMessage('scheduledTasks.editor.cronPlaceholder')"
        :aria-label="scheduledTaskMessage('scheduledTasks.editor.preset.cron')"
        data-testid="scheduled-task-cron"
        @update:model-value="expression => patchDraft({ expression })"
      />

      <MonthCalendar
        v-model:month="displayMonth"
        :model-value="onceDate"
        :selectable="draft.kind === 'once'"
        :min-date="today"
        :is-marked="draft.kind === 'once' ? undefined : isRunDay"
        @update:model-value="date => patchDraft({ date: toLocalDate(date) })"
      />

      <p v-if="scheduleError" class="scheduled-task-editor__error" data-testid="scheduled-task-schedule-error">{{ scheduleError }}</p>
      <p v-else class="scheduled-task-editor__next" data-testid="scheduled-task-schedule-preview">{{ nextRunText }}</p>

      <div class="scheduled-task-editor__missed">
        <span>{{ scheduledTaskMessage('scheduledTasks.fact.missed') }}</span>
        <CustomSelect
          v-model="missedPolicy"
          use-portal-to-body
          :options="missedOptions"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.fact.missed')"
        />
      </div>
    </div>

    <p v-if="saveError" class="scheduled-task-editor__error scheduled-task-editor__save-error" role="alert">{{ saveError }}</p>
  </form>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useHistoryTime } from '@app/localization';
import {
  SCHEDULED_TASK_HOURLY_INTERVALS,
  SCHEDULED_TASK_NAME_MAX_CHARS,
  SCHEDULED_TASK_PROMPT_MAX_CHARS,
  type ScheduledTask,
  type ScheduledTaskAgent,
  type ScheduledTaskMissedPolicy,
  type ScheduledTaskPreviewScheduleResult,
} from '@app/schemas/scheduled-tasks';
import type { CommandPermissionLevel } from '@app/schemas/commands';
import {
  CustomSelect,
  CustomTextarea,
  CustomTextInput,
  MonthCalendar,
  TimePicker,
  useTimer,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import { requestConversationCommandPermission } from '@/app/workflows/command-permissions';
import { PERMISSION_LEVEL_DESCRIPTION_KEYS, PERMISSION_LEVEL_LABEL_KEYS } from '../functions/permissionLevelMessages';
import { buildConversationModelSelectOptions, useModelCatalogReadModel, useModelPickerReadModel } from '@/domains/model-configuration';
import { confirmPermissionLevelExpansion, useSettingsLocalization } from '@/domains/settings/public';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { weekdayKey } from '../functions/describeSchedule';
import {
  createScheduleDraft,
  localDateTimeToDate,
  scheduleFromDraft,
  toggleWeekday,
  toLocalDate,
  toLocalMonthRange,
  toLocalTime,
  type HourlyInterval,
  type ScheduleDraft,
  type ScheduleKind,
} from '../functions/scheduleDraft';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const props = defineProps<{
  /** 为空是新建。 */
  readonly task: ScheduledTask | null;
  /** 新建时预选的项目。 */
  readonly defaultProjectId: string | null;
  /** 版本冲突后按新版本重开表单时，带上那句提示。 */
  readonly initialError?: string;
}>();

const emit = defineEmits<{
  saved: [task: ScheduledTask, created: boolean];
  /** 版本冲突：外层重读列表，表单按新版本重开。 */
  conflict: [];
}>();

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const PERMISSION_LEVELS: readonly CommandPermissionLevel[] = ['read_only', 'standard', 'full_access'];
const DEFAULT_MODEL = '';

const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledTime } = useHistoryTime();
const { settingsMessage } = useSettingsLocalization();
const projectsStore = useWorkspaceProjectsStore();
const modelPicker = useModelPickerReadModel();

const isNew = computed(() => props.task === null);
/**
 * 打开表单时的版本。任务在别处被改（设置页降档、Agent 改任务、自动暂停）时 store 会推来新版本，
 * 保存必须仍拿打开时的版本去比，才能报冲突，而不是用表单里的旧值静默盖掉别处的修改。
 */
const baseRevision = props.task?.revision ?? 0;
const name = ref(props.task?.name ?? '');
const prompt = ref(props.task?.prompt ?? '');
const projectId = ref<string | null>(props.task?.project_id ?? props.defaultProjectId ?? projectsStore.projects[0]?.id ?? null);
const agent = ref<ScheduledTaskAgent>(props.task?.agent ?? 'default');
const modelChoice = ref<string>(props.task?.model_config_id ?? DEFAULT_MODEL);
const missedPolicy = ref<ScheduledTaskMissedPolicy>(props.task?.missed_policy ?? 'run_latest');
const draft = ref<ScheduleDraft>(createScheduleDraft(props.task?.schedule ?? null, new Date()));

/** 全局档位：新建默认跟它一致，但最高到“标准”；完全访问必须手动选。 */
const globalLevel = ref<CommandPermissionLevel>('standard');
const permissionLevel = ref<CommandPermissionLevel>(props.task?.permission_level ?? 'standard');
const levelTouched = ref(false);
const nameInput = ref<InstanceType<typeof CustomTextInput> | null>(null);
onMounted(async () => {
  // 焦点进到弹窗里，键盘不会停在被盖住的页面上。
  nameInput.value?.focus();
  const result = await requestConversationCommandPermission({ kind: 'read', target: null });
  if (result.kind !== 'view') return;
  globalLevel.value = result.view.global_level;
  if (isNew.value && !levelTouched.value) {
    permissionLevel.value = result.view.global_level === 'full_access' ? 'standard' : result.view.global_level;
  }
});

function patchDraft(patch: Partial<ScheduleDraft>): void {
  draft.value = { ...draft.value, ...patch };
}

const today = new Date();
const hasTimeOfDay = computed(() => draft.value.kind !== 'hourly' && draft.value.kind !== 'cron');
const timeValue = computed(() => localDateTimeToDate(draft.value.date, draft.value.time));
/** 只有“仅一次”在月历上选日子；其余方式月历只标出会运行的日子。 */
const onceDate = computed(() => (draft.value.kind === 'once' ? localDateTimeToDate(draft.value.date, '00:00') : null));
function setTime(value: Date | null): void {
  if (value) patchDraft({ time: toLocalTime(value) });
}

/** 任务框底部一排选择器的共同写法：只有文字，与对话输入框一致。 */
const barSelect = {
  variant: 'minimal',
  bordered: false,
  fontSize: '12px',
  usePortalToBody: true,
  showSelectedCheckmark: true,
  classNames: { trigger: 'scheduled-task-editor__bar-trigger', arrowIcon: 'scheduled-task-editor__bar-arrow' },
} as const;

const kindOptions = computed<CustomSelectOption<ScheduleKind>[]>(() => (
  ['once', 'hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'cron'] as const
).map(kind => ({ value: kind, text: scheduledTaskMessage(`scheduledTasks.editor.preset.${kind}`) })));

const hourlyOptions = computed<CustomSelectOption<HourlyInterval>[]>(() => SCHEDULED_TASK_HOURLY_INTERVALS.map(hours => ({
  text: scheduledTaskMessage('scheduledTasks.editor.everyHours', { hours }),
  value: hours,
})));

const minuteOptions = computed<CustomSelectOption<number>[]>(() => Array.from({ length: 60 }, (_, minute) => ({
  text: minute === 0
    ? scheduledTaskMessage('scheduledTasks.editor.onTheHour')
    : scheduledTaskMessage('scheduledTasks.editor.atMinute', { minute }),
  value: minute,
})));

const monthDayOptions = computed<CustomSelectOption<string>[]>(() => [
  ...Array.from({ length: 28 }, (_, index) => ({
    text: scheduledTaskMessage('scheduledTasks.editor.monthDay', { day: index + 1 }),
    value: String(index + 1),
  })),
  { text: scheduledTaskMessage('scheduledTasks.editor.monthLast'), value: 'last' },
]);

const projectOptions = computed<CustomSelectOption<string>[]>(() =>
  projectsStore.projects.map(project => ({ text: project.name, value: project.id })));

const agentOptions = computed<CustomSelectOption<ScheduledTaskAgent>[]>(() => [
  { text: scheduledTaskMessage('scheduledTasks.editor.agentDefault'), value: 'default' },
  { text: scheduledTaskMessage('scheduledTasks.editor.agentResearch'), value: 'research' },
]);

const modelCatalog = useModelCatalogReadModel();
function catalogModelName(modelConfigId: string): string | null {
  return modelCatalog.models.value.find(model => model.id === modelConfigId)?.display_name ?? null;
}

const modelOptions = computed(() => {
  const options = buildConversationModelSelectOptions({
    snapshot: modelPicker.snapshot.value,
    labels: {
      providerGroup: settingsMessage('settings.modelGroups.provider'),
      customGroup: settingsMessage('settings.modelGroups.custom'),
      unavailable: settingsMessage('settings.modelPicker.runtimeUnavailable'),
    },
  });
  const known = options.some(option => !('isGroup' in option && option.isGroup) && option.value === modelChoice.value);
  return [
    { text: scheduledTaskMessage('scheduledTasks.model.default'), value: DEFAULT_MODEL },
    ...(modelChoice.value !== DEFAULT_MODEL && !known
      // 选择器只列对话里显示的模型；被隐藏但仍在的模型照样显示名字，真删了才说“已删除”。
      ? [{ text: catalogModelName(modelChoice.value) ?? scheduledTaskMessage('scheduledTasks.model.unknown'), value: modelChoice.value, disabled: true }]
      : []),
    ...options,
  ];
});

function levelLabel(level: CommandPermissionLevel): string {
  return settingsMessage(PERMISSION_LEVEL_LABEL_KEYS[level]);
}
function levelDescription(level: CommandPermissionLevel): string {
  return settingsMessage(PERMISSION_LEVEL_DESCRIPTION_KEYS[level]);
}

const permissionOptions = computed<CustomSelectOption<CommandPermissionLevel>[]>(() => PERMISSION_LEVELS.map(level => ({
  value: level,
  text: levelLabel(level),
  description: levelDescription(level),
  ...(level === 'full_access' ? { variant: 'warning' as const } : {}),
})));

const missedOptions = computed<CustomSelectOption<ScheduledTaskMissedPolicy>[]>(() => [
  {
    value: 'run_latest',
    text: scheduledTaskMessage('scheduledTasks.missed.runLatest'),
    description: scheduledTaskMessage('scheduledTasks.editor.missedRunLatestHint'),
  },
  { value: 'skip', text: scheduledTaskMessage('scheduledTasks.missed.skip') },
]);

async function chooseLevel(next: CommandPermissionLevel): Promise<void> {
  levelTouched.value = true;
  if (next === 'full_access' && permissionLevel.value !== 'full_access') {
    const confirmed = await confirmPermissionLevelExpansion(settingsMessage, 'full_access', {
      title: scheduledTaskMessage('scheduledTasks.editor.fullAccessTitle'),
      riskAppendix: scheduledTaskMessage('scheduledTasks.editor.fullAccessWarning'),
    });
    if (!confirmed) return;
  }
  permissionLevel.value = next;
}

// ---- 时间表：随改随问 App Server ----

const preview = ref<ScheduledTaskPreviewScheduleResult | null>(null);
const displayMonth = ref<Date | null>(null);
let previewSeq = 0;
// 随改随问做防抖；useTimer 在组件卸载时自动取消。
const previewTimer = useTimer();

watch(draft, () => previewTimer.start(() => void runPreview().then(showNextRunMonth), 150), { immediate: true });
watch(() => (displayMonth.value ? toLocalMonthRange(displayMonth.value).from : null), (_month, previous) => {
  if (previous && draft.value.kind !== 'once') void runPreview();
});
onBeforeUnmount(() => {
  previewSeq += 1;
});

async function runPreview(): Promise<ScheduledTaskPreviewScheduleResult | null> {
  const seq = ++previewSeq;
  const schedule = scheduleFromDraft(draft.value);
  if (schedule.kind === 'cron' && schedule.expression === '') {
    preview.value = { ok: false, code: 'invalid_expression', message: 'empty expression' };
    return preview.value;
  }
  try {
    const result = await scheduledTasksClient.previewSchedule({
      schedule,
      ...(schedule.kind !== 'once' && displayMonth.value ? { run_days_in: toLocalMonthRange(displayMonth.value) } : {}),
    });
    if (seq === previewSeq) preview.value = result;
    return result;
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 检查时间失败', error);
    if (seq === previewSeq) preview.value = null;
    return null;
  }
}

/** 改了时间表后，月历翻到下次运行所在的月份；用户自己翻月时不干预。 */
function showNextRunMonth(result: ScheduledTaskPreviewScheduleResult | null): void {
  const next = result?.ok && draft.value.kind !== 'once' ? result.next_runs[0] : undefined;
  if (next !== undefined) displayMonth.value = new Date(next);
}

const runDays = computed(() => new Set(preview.value?.ok ? preview.value.run_days ?? [] : []));
function isRunDay(date: Date): boolean {
  return runDays.value.has(toLocalDate(date));
}

// 新增错误码时这里会类型报错，不会静默显示空提示。
const SCHEDULE_ERROR_MESSAGES = {
  invalid_expression: 'scheduledTasks.scheduleError.invalidExpression',
  too_frequent: 'scheduledTasks.scheduleError.tooFrequent',
  in_the_past: 'scheduledTasks.scheduleError.inThePast',
  never_runs: 'scheduledTasks.scheduleError.neverRuns',
} as const satisfies Record<Extract<ScheduledTaskPreviewScheduleResult, { ok: false }>['code'], string>;

const scheduleError = computed(() => {
  const result = preview.value;
  if (!result || result.ok) return '';
  return scheduledTaskMessage(SCHEDULE_ERROR_MESSAGES[result.code]);
});

const nextRunText = computed(() => {
  const next = preview.value?.ok ? preview.value.next_runs[0] : undefined;
  return next === undefined ? '' : scheduledTaskMessage('scheduledTasks.state.scheduled', { time: scheduledTime(next) });
});

// ---- 保存 ----

const attempted = ref(false);
const saving = ref(false);
const saveError = ref(props.initialError ?? '');
const nameError = computed(() => (
  attempted.value && !name.value.trim() ? scheduledTaskMessage('scheduledTasks.editor.nameRequired') : ''
));
const promptError = computed(() => (
  attempted.value && !prompt.value.trim() ? scheduledTaskMessage('scheduledTasks.editor.promptRequired') : ''
));

async function save(): Promise<void> {
  if (saving.value) return;
  attempted.value = true;
  saveError.value = '';
  if (nameError.value || promptError.value || !projectId.value) return;
  saving.value = true;
  try {
    // 保存前用当前草稿再问一次，避免拿着几百毫秒前的结果放行。
    const checked = await runPreview();
    if (!checked) saveError.value = scheduledTaskMessage('scheduledTasks.editor.checkFailed');
    if (!checked?.ok) return;
    const fields = {
      name: name.value.trim(),
      prompt: prompt.value.trim(),
      agent: agent.value,
      model_config_id: modelChoice.value === DEFAULT_MODEL ? null : modelChoice.value,
      schedule: scheduleFromDraft(draft.value),
      missed_policy: missedPolicy.value,
      permission_level: permissionLevel.value,
    };
    const result = props.task
      ? await scheduledTasksClient.update({ task_id: props.task.id, expected_revision: baseRevision, ...fields })
      : await scheduledTasksClient.create({ project_id: projectId.value, ...fields });
    if (result.ok) {
      emit('saved', result.task, props.task === null);
      return;
    }
    if (result.code === 'revision_conflict') {
      saveError.value = scheduledTaskMessage('scheduledTasks.editor.revisionConflict');
      emit('conflict');
      return;
    }
    saveError.value = scheduledTaskMessage('scheduledTasks.editor.saveFailed', { reason: result.message });
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 保存失败', error);
    saveError.value = scheduledTaskMessage('scheduledTasks.editor.saveFailed', { reason: String(error) });
  } finally {
    saving.value = false;
  }
}

// 操作按钮在弹窗底部，由外层触发保存。
defineExpose({ save, saving });
</script>
