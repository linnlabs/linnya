import { useLocalization } from '@app/localization';
import { formatConversationAttentionNotice } from '@/domains/conversation/features/conversation-activity';
import { createConversationMessageResolver } from '@/domains/conversation/functions/resolveConversationMessage';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

/**
 * 这条提示不是用户刚做的操作的回应，用户多半正看着别处，所以比默认的 3 秒停得久一些。
 * 错过也不要紧：侧栏的“待审批 / 待回答”标记一直在。
 */
const ATTENTION_NOTICE_DURATION_MS = 6_000;

/**
 * 外部入口（Linnya CLI）发起的运行停下来等用户时：
 * - 用户点了系统通知：打开那段对话，与工作区点击共用导航端口；
 * - 窗口在前台：用应用内提示说一句。用户正看着那段对话时不提示，审批卡或提问就在眼前。
 * 侧栏的“待审批 / 待回答”标记由 conversation-activity 负责，与这里无关。
 */
export function startConversationAttentionNotifications(
  show: (text: string, durationMs: number) => void,
): (() => void) | undefined {
  const { message } = useLocalization();
  const conversationMessage = createConversationMessageResolver(message);
  return window.electronAPI?.conversationAttention?.onNotify((notification, open) => {
    if (open) {
      if (!notification.project_id) return;
      void getWorkspaceNavigationPort()
        .openConversation({
          conversationId: notification.conversation_id,
          scope: { kind: 'project', projectId: notification.project_id },
        })
        .catch(error => console.warn('[ConversationAttention] 无法打开通知对应的对话', error));
      return;
    }
    if (useAssistantStore().activeConversationId === notification.conversation_id) return;
    show(formatConversationAttentionNotice(notification, conversationMessage), ATTENTION_NOTICE_DURATION_MS);
  });
}
