import { watch } from 'vue';
import { useConversationState } from '@/domains/conversation/store/conversationState';
import { scheduledTasksClient, useScheduledTasksStore } from '@/domains/scheduled-tasks';

function reportViewed(conversationId: string): void {
  void scheduledTasksClient.markViewed(conversationId).catch((error: unknown) => {
    console.warn('[ScheduledTasks] 上报已查看失败', error);
  });
}

/**
 * 打开任何对话都报给 App Server：是定时运行的对话就清掉这次的未读、刷新“最近查看”（驱动 14 天自动暂停）；
 * 普通对话 App Server 查不到运行，直接忽略。只在切换对话时报——App Server 每次记为已看都会推送变化，
 * 跟着推送再报会来回触发。
 *
 * 例外：用户正开着的对话里，定时运行刚好跑完而记成了未读。这次运行按 id 只补报一次。
 */
export function startScheduledConversationViewedReporting(): () => void {
  if (!window.electronAPI?.scheduledTasks) return () => undefined;
  const conversationState = useConversationState();
  const store = useScheduledTasksStore();
  const reportedRunIds = new Set<string>();

  const stopActive = watch(() => conversationState.activeConversationId, conversationId => {
    if (conversationId) reportViewed(conversationId);
  });
  const stopFinished = watch(
    () => {
      const active = conversationState.activeConversationId;
      if (!active) return null;
      // 看这次运行自己的未读标记，不看任务的未读总数：总数里可能还有更早的运行，跑到一半就会误报。
      const run = store.tasks.map(item => item.last_run).find(item => item?.unread === true && item.conversation_id === active);
      return run?.id ?? null;
    },
    runId => {
      const conversationId = conversationState.activeConversationId;
      if (!runId || !conversationId || reportedRunIds.has(runId)) return;
      reportedRunIds.add(runId);
      reportViewed(conversationId);
    },
  );
  return () => {
    stopActive();
    stopFinished();
  };
}
