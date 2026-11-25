<!--
  选中任务的运行记录：计划时刻倒序，按页往前取；收到“有变化”推送时重读第一页。
-->
<template>
  <section class="scheduled-task-runs" :aria-label="scheduledTaskMessage('scheduledTasks.runs.title')">
    <header class="scheduled-task-runs__header">
      <h2 class="scheduled-task-runs__title">{{ scheduledTaskMessage('scheduledTasks.runs.title') }}</h2>
      <span v-if="task.run_count > 0" class="scheduled-task-runs__stats">{{ statsText }}</span>
    </header>

    <p v-if="loadFailed && runs.length === 0" class="scheduled-task-runs__empty">
      {{ scheduledTaskMessage('scheduledTasks.loadFailed') }}
      <button type="button" class="scheduled-task-runs__link" @click="reload">{{ scheduledTaskMessage('scheduledTasks.retry') }}</button>
    </p>
    <p v-else-if="loaded && runs.length === 0" class="scheduled-task-runs__empty">
      {{ scheduledTaskMessage('scheduledTasks.runs.empty') }}
    </p>

    <component
      :is="item.run.conversation_id ? 'button' : 'div'"
      v-for="item in rows"
      :key="item.run.id"
      :type="item.run.conversation_id ? 'button' : undefined"
      class="scheduled-task-run"
      :class="{ 'is-unread': item.run.unread }"
      data-testid="scheduled-task-run"
      @click="item.run.conversation_id && emit('open-conversation', item.run.conversation_id)"
    >
      <span class="scheduled-task-run__time">{{ item.plannedText }}</span>
      <span class="scheduled-task-run__result" :class="`is-${item.tone}`" :title="item.resultText">{{ item.resultText }}</span>
      <span class="scheduled-task-run__level" :class="{ 'is-full-access': item.run.permission_level === 'full_access' }">{{ item.levelText }}</span>
      <span class="scheduled-task-run__tokens">{{ item.tokensText }}</span>
      <ChevronIcon v-if="item.run.conversation_id" direction="right" class="scheduled-task-run__go" />
    </component>

    <button
      v-if="hasMore"
      type="button"
      class="scheduled-task-runs__more"
      :disabled="loadingMore"
      @click="loadMore"
    >{{ scheduledTaskMessage('scheduledTasks.runs.loadMore') }}</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatStorageBytes, useHistoryTime } from '@app/localization';
import type { CommandPermissionLevel } from '@app/schemas/commands';
import type { ScheduledTask, ScheduledTaskRun } from '@app/schemas/scheduled-tasks';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useSettingsLocalization } from '@/domains/settings/public';
import { scheduledTasksClient } from '../adapters/scheduledTasksClient';
import { PERMISSION_LEVEL_LABEL_KEYS } from '../functions/permissionLevelMessages';
import { presentRun } from '../functions/presentScheduledTask';
import { useScheduledTasksStore } from '../store/scheduledTasksStore';
import { useScheduledTaskLocalization } from './useScheduledTaskLocalization';

const PAGE_SIZE = 20;

const props = defineProps<{ readonly task: ScheduledTask }>();
const emit = defineEmits<{ 'open-conversation': [conversationId: string] }>();

const { currentLocale, scheduledTaskMessage } = useScheduledTaskLocalization();
const { settingsMessage } = useSettingsLocalization();
const { scheduledTime } = useHistoryTime();
const store = useScheduledTasksStore();

const runs = ref<readonly ScheduledTaskRun[]>([]);
const hasMore = ref(false);
const loaded = ref(false);
const loadFailed = ref(false);
const loadingMore = ref(false);
let seq = 0;

async function reload(): Promise<void> {
  const current = ++seq;
  loadFailed.value = false;
  try {
    // 已经往前翻过的页数保留，推送刷新时不把用户看着的记录收回去。
    const limit = Math.min(100, Math.max(PAGE_SIZE, runs.value.length));
    const result = await scheduledTasksClient.runs({ task_id: props.task.id, limit });
    if (current !== seq) return;
    runs.value = result.runs;
    hasMore.value = result.has_more;
    loaded.value = true;
  } catch (error: unknown) {
    if (current !== seq) return;
    console.warn('[scheduled-tasks] 读取运行记录失败', error);
    loadFailed.value = true;
  }
}

async function loadMore(): Promise<void> {
  const last = runs.value[runs.value.length - 1];
  if (!last || loadingMore.value) return;
  const current = seq;
  loadingMore.value = true;
  try {
    const result = await scheduledTasksClient.runs({
      task_id: props.task.id,
      before_planned_at: last.planned_at,
      limit: PAGE_SIZE,
    });
    if (current !== seq) return;
    runs.value = [...runs.value, ...result.runs];
    hasMore.value = result.has_more;
  } catch (error: unknown) {
    console.warn('[scheduled-tasks] 读取更早的运行记录失败', error);
  } finally {
    loadingMore.value = false;
  }
}

watch(() => props.task.id, () => {
  runs.value = [];
  hasMore.value = false;
  loaded.value = false;
  void reload();
}, { immediate: true });
watch(() => store.changeSeq, () => { void reload(); });

const statsText = computed(() => (props.task.storage_bytes !== null && props.task.storage_bytes > 0
  ? scheduledTaskMessage('scheduledTasks.runs.stats', {
    count: props.task.run_count,
    size: formatStorageBytes(props.task.storage_bytes, currentLocale.value),
  })
  : scheduledTaskMessage('scheduledTasks.runs.statsCountOnly', { count: props.task.run_count })));

function levelText(level: CommandPermissionLevel): string {
  return settingsMessage(PERMISSION_LEVEL_LABEL_KEYS[level]);
}

const rows = computed(() => {
  const numberFormat = new Intl.NumberFormat(currentLocale.value);
  return runs.value.map(run => {
    const presentation = presentRun(run, scheduledTaskMessage);
    return {
      run,
      tone: presentation.tone,
      plannedText: scheduledTime(run.planned_at),
      resultText: [
        presentation.triggerText,
        presentation.lateStartAt === null
          ? ''
          : scheduledTaskMessage('scheduledTasks.runs.started', { time: scheduledTime(presentation.lateStartAt) }),
        presentation.resultText,
      ].filter(Boolean).join(' · '),
      // 只在这次运行的权限和任务现在的不一样时才写，避免每行重复。
      levelText: run.permission_level === props.task.permission_level ? '' : levelText(run.permission_level),
      tokensText: run.total_tokens
        ? scheduledTaskMessage('scheduledTasks.runs.tokens', { count: numberFormat.format(run.total_tokens) })
        : '',
    };
  });
});
</script>
