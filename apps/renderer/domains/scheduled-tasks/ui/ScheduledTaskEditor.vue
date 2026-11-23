<!--
  新建 / 编辑定时任务。下次运行时间与时间表校验一律问 App Server（previewSchedule），这里不推算。
-->
<template>
  <form class="scheduled-task-editor" novalidate @submit.prevent="save">
    <header class="scheduled-task-editor__header">
      <h3 class="scheduled-task-editor__title">
        {{ scheduledTaskMessage(isNew ? 'scheduledTasks.editor.titleNew' : 'scheduledTasks.editor.titleEdit') }}
      </h3>
      <p v-if="!isNew" class="scheduled-task-editor__note">{{ scheduledTaskMessage('scheduledTasks.editor.editNote') }}</p>
    </header>

    <div class="scheduled-task-editor__field">
      <label class="scheduled-task-editor__label" :for="`${idPrefix}-name`">{{ scheduledTaskMessage('scheduledTasks.editor.name') }}</label>
      <CustomTextInput
        :id="`${idPrefix}-name`"
        v-model="name"
        :maxlength="SCHEDULED_TASK_NAME_MAX_CHARS"
        :placeholder="scheduledTaskMessage('scheduledTasks.editor.namePlaceholder')"
        data-testid="scheduled-task-name"
      />
      <p v-if="nameError" class="scheduled-task-editor__error">{{ nameError }}</p>
    </div>

    <div class="scheduled-task-editor__field">
      <label class="scheduled-task-editor__label" :for="`${idPrefix}-prompt`">{{ scheduledTaskMessage('scheduledTasks.editor.prompt') }}</label>
      <CustomTextarea
        :id="`${idPrefix}-prompt`"
        v-model="prompt"
        :rows="4"
        :maxlength="SCHEDULED_TASK_PROMPT_MAX_CHARS"
        :placeholder="scheduledTaskMessage('scheduledTasks.editor.promptPlaceholder')"
        data-testid="scheduled-task-prompt"
      />
      <p v-if="promptError" class="scheduled-task-editor__error">{{ promptError }}</p>
    </div>

    <div class="scheduled-task-editor__field">
      <span class="scheduled-task-editor__label">{{ scheduledTaskMessage('scheduledTasks.editor.schedule') }}</span>
      <SegmentedTabs
        :model-value="draft.kind"
        :tabs="presetTabs"
        :aria-label="scheduledTaskMessage('scheduledTasks.editor.repeat')"
        @update:model-value="value => patchDraft({ kind: value as ScheduleKind })"
      />
      <div class="scheduled-task-editor__schedule">
        <template v-if="draft.kind === 'once'">
          <SimpleDatePicker
            :model-value="onceDate"
            :placeholder="scheduledTaskMessage('scheduledTasks.editor.date')"
            @update:model-value="setOnceDate"
          />
          <TimePicker :model-value="timeValue" @update:model-value="setTime" />
        </template>
        <template v-else-if="draft.kind === 'hourly'">
          <CustomSelect
            class="scheduled-task-editor__select-sm"
            :model-value="draft.everyHours"
            :options="hourlyOptions"
            :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.interval')"
            @update:model-value="value => patchDraft({ everyHours: value as HourlyInterval })"
          />
          <span class="scheduled-task-editor__inline-text">{{ scheduledTaskMessage('scheduledTasks.editor.atMinuteBefore') }}</span>
          <CustomNumberInput
            :model-value="draft.minute"
            :min="0"
            :max="59"
            :step="1"
            input-width="48px"
            @update:model-value="value => patchDraft({ minute: clampMinute(value) })"
          />
          <span class="scheduled-task-editor__inline-text">{{ scheduledTaskMessage('scheduledTasks.editor.atMinuteAfter') }}</span>
        </template>
        <template v-else-if="draft.kind === 'daily' || draft.kind === 'weekdays'">
          <TimePicker :model-value="timeValue" @update:model-value="setTime" />
        </template>
        <template v-else-if="draft.kind === 'weekly'">
          <div class="scheduled-task-editor__weekdays" role="group" :aria-label="scheduledTaskMessage('scheduledTasks.editor.weekdays')">
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
          <TimePicker :model-value="timeValue" @update:model-value="setTime" />
        </template>
        <template v-else-if="draft.kind === 'monthly'">
          <CustomSelect
            class="scheduled-task-editor__select-sm"
            :model-value="String(draft.monthDay)"
            :options="monthDayOptions"
            :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.date')"
            @update:model-value="value => patchDraft({ monthDay: value === 'last' ? 'last' : Number(value) })"
          />
          <TimePicker :model-value="timeValue" @update:model-value="setTime" />
        </template>
        <template v-else>
          <CustomTextInput
            class="scheduled-task-editor__cron"
            :model-value="draft.expression"
            :placeholder="scheduledTaskMessage('scheduledTasks.editor.cronPlaceholder')"
            data-testid="scheduled-task-cron"
            @update:model-value="value => patchDraft({ expression: String(value) })"
          />
        </template>
      </div>
      <p v-if="scheduleError" class="scheduled-task-editor__error" data-testid="scheduled-task-schedule-error">{{ scheduleError }}</p>
      <p v-else class="scheduled-task-editor__help" data-testid="scheduled-task-schedule-preview">{{ schedulePreviewText }}</p>
    </div>

    <div class="scheduled-task-editor__grid">
      <div class="scheduled-task-editor__field">
        <span class="scheduled-task-editor__label">{{ scheduledTaskMessage('scheduledTasks.editor.project') }}</span>
        <CustomSelect
          v-model="projectId"
          :options="projectOptions"
          :disabled="!isNew"
          :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.project')"
        />
      </div>
      <div class="scheduled-task-editor__field">
        <span class="scheduled-task-editor__label">{{ scheduledTaskMessage('scheduledTasks.editor.agent') }}</span>
        <CustomSelect v-model="agent" :options="agentOptions" :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.agent')" />
      </div>
      <div class="scheduled-task-editor__field scheduled-task-editor__field--wide">
        <span class="scheduled-task-editor__label">{{ scheduledTaskMessage('scheduledTasks.editor.model') }}</span>
        <CustomSelect v-model="modelChoice" :options="modelOptions" :trigger-aria-label="scheduledTaskMessage('scheduledTasks.editor.model')" />
        <p class="scheduled-task-editor__help">{{ scheduledTaskMessage('scheduledTasks.editor.modelHelp') }}</p>
      </div>
    </div>

    <div class="scheduled-task-editor__field">
      <span class="scheduled-task-editor__label">{{ scheduledTaskMessage('scheduledTasks.editor.permission') }}</span>
      <label
        v-for="option in PERMISSION_LEVELS"
        :key="`${option}-${tierGroupKey}`"
        class="scheduled-task-editor__tier"
      >
        <CustomRadio
          :model-value="permissionLevel"
          :value="option"
          :name="`${idPrefix}-tier`"
          @update:model-value="chooseLevel"
        />
        <span class="scheduled-task-editor__tier-text">
          <span class="scheduled-task-editor__tier-label" :class="{ 'is-full-access': option === 'full_access' }">
            {{ levelLabel(option) }}
          </span>
          <span class="scheduled-task-editor__tier-description">{{ levelDescription(option) }}</span>
        </span>
      </label>
      <p class="scheduled-task-editor__help">
        {{ scheduledTaskMessage('scheduledTasks.editor.permissionHelp', { tier: levelLabel(globalLevel) }) }}
      </p>
    </div>

    <div class="scheduled-task-editor__switch-row">
      <span class="scheduled-task-editor__switch-text">
        <span class="scheduled-task-editor__label">{{ scheduledTaskMessage('scheduledTasks.editor.skipMissed') }}</span>
        <span class="scheduled-task-editor__help">{{ scheduledTaskMessage('scheduledTasks.editor.skipMissedHelp') }}</span>
      </span>
      <Switch v-model="skipMissed" :ariaLabel="scheduledTaskMessage('scheduledTasks.editor.skipMissed')" />
    </div>

    <p v-if="saveError" class="scheduled-task-editor__error" role="alert">{{ saveError }}</p>

    <footer class="scheduled-task-editor__footer">
      <ActionButtons
        :primary-action-text="scheduledTaskMessage(isNew ? 'scheduledTasks.editor.create' : 'scheduledTasks.editor.save')"
        :secondary-action-text="scheduledTaskMessage('scheduledTasks.editor.cancel')"
        :is-primary-action-disabled="saving"
        @primary-click="save"
        @secondary-click="emit('cancel')"
      />
    </footer>
  </form>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useHistoryTime } from '@app/localization';
import {
  SCHEDULED_TASK_HOURLY_INTERVALS,
  SCHEDULED_TASK_NAME_MAX_CHARS,
  SCHEDULED_TASK_PROMPT_MAX_CHARS,
  type ScheduledTask,
  type ScheduledTaskAgent,
  type ScheduledTaskPreviewScheduleResult,
} from '@app/schemas/scheduled-tasks';
import type { CommandPermissionLevel } from '@app/schemas/commands';
import {
  ActionButtons,
  CustomNumberInput,
  CustomRadio,
  CustomSelect,
  CustomTextarea,
  CustomTextInput,
  SegmentedTabs,
  SimpleDatePicker,
  Switch,
  TimePicker,
  type CustomSelectOption,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { requestConversationCommandPermission } from '@/app/workflows/command-permissions';
import { buildConversationModelSelectOptions, useModelPickerReadModel } from '@/domains/model-configuration';
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
}>();

const emit = defineEmits<{
  saved: [task: ScheduledTask, created: boolean];
  cancel: [];
  /** 版本冲突：外层重读列表，表单按新版本重开。 */
  conflict: [];
}>();

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const PERMISSION_LEVELS: readonly CommandPermissionLevel[] = ['read_only', 'standard', 'full_access'];
const DEFAULT_MODEL = '';

const idPrefix = `scheduled-task-${useId()}`;
const { scheduledTaskMessage } = useScheduledTaskLocalization();
const { scheduledTime } = useHistoryTime();
const { settingsMessage } = useSettingsLocalization();
const projectsStore = useWorkspaceProjectsStore();
const modelPicker = useModelPickerReadModel();

const isNew = computed(() => props.task === null);
const name = ref(props.task?.name ?? '');
const prompt = ref(props.task?.prompt ?? '');
const projectId = ref<string | null>(props.task?.project_id ?? props.defaultProjectId ?? projectsStore.projects[0]?.id ?? null);
const agent = ref<ScheduledTaskAgent>(props.task?.agent ?? 'default');
const modelChoice = ref<string>(props.task?.model_config_id ?? DEFAULT_MODEL);
const skipMissed = ref(props.task?.missed_policy === 'skip');
const draft = ref<ScheduleDraft>(createScheduleDraft(props.task?.schedule ?? null, new Date()));

/** 全局档位：新建默认跟它一致，但最高到“标准”；完全访问必须手动选。 */
const globalLevel = ref<CommandPermissionLevel>('standard');
const permissionLevel = ref<CommandPermissionLevel>(props.task?.permission_level ?? 'standard');
const levelTouched = ref(false);
onMounted(async () => {
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

const timeValue = computed(() => localDateTimeToDate(draft.value.date, draft.value.time));
const onceDate = computed(() => localDateTimeToDate(draft.value.date, '00:00'));
function setTime(value: Date | null): void {
  if (value) patchDraft({ time: toLocalTime(value) });
}
function setOnceDate(value: Date | null): void {
  if (value) patchDraft({ date: toLocalDate(value) });
}
function clampMinute(value: unknown): number {
  const minute = Math.round(Number(value));
  return Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0;
}

const presetTabs = computed<SegmentedTabItem[]>(() => (
  ['once', 'hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'cron'] as const
).map(kind => ({ id: kind, label: scheduledTaskMessage(`scheduledTasks.editor.preset.${kind}`) })));

const hourlyOptions = computed<CustomSelectOption<number>[]>(() => SCHEDULED_TASK_HOURLY_INTERVALS.map(hours => ({
  text: scheduledTaskMessage('scheduledTasks.editor.everyHours', { hours }),
  value: hours,
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
  { text: scheduledTaskMessage('scheduledTasks.agent.default'), value: 'default' },
  { text: scheduledTaskMessage('scheduledTasks.agent.research'), value: 'research' },
]);

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
      ? [{ text: scheduledTaskMessage('scheduledTasks.model.unknown'), value: modelChoice.value, disabled: true }]
      : []),
    ...options,
  ];
});

function levelLabel(level: CommandPermissionLevel): string {
  switch (level) {
    case 'read_only': return settingsMessage('settings.commandPermission.level.readOnly');
    case 'standard': return settingsMessage('settings.commandPermission.level.standard');
    case 'full_access': return settingsMessage('settings.commandPermission.level.fullAccess');
  }
}
function levelDescription(level: CommandPermissionLevel): string {
  switch (level) {
    case 'read_only': return settingsMessage('settings.commandPermission.level.readOnlyDescription');
    case 'standard': return settingsMessage('settings.commandPermission.level.standardDescription');
    case 'full_access': return settingsMessage('settings.commandPermission.level.fullAccessDescription');
  }
}

/** 原生单选框点下去就会选中；取消确认后重建这一组，让显示回到当前值。 */
const tierGroupKey = ref(0);
async function chooseLevel(value: unknown): Promise<void> {
  const next = value as CommandPermissionLevel;
  levelTouched.value = true;
  if (next === 'full_access' && permissionLevel.value !== 'full_access') {
    const confirmed = await confirmPermissionLevelExpansion(settingsMessage, 'full_access', {
      title: scheduledTaskMessage('scheduledTasks.editor.fullAccessTitle'),
      riskAppendix: scheduledTaskMessage('scheduledTasks.editor.fullAccessWarning'),
    });
    if (!confirmed) {
      tierGroupKey.value += 1;
      return;
    }
  }
  permissionLevel.value = next;
}

// ---- 时间表：随改随问 App Server ----

const preview = ref<ScheduledTaskPreviewScheduleResult | null>(null);
const previewPending = ref(false);
let previewSeq = 0;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

watch(draft, () => {
  previewPending.value = true;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void runPreview(), 250);
}, { immediate: true });
onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  previewSeq += 1;
});

async function runPreview(): Promise<ScheduledTaskPreviewScheduleResult | null> {
  const seq = ++previewSeq;
  try {
    const result = await scheduledTasksClient.previewSchedule(scheduleFromDraft(draft.value));
    if (seq !== previewSeq) return null;
    preview.value = result;
    return result;
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 检查时间失败', error);
    if (seq === previewSeq) preview.value = null;
    return null;
  } finally {
    if (seq === previewSeq) previewPending.value = false;
  }
}

const scheduleError = computed(() => {
  const result = preview.value;
  if (!result || result.ok) return '';
  switch (result.code) {
    case 'invalid_expression': return scheduledTaskMessage('scheduledTasks.scheduleError.invalidExpression');
    case 'too_frequent': return scheduledTaskMessage('scheduledTasks.scheduleError.tooFrequent');
    case 'in_the_past': return scheduledTaskMessage('scheduledTasks.scheduleError.inThePast');
    case 'never_runs': return scheduledTaskMessage('scheduledTasks.scheduleError.neverRuns');
  }
});

const schedulePreviewText = computed(() => {
  const localTime = scheduledTaskMessage('scheduledTasks.editor.localTime');
  const result = preview.value;
  if (previewPending.value && !result) return scheduledTaskMessage('scheduledTasks.editor.checking');
  if (!result?.ok || result.next_runs.length === 0) return localTime;
  const separator = scheduledTaskMessage('scheduledTasks.schedule.daySeparator');
  const times = result.next_runs
    .map(epoch => scheduledTime(epoch))
    .join(separator);
  const parts = [scheduledTaskMessage('scheduledTasks.editor.nextRuns', { times })];
  if (draft.value.kind === 'once') parts.push(scheduledTaskMessage('scheduledTasks.editor.onceNote'));
  parts.push(localTime);
  return parts.join(' ');
});

// ---- 保存 ----

const attempted = ref(false);
const saving = ref(false);
const saveError = ref('');
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
    if (!checked || !checked.ok) return;
    const fields = {
      name: name.value.trim(),
      prompt: prompt.value.trim(),
      agent: agent.value,
      model_config_id: modelChoice.value === DEFAULT_MODEL ? null : modelChoice.value,
      schedule: scheduleFromDraft(draft.value),
      missed_policy: skipMissed.value ? 'skip' as const : 'run_latest' as const,
      permission_level: permissionLevel.value,
    };
    const result = props.task
      ? await scheduledTasksClient.update({ task_id: props.task.id, expected_revision: props.task.revision, ...fields })
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
</script>
