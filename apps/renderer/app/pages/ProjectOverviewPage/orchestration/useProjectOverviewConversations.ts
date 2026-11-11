import { computed, onMounted, ref, type Ref } from 'vue';
import type { NavigationScope } from '@/app/navigation';
import { useNotificationStore } from '@/app/notification';
import { useConversationTitleFeature } from '@/domains/conversation/features/conversation-title';
import { useInteractiveRunStore } from '@/domains/conversation/features/interactive-run';
import { deleteConversationFromHistory } from '@/domains/conversation/history/orchestration/deleteConversationFromHistory';
import { useHistoryList } from '@/domains/conversation/history/list';
import { resolveRunExecutionActivity } from '@/domains/conversation/shared/execution-presentation';
import { useConversationLocalization } from '@/domains/conversation/ui/useConversationLocalization';
import type { ProjectConversationActions } from '@/domains/workspace/features/project-overview/definitions/projectConversations';
import { confirm } from '@shared/composables/confirmDialog';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

/**
 * 项目概览对话页接到对话领域：写操作沿用侧栏同一套（历史列表、删除生命周期、标题），
 * “正在回复”取本窗口观察到的运行状态，不读数据库里可能残留的运行状态。
 */
export function useProjectOverviewConversations(projectId: Readonly<Ref<string>>) {
  const historyListStore = useHistoryList();
  const interactiveRunStore = useInteractiveRunStore();
  const titleFeature = useConversationTitleFeature();
  const notifications = useNotificationStore();
  const navigation = getWorkspaceNavigationPort();
  const { conversationMessage } = useConversationLocalization();
  /** 本页发起的写操作完成后加一；对话历史缓存里没有这个项目时也能触发重读。 */
  const actionRevision = ref(0);

  const scope = computed<NavigationScope>(() => ({ kind: 'project', projectId: projectId.value }));

  const runningConversationIds = computed<ReadonlySet<string>>(() => {
    const running = new Set<string>();
    for (const [conversationId, run] of interactiveRunStore.runsByConversation) {
      if (resolveRunExecutionActivity(run).isExecuting) running.add(conversationId);
    }
    return running;
  });

  const conversationHistoryKey = computed(() => {
    const history = historyListStore.getConversationsByScope(scope.value)
      .map(item => `${item.conversation_id}:${item.title}:${item.is_pinned === true ? 1 : 0}:${item.last_event_at ?? ''}:${item.user_message_count ?? ''}`)
      .join('|');
    return `${actionRevision.value}#${[...runningConversationIds.value].sort().join(',')}#${history}`;
  });

  // 侧栏通常已加载本项目的对话历史；没加载时补一次，之后的改名、新回复才能反映到签名里。
  onMounted(() => {
    if (!historyListStore.hasLoadedScope(scope.value)) {
      void historyListStore.loadScopeList(scope.value, { loadAll: true, limit: 100 });
    }
  });

  const untitled = (title: string) => title || conversationMessage('conversation.sidebar.untitled');

  const actions: ProjectConversationActions = {
    open: conversationId => {
      void navigation.openConversation({ conversationId, scope: scope.value });
    },
    setPinned: async (conversationId, pinned) => {
      try {
        await historyListStore.updatePinned(conversationId, pinned);
        actionRevision.value += 1;
        return true;
      } catch (error: unknown) {
        console.error('[ProjectOverview] 置顶对话失败:', error);
        return false;
      }
    },
    rename: async (conversationId, title) => {
      try {
        await titleFeature.renameConversation(conversationId, title);
        actionRevision.value += 1;
        return true;
      } catch {
        notifications.show(conversationMessage('conversation.sidebar.renameFailedGeneric'), 'error', 4000);
        return false;
      }
    },
    remove: async (conversationId, title) => {
      const displayTitle = untitled(title);
      const confirmed = await confirm({
        title: conversationMessage('conversation.sidebar.delete.title'),
        message: conversationMessage('conversation.sidebar.delete.message', { title: displayTitle }),
        confirmText: conversationMessage('conversation.sidebar.delete.confirm'),
        cancelText: conversationMessage('conversation.sidebar.delete.cancel'),
        isDangerousAction: true,
      });
      if (!confirmed) return false;
      try {
        await deleteConversationFromHistory({ conversationId, scope: scope.value });
        actionRevision.value += 1;
        notifications.show(conversationMessage('conversation.sidebar.deleteSuccess', { title: displayTitle }), 'success', 3000);
        return true;
      } catch {
        notifications.show(conversationMessage('conversation.sidebar.deleteFailedGeneric'), 'error', 4000);
        return false;
      }
    },
  };

  return { actions, runningConversationIds, conversationHistoryKey };
}
