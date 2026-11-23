import { watch } from 'vue';
import { useConversationState } from '@/domains/conversation/store/conversationState';
import { scheduledTasksClient } from '@/domains/scheduled-tasks';

/**
 * 打开任何对话都报给 App Server：是定时运行的对话就清掉这次的未读、刷新“最近查看”（驱动 14 天自动暂停）；
 * 普通对话 App Server 查不到运行，直接忽略。只在切换对话时报——App Server 每次记为已看都会推送变化，
 * 跟着推送再报会来回触发。
 */
export function startScheduledConversationViewedReporting(): () => void {
  if (!window.electronAPI?.scheduledTasks) return () => undefined;
  const conversationState = useConversationState();
  return watch(() => conversationState.activeConversationId, conversationId => {
    if (!conversationId) return;
    void scheduledTasksClient.markViewed(conversationId).catch((error: unknown) => {
      console.warn('[ScheduledTasks] 上报已查看失败', error);
    });
  });
}
