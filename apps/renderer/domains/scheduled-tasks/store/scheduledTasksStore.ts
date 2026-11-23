import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ScheduledTask, ScheduledTaskSettings, ScheduledTasksListResult } from '@app/schemas/scheduled-tasks';

export type ScheduledTasksLoadState = 'idle' | 'loading' | 'ready' | 'error';

/** App Server 任务列表的 Renderer 快照。只保存最近一次读取的结果，读取与刷新由 orchestration 负责。 */
export const useScheduledTasksStore = defineStore('scheduled-tasks', () => {
  const tasks = ref<readonly ScheduledTask[]>([]);
  const settings = ref<ScheduledTaskSettings | null>(null);
  const runningCount = ref(0);
  const schedulerEnabled = ref(true);
  const loadState = ref<ScheduledTasksLoadState>('idle');
  /** 每次收到“有变化”就加一；运行记录等按需读取的视图据此重读。 */
  const changeSeq = ref(0);

  const unreadTotal = computed(() => tasks.value.reduce((sum, task) => sum + task.unread_count, 0));

  function unreadInProject(projectId: string): number {
    return tasks.value.reduce((sum, task) => sum + (task.project_id === projectId ? task.unread_count : 0), 0);
  }

  function taskById(taskId: string): ScheduledTask | null {
    return tasks.value.find(task => task.id === taskId) ?? null;
  }

  function applyList(result: ScheduledTasksListResult): void {
    tasks.value = result.tasks;
    settings.value = result.settings;
    runningCount.value = result.running_count;
    schedulerEnabled.value = result.scheduler_enabled;
    loadState.value = 'ready';
  }

  function applyTask(task: ScheduledTask): void {
    const index = tasks.value.findIndex(item => item.id === task.id);
    tasks.value = index === -1
      ? [...tasks.value, task]
      : tasks.value.map(item => (item.id === task.id ? task : item));
  }

  function removeTask(taskId: string): void {
    tasks.value = tasks.value.filter(task => task.id !== taskId);
  }

  function applySettings(next: ScheduledTaskSettings): void {
    settings.value = next;
  }

  function markLoading(): void {
    if (loadState.value !== 'ready') loadState.value = 'loading';
  }

  function markError(): void {
    if (loadState.value !== 'ready') loadState.value = 'error';
  }

  function noteChanged(): void {
    changeSeq.value += 1;
  }

  return {
    tasks, settings, runningCount, schedulerEnabled, loadState, changeSeq, unreadTotal,
    unreadInProject, taskById, applyList, applyTask, removeTask, applySettings, markLoading, markError, noteChanged,
  };
});
