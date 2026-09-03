import { reconcileTerminalConversationWindow } from '../../message-window';
import { useSubrunTraceInvalidationStore } from '../../features/subrun-trace';

export interface ReconcileTerminalConversationViewDeps {
  readonly reconcileWindow?: (conversationId: string) => Promise<void>;
  readonly invalidateSubrunTrace?: (conversationId: string) => void;
}

/**
 * cancel 命令完成后的跨 feature UI 收尾。
 *
 * 用户点击取消时，原 run 也可能已经自然完成或失败。Host 返回竞争后的持久终态，
 * Renderer 在这里统一重读 durable window，再通知已展开的 subrun trace 重读。
 */
export async function reconcileTerminalConversationView(
  conversationId: string,
  deps: ReconcileTerminalConversationViewDeps = {},
): Promise<void> {
  const reconcileWindow = deps.reconcileWindow ?? reconcileTerminalConversationWindow;
  await reconcileWindow(conversationId);

  const invalidateSubrunTrace = deps.invalidateSubrunTrace
    ?? useSubrunTraceInvalidationStore().invalidateConversation;
  invalidateSubrunTrace(conversationId);
}
