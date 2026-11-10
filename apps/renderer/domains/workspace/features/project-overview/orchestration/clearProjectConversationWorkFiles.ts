import { confirm } from '@shared/composables/confirmDialog';
import { useNotificationStore } from '@/app/notification';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { clearProjectConversationWorkFiles as clearWorkFiles } from '../infrastructure/projectConversationsGateway';

/** 二次确认后清理一个对话的过程文件；返回是否已清理。失败只提示，不抛出。 */
export async function clearProjectConversationWorkFiles(input: {
  readonly conversationId: string;
  readonly title: string;
  readonly message: WorkspaceMessageResolver;
}): Promise<boolean> {
  const { message } = input;
  const confirmed = await confirm({
    title: message('workspace.projectOverview.conversations.clear.title'),
    message: message('workspace.projectOverview.conversations.clear.message', { title: input.title }),
    confirmText: message('workspace.projectOverview.conversations.clear.confirm'),
    cancelText: message('workspace.projectOverview.conversations.clear.cancel'),
    isDangerousAction: true,
  });
  if (!confirmed) return false;
  try {
    await clearWorkFiles(input.conversationId);
    return true;
  } catch (error: unknown) {
    console.error('[ProjectConversations] 清理过程文件失败:', error);
    useNotificationStore().show(message('workspace.projectOverview.conversations.clear.failed'), 'error', 4000);
    return false;
  }
}
