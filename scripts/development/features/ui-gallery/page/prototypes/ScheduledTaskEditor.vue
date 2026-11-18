<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ActionButtons,
  AlertDialog,
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
import {
  PERMISSION_TIERS,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  fullAccessDialogCopy,
  type PermissionTier,
} from './permissionTier.ts';
import {
  CURRENT_PROJECT_ID,
  DEMO_PROJECTS,
  WEEKDAY_LABELS,
  type DemoTask,
  type SchedulePreset,
} from './scheduledTasksDemo.ts';

/** 新建 / 编辑定时任务的表单。只做界面示意：保存只回传名称，不校验真实 cron。 */
const props = defineProps<{
  readonly task: DemoTask | null;
  readonly globalTier: PermissionTier;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [name: string];
}>();

const isNew = computed(() => props.task === null);

const name = ref(props.task?.name ?? '');
const prompt = ref(props.task?.prompt ?? '');
const projectId = ref(props.task?.projectId ?? CURRENT_PROJECT_ID);
const agent = ref(props.task?.agent === '研究' ? 'research' : 'default');
const model = ref(props.task ? props.task.model : 'default');
/** 用户新建时默认跟全局一致，但最高到“标准”；完全访问必须手动选。 */
const tier = ref<PermissionTier>(
  props.task?.tier ?? (props.globalTier === 'full_access' ? 'standard' : props.globalTier),
);
const skipMissed = ref(props.task?.skipMissed ?? false);

const preset = ref<SchedulePreset>(props.task?.preset ?? 'weekdays');
const time = ref<Date | null>(new Date(2026, 10, 18, 9, 0));
const onceDate = ref<Date | null>(new Date(2026, 10, 20));
const hourlyEvery = ref(1);
const hourlyMinute = ref(0);
const weekdays = ref<number[]>([0]);
const monthDay = ref<string>('1');
const cron = ref('0 9 * * 1-5');

const PRESET_TABS: SegmentedTabItem[] = [
  { id: 'once', label: '一次' },
  { id: 'hourly', label: '每小时' },
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '工作日' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
  { id: 'custom', label: '自定义' },
];

const PROJECT_OPTIONS: CustomSelectOption<string>[] = DEMO_PROJECTS.map(project => ({ text: project.name, value: project.id }));
const AGENT_OPTIONS: CustomSelectOption<string>[] = [
  { text: '默认', value: 'default' },
  { text: '研究', value: 'research' },
];
const MODEL_OPTIONS: CustomSelectOption<string>[] = [
  { text: '默认模型（现在是 DeepSeek V4）', value: 'default' },
  { text: 'DeepSeek V4', value: 'DeepSeek V4' },
  { text: 'DeepSeek V4 Flash', value: 'DeepSeek V4 Flash' },
  { text: 'GLM 5 Flash', value: 'GLM 5 Flash' },
  { text: 'Qwen 3.5 Plus', value: 'Qwen 3.5 Plus' },
];
const HOURLY_OPTIONS: CustomSelectOption<number>[] = [1, 2, 3, 4, 6, 8, 12].map(hours => ({ text: `每 ${hours} 小时`, value: hours }));
const MONTH_DAY_OPTIONS: CustomSelectOption<string>[] = [
  ...Array.from({ length: 28 }, (_, index) => ({ text: `${index + 1} 号`, value: String(index + 1) })),
  { text: '最后一天', value: 'last' },
];

const timeText = computed(() => {
  const value = time.value;
  return value ? `${value.getHours()}:${String(value.getMinutes()).padStart(2, '0')}` : '—';
});

function toggleWeekday(index: number) {
  const next = weekdays.value.includes(index)
    ? weekdays.value.filter(day => day !== index)
    : [...weekdays.value, index].sort();
  if (next.length) weekdays.value = next;
}

/** 画廊里只做最常见的判断：分钟段不是单个数字，就一定会在一小时内跑两次。 */
const cronError = computed(() => {
  if (preset.value !== 'custom') return '';
  const fields = cron.value.trim().split(/\s+/);
  if (fields.length !== 5) return '需要 5 段：分 时 日 月 星期，例如 0 9 * * 1-5。';
  if (!/^\d{1,2}$/.test(fields[0] ?? '')) return '按这个写法，相邻两次隔不到 1 小时。最短间隔是 1 小时。';
  return '';
});

const scheduleSummary = computed(() => {
  switch (preset.value) {
    case 'once':
      return `只运行一次：11月20日 ${timeText.value}。运行后自动停用，记录保留。`;
    case 'hourly':
      return `每 ${hourlyEvery.value} 小时运行一次，在第 ${hourlyMinute.value} 分钟。下次：今天 15:${String(hourlyMinute.value).padStart(2, '0')}。`;
    case 'daily':
      return `每天 ${timeText.value} 运行。下次：明天 ${timeText.value}。`;
    case 'weekdays':
      return `每个工作日 ${timeText.value} 运行。下次：明天（周二）${timeText.value}。`;
    case 'weekly':
      return `每周${weekdays.value.map(day => WEEKDAY_LABELS[day]).join('、')} ${timeText.value} 运行。`;
    case 'monthly':
      return `每月${monthDay.value === 'last' ? '最后一天' : ` ${monthDay.value} 号`} ${timeText.value} 运行。`;
    case 'custom':
      return cronError.value ? '' : '接下来 3 次：明天 9:00、11月19日 9:00、11月20日 9:00。';
  }
  return '';
});

const fullAccessOpen = ref(false);
/** 原生单选框点下去就会选中；取消确认后重建这一组，让显示回到当前值。 */
const tierGroupKey = ref(0);
function cancelFullAccess() {
  fullAccessOpen.value = false;
  tierGroupKey.value += 1;
}
const fullAccessCopy = fullAccessDialogCopy('scheduled-task');
function chooseTier(value: PermissionTier) {
  if (value === 'full_access' && tier.value !== 'full_access') {
    fullAccessOpen.value = true;
    return;
  }
  tier.value = value;
}
function confirmFullAccess() {
  tier.value = 'full_access';
  fullAccessOpen.value = false;
}

const attempted = ref(false);
const nameError = computed(() => (attempted.value && !name.value.trim() ? '写一个名称，方便在列表里认出它。' : ''));
const promptError = computed(() => (attempted.value && !prompt.value.trim() ? '写清楚每次要做什么。' : ''));
function save() {
  attempted.value = true;
  if (nameError.value || promptError.value || cronError.value) return;
  emit('save', name.value.trim());
}
</script>

<template>
  <div class="task-editor">
    <header class="task-editor__header">
      <h3 class="task-editor__title">{{ isNew ? '新建定时任务' : '编辑定时任务' }}</h3>
      <p v-if="!isNew" class="task-editor__note">改动从下一次运行开始生效；正在运行的这次按原设置跑完。</p>
    </header>

    <div class="task-editor__field">
      <label class="task-editor__label" for="task-editor-name">名称</label>
      <CustomTextInput id="task-editor-name" v-model="name" placeholder="例如：每日行业新闻" />
      <p v-if="nameError" class="task-editor__error">{{ nameError }}</p>
    </div>

    <div class="task-editor__field">
      <label class="task-editor__label" for="task-editor-prompt">每次要做的事</label>
      <CustomTextarea id="task-editor-prompt" v-model="prompt" :rows="4" placeholder="像平时发消息一样写。运行时没有人在场，Agent 不会停下来问你，会写明它做了哪些假设。" />
      <p v-if="promptError" class="task-editor__error">{{ promptError }}</p>
    </div>

    <div class="task-editor__field">
      <span class="task-editor__label">时间</span>
      <SegmentedTabs v-model="preset" :tabs="PRESET_TABS" aria-label="重复方式" />
      <div class="task-editor__schedule">
        <template v-if="preset === 'once'">
          <SimpleDatePicker v-model="onceDate" placeholder="日期" />
          <TimePicker v-model="time" />
        </template>
        <template v-else-if="preset === 'hourly'">
          <CustomSelect v-model="hourlyEvery" class="task-editor__select-sm" :options="HOURLY_OPTIONS" trigger-aria-label="间隔" />
          <span class="task-editor__inline-text">在第</span>
          <CustomNumberInput :model-value="hourlyMinute" :min="0" :max="59" :step="1" input-width="48px" @update:model-value="value => hourlyMinute = Number(value) || 0" />
          <span class="task-editor__inline-text">分钟</span>
        </template>
        <template v-else-if="preset === 'daily' || preset === 'weekdays'">
          <TimePicker v-model="time" />
        </template>
        <template v-else-if="preset === 'weekly'">
          <div class="task-editor__weekdays" role="group" aria-label="星期">
            <button
              v-for="(label, index) in WEEKDAY_LABELS"
              :key="label"
              type="button"
              class="task-editor__weekday"
              :class="{ 'is-selected': weekdays.includes(index) }"
              :aria-pressed="weekdays.includes(index)"
              @click="toggleWeekday(index)"
            >{{ label }}</button>
          </div>
          <TimePicker v-model="time" />
        </template>
        <template v-else-if="preset === 'monthly'">
          <CustomSelect v-model="monthDay" class="task-editor__select-sm" :options="MONTH_DAY_OPTIONS" trigger-aria-label="日期" />
          <TimePicker v-model="time" />
        </template>
        <template v-else>
          <CustomTextInput v-model="cron" class="task-editor__cron" placeholder="分 时 日 月 星期" />
        </template>
      </div>
      <p v-if="cronError" class="task-editor__error">{{ cronError }}</p>
      <p v-else class="task-editor__help">{{ scheduleSummary }} 按这台电脑的当地时间。</p>
    </div>

    <div class="task-editor__grid">
      <div class="task-editor__field">
        <span class="task-editor__label">项目</span>
        <CustomSelect v-model="projectId" :options="PROJECT_OPTIONS" trigger-aria-label="项目" />
      </div>
      <div class="task-editor__field">
        <span class="task-editor__label">Agent</span>
        <CustomSelect v-model="agent" :options="AGENT_OPTIONS" trigger-aria-label="Agent" />
      </div>
      <div class="task-editor__field task-editor__field--wide">
        <span class="task-editor__label">模型</span>
        <CustomSelect v-model="model" :options="MODEL_OPTIONS" trigger-aria-label="模型" />
        <p class="task-editor__help">指定的模型被删除或不可用时，这次运行记为失败并通知你，不会换成别的模型。</p>
      </div>
    </div>

    <div class="task-editor__field">
      <span class="task-editor__label">命令权限</span>
      <label v-for="option in PERMISSION_TIERS" :key="`${option}-${tierGroupKey}`" class="task-editor__tier">
        <CustomRadio :model-value="tier" :value="option" name="task-editor-tier" @update:model-value="chooseTier" />
        <span class="task-editor__tier-text">
          <span class="task-editor__tier-label" :class="{ 'is-full-access': option === 'full_access' }">{{ TIER_LABELS[option] }}</span>
          <span class="task-editor__tier-description">{{ TIER_DESCRIPTIONS[option] }}</span>
        </span>
      </label>
      <p class="task-editor__help">
        运行时遇到需要批准的命令，会停下来等你批准并通知你。新任务默认和全局设置一致（现在是“{{ TIER_LABELS[globalTier] }}”），最高到“标准”。
      </p>
    </div>

    <div class="task-editor__switch-row">
      <span class="task-editor__switch-text">
        <span class="task-editor__label">错过就跳过</span>
        <span class="task-editor__help">关闭时，App 没开或电脑睡眠错过的运行，会在下次打开时补跑最近一次（7 天内）。</span>
      </span>
      <Switch v-model="skipMissed" ariaLabel="错过就跳过" />
    </div>

    <footer class="task-editor__footer">
      <ActionButtons :primary-action-text="isNew ? '创建' : '保存'" secondary-action-text="取消" @primary-click="save" @secondary-click="emit('cancel')" />
    </footer>

    <AlertDialog
      :visible="fullAccessOpen"
      is-confirmation
      is-dangerous-action
      width="560px"
      :title="fullAccessCopy.title"
      :message="fullAccessCopy.message"
      :sections="fullAccessCopy.sections"
      :risk-message="fullAccessCopy.riskMessage"
      :confirm-text="fullAccessCopy.confirmText"
      :cancel-text="fullAccessCopy.cancelText"
      @confirm="confirmFullAccess"
      @cancel="cancelFullAccess"
    />
  </div>
</template>

<style scoped>
.task-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.task-editor__header {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.task-editor__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
}

.task-editor__note {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.task-editor__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  min-width: 0;
}

.task-editor__label {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.task-editor__help {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.task-editor__error {
  margin: 0;
  color: var(--color-error-text);
  font-size: var(--font-size-caption);
}

.task-editor__schedule {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.task-editor__select-sm {
  width: 140px;
}

.task-editor__inline-text {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.task-editor__cron {
  width: 220px;
  font-family: var(--font-family-mono, ui-monospace, monospace);
}

.task-editor__weekdays {
  display: inline-flex;
  gap: var(--space-1);
}

.task-editor__weekday {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.task-editor__weekday:hover {
  background: var(--color-bg-hover-strong);
}

.task-editor__weekday.is-selected {
  background: var(--color-bg-inverse);
  color: var(--color-text-inverse);
}

.task-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.task-editor__field--wide {
  grid-column: 1 / -1;
}

.task-editor__tier {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  cursor: pointer;
}

.task-editor__tier-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-editor__tier-label {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.task-editor__tier-label.is-full-access {
  color: var(--color-warning-text);
}

.task-editor__tier-description {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.task-editor__switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.task-editor__switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-editor__footer {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-3);
  border-top: 0.5px solid var(--color-border-light);
}
</style>
