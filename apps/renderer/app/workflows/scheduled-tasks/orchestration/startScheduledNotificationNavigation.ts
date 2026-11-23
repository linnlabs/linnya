import { useScheduledTasksStore } from '@/domains/scheduled-tasks';
import { historyApiService } from '@/domains/conversation/history/services/historyApiService';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

/**
 * 用户点了系统通知：有对话的打开对话并记为已看；没有对话的（自动暂停、补跑汇总、没生成对话的失败）
 * 打开定时任务页并选中该任务。前台时的应用内提示由 scheduled-tasks 领域负责。
 */
export function startScheduledNotificationNavigation(): (() => void) | undefined {
  const bridge = window.electronAPI?.scheduledTasks;
  return bridge?.onNotify((event, open) => {
    if (!open) return;
    const navigation = getWorkspaceNavigationPort();
    const conversationId = 'conversation_id' in event ? event.conversation_id : null;
    if (!conversationId) {
      const scheduledTaskId = 'task_id' in event ? event.task_id : null;
      const projectId = scheduledTaskId ? useScheduledTasksStore().taskById(scheduledTaskId)?.project_id ?? null : null;
      void navigation.openScheduledTasks({ projectId, scheduledTaskId })
        .catch(error => console.warn('[ScheduledTasks] 无法打开通知对应的任务', error));
      return;
    }
    void historyApiService.fetchMetadata(conversationId).then(async metadata => {
      if (!metadata?.project_id) return;
      // 与工作区点击和探针共用导航端口，保留编辑器保存及项目切换顺序。
      await navigation.openConversation({ conversationId, scope: { kind: 'project', projectId: metadata.project_id } });
      await bridge.markViewed({ conversation_id: conversationId });
    }).catch(error => console.warn('[ScheduledTasks] 无法打开通知对应的对话', error));
  });
}
