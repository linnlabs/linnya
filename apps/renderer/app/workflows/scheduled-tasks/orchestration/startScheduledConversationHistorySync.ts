import { watch } from 'vue';
import { createTimer } from '@linnya/renderer-ui';
import type { ScheduledTask } from '@app/schemas/scheduled-tasks';
import { useHistoryList } from '@/domains/conversation/history/list';
import { useScheduledTasksStore } from '@/domains/scheduled-tasks';

/** 连着来的几次推送（开跑、完成、记为已看）合成一次重读。 */
const RELOAD_DELAY_MS = 400;

/** 折叠行显示的那些字段；变了才需要重读列表。 */
function foldSignature(task: ScheduledTask): string {
  const run = task.last_run;
  return [task.name, task.run_count, task.unread_count, run?.id ?? '', run?.status ?? '', run?.conversation_id ?? ''].join('\u0000');
}

/**
 * 侧栏把同一定时任务的对话折成一行，行上的未读数和“最近一次”由 App Server 汇总，对话本身不会推送这些变化。
 * 任务的折叠字段变了，就把它所在项目已加载的列表重读一次。
 */
export function startScheduledConversationHistorySync(): () => void {
  if (!window.electronAPI?.scheduledTasks) return () => undefined;
  const store = useScheduledTasksStore();
  const history = useHistoryList();
  let known: Map<string, { readonly projectId: string; readonly signature: string }> | null = null;
  const pending = new Set<string>();
  const timer = createTimer();

  function flush(): void {
    const projectIds = [...pending];
    pending.clear();
    if (projectIds.length > 0) history.reloadProjectScopes(projectIds);
  }

  const stop = watch(() => [store.tasks, store.loadState] as const, ([tasks, loadState]) => {
    if (loadState !== 'ready') return;
    const next = new Map(tasks.map(task => [task.id, { projectId: task.project_id, signature: foldSignature(task) }]));
    // 第一次读到的是现状，列表自己加载时已经带上，不用重读。
    if (known !== null) {
      for (const [taskId, entry] of next) {
        const before = known.get(taskId);
        if (!before || before.signature !== entry.signature) pending.add(entry.projectId);
        if (before && before.projectId !== entry.projectId) pending.add(before.projectId);
      }
      for (const [taskId, before] of known) {
        if (!next.has(taskId)) pending.add(before.projectId);
      }
    }
    known = next;
    if (pending.size > 0) timer.startIfIdle(flush, RELOAD_DELAY_MS);
  }, { immediate: true });

  return () => {
    stop();
    timer.cancel();
  };
}
