import { historyApiService } from '@/domains/conversation/history/services/historyApiService';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

export function startScheduledNotificationNavigation(): (() => void) | undefined {
  const bridge = window.electronAPI?.scheduledTasks;
  return bridge?.onNotify((event, open) => {
    if (!open || !('conversation_id' in event) || !event.conversation_id) return;
    const id = event.conversation_id;
    void historyApiService.fetchMetadata(id).then(async metadata => {
      if (!metadata?.project_id) return;
      // 与工作区点击和探针共用导航端口，保留编辑器保存及项目切换顺序。
      await getWorkspaceNavigationPort().openConversation({ conversationId: id, scope: { kind: 'project', projectId: metadata.project_id } });
      await bridge.markViewed({ conversation_id: id });
    }).catch(error => console.warn('[ScheduledTasks] 无法打开通知对应的对话', error));
  });
}
